import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, createCancelToken, type RefetchInstance } from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

describe('retry', () => {
  it('retries failed attempts until one succeeds', async () => {
    const result = asOk(
      await api.get<{ attempt: number }>('/flaky?key=succeeds&fails=2', undefined, {
        retry: { attempts: 3 },
      }),
    );
    expect(result.data.attempt).toBe(3);
    expect(server.hits('/flaky')).toBe(3);
  });

  it('gives up after the configured number of attempts', async () => {
    const result = asError(await api.get('/flaky?key=gives-up&fails=10', undefined, { retry: 2 }));
    expect(result.status).toBe(500);
    expect(server.hits('/flaky')).toBe(2);
  });

  it('does not retry without a retry config', async () => {
    await api.get('/status/500');
    expect(server.hits('/status/500')).toBe(1);
  });

  it.each([400, 401, 403, 404, 422])('does not retry %s by default', async (status) => {
    await api.get(`/status/${status}`, undefined, { retry: 3 });
    expect(server.hits(`/status/${status}`)).toBe(1);
  });

  it('honours a custom condition', async () => {
    const retry = {
      attempts: 3,
      condition: (response: { status?: number }) => response.status === 404,
    };
    await api.get('/status/404', undefined, { retry });
    expect(server.hits('/status/404')).toBe(3);
    await api.get('/status/500', undefined, { retry });
    expect(server.hits('/status/500')).toBe(1);
  });

  it('waits for the delay and calls onRetry before each retry', async () => {
    const attempts: number[] = [];
    const statuses: (number | undefined)[] = [];
    const delay = vi.fn((attempt: number) => attempt * 10);
    const started = Date.now();

    await api.get('/flaky?key=delays&fails=2', undefined, {
      retry: {
        attempts: 3,
        delay,
        onRetry: (attempt, last) => {
          attempts.push(attempt);
          statuses.push(last.status);
        },
      },
    });

    expect(delay.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
    expect(attempts).toEqual([1, 2]);
    expect(statuses).toEqual([500, 500]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('applies instance-wide retry and lets requests override it', async () => {
    const local = create({ baseURL: server.baseURL, retry: 3 });
    await local.get('/flaky?key=instance&fails=10');
    expect(server.hits('/flaky')).toBe(3);

    server.resetHits();
    await local.get('/flaky?key=override&fails=10', undefined, { retry: 1 });
    expect(server.hits('/flaky')).toBe(1);
  });

  it('waits for Retry-After before retrying a 429', async () => {
    const started = Date.now();
    const result = asOk(
      await api.get<{ attempt: number }>('/retry-after?key=seconds&fails=1&after=1', undefined, {
        retry: { attempts: 3 },
      }),
    );
    expect(result.data.attempt).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('honours an HTTP-date Retry-After and rate-limit reset headers', async () => {
    const dated = asOk(
      await api.get<{ attempt: number }>(
        '/retry-after?key=date&fails=1&after=1&date=1',
        undefined,
        {
          retry: { attempts: 3 },
        },
      ),
    );
    expect(dated.data.attempt).toBe(2);
    const started = Date.now();
    const reset = asOk(
      await api.get<{ attempt: number }>(
        '/retry-after?key=reset&fails=1&after=1&header=ratelimit-reset',
        undefined,
        { retry: { attempts: 3 } },
      ),
    );
    expect(reset.data.attempt).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('gives up when Retry-After exceeds maxRetryAfter', async () => {
    const result = asError(
      await api.get('/retry-after?key=too-long&fails=1&after=5', undefined, {
        retry: { attempts: 3, maxRetryAfter: 100 },
      }),
    );
    expect(result.status).toBe(429);
    expect(server.hits('/retry-after')).toBe(1);
  });

  it('ignores server timing when respectRetryAfter is false', async () => {
    const started = Date.now();
    const result = asOk(
      await api.get<{ attempt: number }>('/retry-after?key=ignored&fails=1&after=5', undefined, {
        retry: { attempts: 2, respectRetryAfter: false },
      }),
    );
    expect(result.data.attempt).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('calls onRetry before the delay with the delay it is about to wait', async () => {
    const calls: Array<{ attempt: number; delay: number; status?: number; at: number }> = [];
    await api.get('/flaky?key=on-retry-timing&fails=1', undefined, {
      retry: {
        attempts: 2,
        delay: 150,
        onRetry: (attempt, last, delay) =>
          calls.push({ attempt, delay, status: last.status, at: Date.now() }),
      },
    });
    const finished = Date.now();
    expect(calls).toEqual([expect.objectContaining({ attempt: 1, delay: 150, status: 500 })]);
    expect(finished - calls[0].at).toBeGreaterThanOrEqual(140);
  });

  it('does not retry methods outside the allow-list', async () => {
    await api.post('/flaky?key=methods&fails=10', {}, { retry: { attempts: 3, methods: ['GET'] } });
    expect(server.hits('/flaky')).toBe(1);
  });

  it('retries only the listed status codes', async () => {
    const retry = { attempts: 3, statusCodes: [503] };
    await api.get('/status/500', undefined, { retry });
    expect(server.hits('/status/500')).toBe(1);
    await api.get('/status/503', undefined, { retry });
    expect(server.hits('/status/503')).toBe(3);
  });

  it.todo('does not retry non-idempotent POST requests by default (#11 Phase B, v4.0.0)');

  it('does not retry a cancelled request', async () => {
    const { token, cancel } = createCancelToken();
    const pending = api.get('/flaky?key=cancelled&fails=10', undefined, {
      signal: token,
      retry: { attempts: 3, delay: 10 },
    });
    cancel('stop');
    const result = await pending;
    expect(asError(result).error.kind).toBe('cancel');
    expect(server.hits('/flaky')).toBe(0);
  });
});
