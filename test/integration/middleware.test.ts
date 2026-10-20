import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  create,
  pipe,
  withAuth,
  withBaseURL,
  withHeaders,
  withLogging,
  withTimeout,
} from '../../src/index';
import { asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(() => server.close());

describe('middleware over the wire', () => {
  it('withAuth injects a fresh bearer token for every request', async () => {
    let calls = 0;
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(async () => `token-${++calls}`),
    );
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers.authorization).toBe(
      'Bearer token-1',
    );
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers.authorization).toBe(
      'Bearer token-2',
    );
  });

  it('composes several middlewares with pipe', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withHeaders({ 'X-App': 'refetch' }),
      withTimeout(100),
      withLogging(logger),
    );

    const ok = asOk(await local.get<EchoPayload>('/echo'));
    expect(ok.data.headers['x-app']).toBe('refetch');
    expect(logger.log).toHaveBeenCalledWith('[refetch] → GET /echo');
    expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/^\[refetch\] ← 200 \(\d+ms\)$/));

    const slow = await local.get('/slow-headers?ms=800');
    expect(slow.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('withBaseURL points an instance at another server', async () => {
    const local = pipe(create({ baseURL: 'http://127.0.0.1:1' }), withBaseURL(server.baseURL));
    expect(asOk(await local.get('/json')).data).toEqual({ ok: true });
  });

  // Known bug #8 — per-request Headers instances are dropped by withAuth.
  it.fails('withAuth keeps per-request Headers instances (known bug #8)', async () => {
    const local = pipe(
      create({ baseURL: server.baseURL }),
      withAuth(() => 'T'),
    );
    const result = asOk(
      await local.get<EchoPayload>('/echo', undefined, {
        headers: new Headers({ 'X-Foo': 'bar' }),
      }),
    );
    expect(result.data.headers['x-foo']).toBe('bar');
    expect(result.data.headers.authorization).toBe('Bearer T');
  });
});
