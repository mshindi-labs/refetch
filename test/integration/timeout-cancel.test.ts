import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CancelError,
  create,
  createCancelToken,
  PROBLEM_CODE,
  type RefetchInstance,
} from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

describe('timeouts', () => {
  it('aborts requests whose headers take longer than the timeout', async () => {
    const result = asError(await api.get('/slow-headers?ms=800', undefined, { timeout: 100 }));
    expect(result.status).toBeUndefined();
    expect(result.duration).toBeLessThan(600);
    expect(result.originalError?.message).toBe('Request timeout');
  });

  it('uses the instance timeout by default', async () => {
    const local = create({ baseURL: server.baseURL, timeout: 100 });
    const result = asError(await local.get('/slow-headers?ms=800'));
    expect(result.duration).toBeLessThan(600);
  });

  it('treats AbortSignal.timeout() reasons as timeouts', async () => {
    const result = asError(
      await api.get('/slow-headers?ms=800', undefined, { signal: AbortSignal.timeout(50) }),
    );
    expect(result.problem).toBe(PROBLEM_CODE.TIMEOUT_ERROR);
    expect(result.error.kind).toBe('timeout');
  });

  // Known bug #2 — the built-in timeout is reported as UNKNOWN_ERROR.
  it.fails('classifies the built-in timeout as TIMEOUT_ERROR (known bug #2)', async () => {
    const result = asError(await api.get('/slow-headers?ms=800', undefined, { timeout: 100 }));
    expect(result.problem).toBe(PROBLEM_CODE.TIMEOUT_ERROR);
    expect(result.error.kind).toBe('timeout');
  });

  // Known bug #4 — the timer is cleared once headers arrive, so body reads are unbounded.
  it.fails('bounds the body read by the timeout (known bug #4)', async () => {
    const pending = Symbol('pending');
    const result = await Promise.race([
      api.get('/slow-body?ms=600', undefined, { timeout: 100 }),
      delay(300).then(() => pending),
    ]);
    expect(result).not.toBe(pending);
  });

  // Known bug #4 — `timeout: 0` falls back to the instance timeout.
  it.fails('lets timeout: 0 disable the instance timeout (known bug #4)', async () => {
    const local = create({ baseURL: server.baseURL, timeout: 100 });
    const result = asOk(await local.get('/slow-headers?ms=300', undefined, { timeout: 0 }));
    expect(result.data).toEqual({ slow: true });
  });
});

describe('cancellation', () => {
  it('reports cancellation with the reason from createCancelToken', async () => {
    const { token, cancel } = createCancelToken();
    const pending = api.get('/slow-headers?ms=800', undefined, { signal: token });
    setTimeout(() => cancel('navigated away'), 20);

    const result = asError(await pending);
    expect(result.problem).toBe(PROBLEM_CODE.CANCEL_ERROR);
    expect(result.error).toMatchObject({ kind: 'cancel', reason: 'navigated away' });
    expect(result.originalError).toBeInstanceOf(CancelError);
  });

  it('reports plain AbortController aborts as cancellations', async () => {
    const controller = new AbortController();
    const pending = api.get('/slow-headers?ms=800', undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(asError(await pending).error.kind).toBe('cancel');
  });

  it('removes its abort listener once the request settles', async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    await api.get('/json', undefined, { signal: controller.signal });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  // Known bug #3 — an already-aborted signal is ignored and the request is sent.
  it.fails('rejects immediately when the signal is already aborted (known bug #3)', async () => {
    server.resetHits();
    const controller = new AbortController();
    controller.abort();
    const result = await api.get('/json', undefined, { signal: controller.signal });
    expect(asError(result).error.kind).toBe('cancel');
    expect(server.hits('/json')).toBe(0);
  });
});
