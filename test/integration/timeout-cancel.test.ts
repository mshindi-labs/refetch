import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CancelError,
  create,
  createCancelToken,
  PROBLEM_CODE,
  type RefetchInstance,
  TimeoutError,
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

beforeEach(() => server.resetHits());

describe('timeouts', () => {
  it('aborts requests whose headers take longer than the timeout', async () => {
    const result = asError(await api.get('/slow-headers?ms=800', undefined, { timeout: 100 }));
    expect(result.status).toBeUndefined();
    expect(result.duration).toBeLessThan(600);
    expect(result.originalError).toBeInstanceOf(TimeoutError);
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

  it('classifies the built-in timeout as TIMEOUT_ERROR', async () => {
    const result = asError(await api.get('/slow-headers?ms=800', undefined, { timeout: 100 }));
    expect(result.problem).toBe(PROBLEM_CODE.TIMEOUT_ERROR);
    expect(result.error.kind).toBe('timeout');
  });

  it('bounds the body read by the timeout', async () => {
    const pending = Symbol('pending');
    const result = await Promise.race([
      api.get('/slow-body?ms=600', undefined, { timeout: 100 }),
      delay(300).then(() => pending),
    ]);
    expect(result).not.toBe(pending);
  });

  it('lets timeout: 0 disable the instance timeout', async () => {
    const local = create({ baseURL: server.baseURL, timeout: 100 });
    const result = asOk(await local.get('/slow-headers?ms=300', undefined, { timeout: 0 }));
    expect(result.data).toEqual({ slow: true });
  });

  it('lets timeout: false disable the instance timeout', async () => {
    const local = create({ baseURL: server.baseURL, timeout: 100 });
    const result = asOk(await local.get('/slow-headers?ms=300', undefined, { timeout: false }));
    expect(result.data).toEqual({ slow: true });
  });

  it('rejects invalid timeout values up front', async () => {
    await expect(api.get('/json', undefined, { timeout: -1 })).rejects.toThrow(TypeError);
    await expect(api.get('/json', undefined, { totalTimeout: Number.NaN })).rejects.toThrow(
      TypeError,
    );
  });

  it('totalTimeout bounds the whole request including retries and back-off', async () => {
    const started = Date.now();
    const result = asError(
      await api.get('/status/500', undefined, {
        retry: { attempts: 10, delay: 100 },
        totalTimeout: 250,
      }),
    );
    expect(Date.now() - started).toBeLessThan(600);
    expect(result.problem).toBe(PROBLEM_CODE.TIMEOUT_ERROR);
    expect(result.error.kind).toBe('timeout');
    expect((result.originalError as TimeoutError).scope).toBe('total');
    expect(server.hits('/status/500')).toBeLessThanOrEqual(3);
  });

  it('applies an instance-wide totalTimeout', async () => {
    const local = create({ baseURL: server.baseURL, totalTimeout: 100 });
    const result = asError(await local.get('/slow-headers?ms=800'));
    expect(result.error.kind).toBe('timeout');
    expect(result.duration).toBeLessThan(600);
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

  it('does not attach listeners to the caller signal when AbortSignal.any is available', async () => {
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    await api.get('/json', undefined, { signal: controller.signal });
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('cancelling during retry back-off returns immediately with kind cancel', async () => {
    const { token, cancel } = createCancelToken();
    const started = Date.now();
    const pending = api.get('/status/500', undefined, {
      signal: token,
      retry: { attempts: 3, delay: 1000 },
    });
    setTimeout(() => cancel('enough'), 50);

    const result = asError(await pending);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.error).toMatchObject({ kind: 'cancel', reason: 'enough' });
    expect(server.hits('/status/500')).toBe(1);
  });

  it('works end-to-end without AbortSignal.any (fallback path)', async () => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const controller = new AbortController();
      controller.abort();
      const pre = await api.get('/json', undefined, { signal: controller.signal });
      expect(asError(pre).error.kind).toBe('cancel');
      const timed = asError(await api.get('/slow-headers?ms=800', undefined, { timeout: 50 }));
      expect(timed.error.kind).toBe('timeout');
    } finally {
      Object.defineProperty(AbortSignal, 'any', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await api.get('/json', undefined, { signal: controller.signal });
    expect(asError(result).error.kind).toBe('cancel');
    expect(server.hits('/json')).toBe(0);
  });
});
