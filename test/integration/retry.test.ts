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

  it.todo('does not retry non-idempotent POST requests by default (#11 Phase B, v4.0.0)');

  // Known bug #3 — a cancelled attempt is retried, and the retries reach the server.
  it.fails('does not retry a cancelled request (known bug #3)', async () => {
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
