import { describe, expect, it, vi } from 'vitest';
import { mergeHeaders } from '../../src/headers';
import type { InternalInterceptorManager } from '../../src/interceptors';
import { withAuth, withBaseURL, withHeaders, withLogging, withTimeout } from '../../src/middleware';
import { create } from '../../src/refetch';
import {
  type ApiResponse,
  PROBLEM_CODE,
  type RefetchInstance,
  type RequestConfig,
} from '../../src/types';

const requestHandlers = (api: RefetchInstance) =>
  (api.interceptors.request as InternalInterceptorManager<RequestConfig>).getAll();

const responseHandlers = (api: RefetchInstance) =>
  (api.interceptors.response as InternalInterceptorManager<ApiResponse<unknown>>).getAll();

/** Runs the registered request interceptors in registration order against a config. */
async function runRequest(api: RefetchInstance, config: RequestConfig): Promise<RequestConfig> {
  let current = config;
  for (const handler of requestHandlers(api)) {
    current = handler.onFulfilled ? await handler.onFulfilled(current) : current;
  }
  return current;
}

describe('withTimeout', () => {
  it('sets the timeout on every request config', async () => {
    const api = withTimeout(1234)(create());
    expect(await runRequest(api, { url: '/x' })).toMatchObject({ timeout: 1234 });
  });
});

describe('withHeaders', () => {
  it.each([
    ['a plain object', { 'X-A': '1' } as HeadersInit],
    ['a Headers instance', new Headers({ 'X-A': '1' })],
    ['tuples', [['X-A', '1']] as [string, string][]],
  ])('merges %s into the request headers', async (_label, headers) => {
    const api = withHeaders(headers)(create());
    const result = await runRequest(api, { url: '/x', headers: { 'X-B': '2' } });
    const merged = mergeHeaders(result.headers);
    expect(merged.get('x-a')).toBe('1');
    expect(merged.get('x-b')).toBe('2');
  });
});

describe('withBaseURL', () => {
  it('overrides the instance baseURL and returns the same instance', () => {
    const api = create({ baseURL: 'https://a.test' });
    expect(withBaseURL('https://b.test')(api)).toBe(api);
    expect(api.getBaseURL()).toBe('https://b.test');
  });
});

describe('withAuth', () => {
  it('adds a bearer token, calling getToken for every request', async () => {
    const getToken = vi.fn(async () => 'T');
    const api = withAuth(getToken)(create());
    await runRequest(api, { url: '/x' });
    const result = await runRequest(api, { url: '/x' });
    expect(mergeHeaders(result.headers).get('authorization')).toBe('Bearer T');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('keeps existing plain-object headers', async () => {
    const api = withAuth(() => 'T')(create());
    const result = await runRequest(api, { url: '/x', headers: { 'X-Foo': 'bar' } });
    expect(mergeHeaders(result.headers).get('x-foo')).toBe('bar');
  });

  it('keeps per-request headers given as tuples', async () => {
    const api = withAuth(() => 'T')(create());
    const result = await runRequest(api, { url: '/x', headers: [['X-Foo', 'bar']] });
    expect(mergeHeaders(result.headers).get('x-foo')).toBe('bar');
    expect(mergeHeaders(result.headers).get('authorization')).toBe('Bearer T');
  });

  it('keeps per-request headers given as a Headers instance', async () => {
    const api = withAuth(() => 'T')(create());
    const result = await runRequest(api, { url: '/x', headers: new Headers({ 'X-Foo': 'bar' }) });
    expect(mergeHeaders(result.headers).get('x-foo')).toBe('bar');
  });
});

describe('withLogging', () => {
  it('logs requests and ok responses, and warns on failures', async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const api = withLogging(logger)(create());

    await runRequest(api, { url: '/x', method: 'post' });
    expect(logger.log).toHaveBeenCalledWith('[refetch] → POST /x');

    const [handler] = responseHandlers(api);
    await handler.onFulfilled?.({
      ok: true,
      problem: null,
      originalError: null,
      status: 200,
      duration: 5,
    });
    await handler.onFulfilled?.({
      ok: false,
      problem: PROBLEM_CODE.SERVER_ERROR,
      originalError: null,
      status: 500,
      duration: 7,
    });
    expect(logger.log).toHaveBeenCalledWith('[refetch] ← 200 (5ms)');
    expect(logger.warn).toHaveBeenCalledWith('[refetch] ← 500 SERVER_ERROR (7ms)');
  });
});
