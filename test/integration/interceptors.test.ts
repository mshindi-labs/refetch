import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  type Monitor,
  PROBLEM_CODE,
  type RefetchInstance,
  type RequestConfig,
  type RequestTransform,
  type ResponseTransform,
  setRequestHeader,
} from '../../src/index';
import { asError, asOk } from '../helpers/assert';
import { type EchoPayload, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let api: RefetchInstance;

beforeAll(async () => {
  server = await startTestServer();
  api = create({ baseURL: server.baseURL });
});

afterAll(() => server.close());

beforeEach(() => server.resetHits());

const plainHeaders = (config: RequestConfig): Record<string, string> =>
  (config.headers as Record<string, string> | undefined) ?? {};

describe('request interceptors', () => {
  it('run last-registered first (LIFO) and can rewrite the config', async () => {
    const order: string[] = [];
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use((config) => {
      order.push('first');
      return { ...config, headers: { ...plainHeaders(config), 'X-First': '1' } };
    });
    local.interceptors.request.use((config) => {
      order.push('second');
      return { ...config, headers: { ...plainHeaders(config), 'X-Second': '2' } };
    });

    const result = asOk(await local.get<EchoPayload>('/echo'));
    expect(order).toEqual(['second', 'first']);
    expect(result.data.headers['x-first']).toBe('1');
    expect(result.data.headers['x-second']).toBe('2');
  });

  it('receive the merged instance and request headers as a lower-cased plain object', async () => {
    const local = create({ baseURL: server.baseURL, headers: { 'X-Instance': 'i' } });
    let seen: unknown;
    local.interceptors.request.use((config) => {
      seen = config.headers;
      return config;
    });
    await local.get('/json', undefined, { headers: new Headers({ 'X-Request': 'r' }) });
    expect(seen).toEqual({ 'x-instance': 'i', 'x-request': 'r' });
  });

  it('can drop an instance header for one request', async () => {
    const local = create({
      baseURL: server.baseURL,
      headers: { Authorization: 'Bearer instance' },
    });
    local.interceptors.request.use((config) => {
      const headers = { ...(config.headers as Record<string, string>) };
      delete headers.authorization;
      return { ...config, headers };
    });
    const echo = asOk(await local.get<EchoPayload>('/echo')).data;
    expect(echo.headers.authorization).toBeUndefined();
  });

  it('can short-circuit with a response, which still reaches response interceptors and monitors', async () => {
    const local = create({ baseURL: server.baseURL });
    const monitor = vi.fn();
    local.addMonitor(monitor);
    local.interceptors.response.use((response) => ({ ...response, data: { seen: response.data } }));
    local.interceptors.request.use((config) =>
      config.url === '/json'
        ? {
            response: {
              ok: true,
              problem: null,
              originalError: null,
              status: 200,
              data: { cached: true },
            },
          }
        : config,
    );
    const result = asOk(await local.get('/json', undefined, { retry: 3 }));
    expect(result.data).toEqual({ seen: { cached: true } });
    expect(result.request).toMatchObject({ method: 'GET', attempt: 0 });
    expect(monitor).toHaveBeenCalledOnce();
    expect(server.hits('/json')).toBe(0);
    await local.get('/echo');
    expect(server.hits('/echo')).toBe(1);
  });

  it('supports the 401 refresh pattern with public API only', async () => {
    let token = 'stale';
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use((config) =>
      setRequestHeader(config, 'Authorization', `Bearer ${token}`),
    );
    local.interceptors.response.use(async (response) => {
      if (
        response.status !== 401 ||
        !response.request ||
        response.request.config.context?.refreshed
      ) {
        return response;
      }
      token = 'fresh';
      return local.any({ ...response.request.config, context: { refreshed: true } });
    });
    const result = asOk(await local.get<{ secret: boolean }>('/needs-token'));
    expect(result.data).toEqual({ secret: true });
    expect(result.request?.config.context).toEqual({ refreshed: true });
    expect(server.hits('/needs-token')).toBe(2);
  });

  it('attach a request to interceptor failures too', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use(() => {
      throw new Error('boom');
    });
    const result = asError(await local.get('/json', { a: 1 }));
    expect(result.request).toMatchObject({ method: 'GET', attempt: 0 });
    expect(result.request?.config.params).toEqual({ a: 1 });
  });

  it('support async handlers', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use(async (config) => {
      await Promise.resolve();
      return { ...config, headers: { 'X-Async': 'yes' } };
    });
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-async']).toBe('yes');
  });

  it('run once per request even when retries happen', async () => {
    const local = create({ baseURL: server.baseURL });
    const handler = vi.fn((config: RequestConfig) => config);
    local.interceptors.request.use(handler);

    await local.get('/flaky?key=once&fails=2', undefined, { retry: { attempts: 3 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(server.hits('/flaky')).toBe(3);
  });

  it('can be ejected by id and cleared', async () => {
    const local = create({ baseURL: server.baseURL });
    const id = local.interceptors.request.use((config) => ({
      ...config,
      headers: { 'X-Tag': 'on' },
    }));
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-tag']).toBe('on');

    local.interceptors.request.eject(id);
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-tag']).toBeUndefined();

    local.interceptors.request.use((config) => ({ ...config, headers: { 'X-Tag': 'again' } }));
    local.interceptors.request.clear();
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-tag']).toBeUndefined();
  });

  it('turn a throwing request interceptor into an error response', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use(() => {
      throw new Error('boom');
    });
    const result = asError(await local.get('/json'));
    expect(result.problem).toBe(PROBLEM_CODE.UNKNOWN_ERROR);
    expect(result.error.kind).toBe('unknown');
    expect(result.originalError?.message).toBe('boom');
    expect(server.hits('/json')).toBe(0);
  });

  it('turn a rejecting async request interceptor into an error response and notify monitors', async () => {
    const local = create({ baseURL: server.baseURL });
    const monitor = vi.fn();
    local.addMonitor(monitor);
    local.interceptors.request.use(async () => {
      throw new Error('token fetch failed');
    });
    const result = asError(await local.get('/json'));
    expect(result.originalError?.message).toBe('token fetch failed');
    expect(result.error.kind).toBe('unknown');
    expect(result.duration).toBeTypeOf('number');
    expect(monitor).toHaveBeenCalledOnce();
    expect(server.hits('/json')).toBe(0);
  });

  it('apply the same contract to stream()', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.request.use(() => {
      throw new Error('nope');
    });
    const result = asError(await local.stream('/stream'));
    expect(result.originalError?.message).toBe('nope');
    expect(server.hits('/stream')).toBe(0);
  });
});

describe('response interceptors', () => {
  it('run in registration order (FIFO) and can replace the response', async () => {
    const order: string[] = [];
    const local = create({ baseURL: server.baseURL });
    local.interceptors.response.use((response) => {
      order.push('a');
      return { ...response, data: { wrapped: response.data } };
    });
    local.interceptors.response.use((response) => {
      order.push('b');
      return response;
    });

    expect(asOk(await local.get('/json')).data).toEqual({ wrapped: { ok: true } });
    expect(order).toEqual(['a', 'b']);
  });

  it('run for every attempt when retrying', async () => {
    const local = create({ baseURL: server.baseURL });
    const seen: (number | undefined)[] = [];
    local.interceptors.response.use((response) => {
      seen.push(response.status);
      return response;
    });

    await local.get('/flaky?key=per-attempt&fails=2', undefined, { retry: { attempts: 3 } });
    expect(seen).toEqual([500, 500, 200]);
  });

  it('normalise a throwing response interceptor into an error response', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.response.use(() => {
      throw new Error('nope');
    });
    const result = asError(await local.get('/json'));
    expect(result.problem).toBe(PROBLEM_CODE.UNKNOWN_ERROR);
    expect(result.originalError?.message).toBe('nope');
  });

  it('receive error responses and can recover them', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.response.use((response) =>
      response.status === 404
        ? { ...response, ok: true, problem: null, data: { recovered: true } }
        : response,
    );
    expect(asOk(await local.get('/status/404')).data).toEqual({ recovered: true });
  });

  it('pass errors thrown earlier in the chain to onRejected handlers', async () => {
    const local = create({ baseURL: server.baseURL });
    local.interceptors.response.use(() => {
      throw new Error('first');
    });
    local.interceptors.response.use(undefined, (error) => ({
      ok: true,
      problem: null,
      originalError: null,
      status: 200,
      data: { rescued: (error as Error).message },
    }));
    expect(asOk(await local.get('/json')).data).toEqual({ rescued: 'first' });
  });
});

describe('monitors', () => {
  it('observe every attempt and survive throwing monitors', async () => {
    const local = create({ baseURL: server.baseURL });
    const seen: (number | undefined)[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    local.addMonitor(() => {
      throw new Error('monitor boom');
    });
    local.addMonitor((response) => {
      seen.push(response.status);
    });

    const result = await local.get('/flaky?key=monitor&fails=1', undefined, { retry: 2 });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([500, 200]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('can be removed and cleared', async () => {
    const local = create({ baseURL: server.baseURL });
    const first = vi.fn();
    const second = vi.fn();
    local.addMonitor(first);
    local.addMonitor(second);

    expect(local.removeMonitor(first)).toBe(true);
    expect(local.removeMonitor(first)).toBe(false);
    await local.get('/json');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    local.clearMonitors();
    await local.get('/json');
    expect(second).toHaveBeenCalledOnce();
  });

  it('rejects non-function monitors', () => {
    expect(() => api.addMonitor('nope' as unknown as Monitor)).toThrow(TypeError);
  });
});

describe('deprecated transforms', () => {
  it('mutate the request config and the response in place', async () => {
    const local = create({ baseURL: server.baseURL });
    local.addRequestTransform((config) => {
      config.headers = { ...plainHeaders(config), 'X-Transform': 't' };
    });
    local.addResponseTransform((response) => {
      Object.assign(response, { data: { ...(response.data as object), transformed: true } });
    });

    const result = asOk(await local.get<EchoPayload & { transformed: boolean }>('/echo'));
    expect(result.data.headers['x-transform']).toBe('t');
    expect(result.data.transformed).toBe(true);
  });

  it('support async transforms', async () => {
    const local = create({ baseURL: server.baseURL });
    local.addRequestTransform(async (config) => {
      await Promise.resolve();
      config.headers = { 'X-Async': 'yes' };
    });
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-async']).toBe('yes');
  });

  it('can be removed by reference and cleared', async () => {
    const local = create({ baseURL: server.baseURL });
    const transform = (config: RequestConfig) => {
      config.headers = { 'X-Transform': 't' };
    };

    local.addRequestTransform(transform);
    expect(local.removeRequestTransform(transform)).toBe(true);
    expect(local.removeRequestTransform(transform)).toBe(false);
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-transform']).toBeUndefined();

    local.addRequestTransform(transform);
    local.clearRequestTransforms();
    expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-transform']).toBeUndefined();

    const responseTransform: ResponseTransform = () => undefined;
    local.addResponseTransform(responseTransform);
    expect(local.removeResponseTransform(responseTransform)).toBe(true);
    local.addResponseTransform(responseTransform);
    local.clearResponseTransforms();
    expect(local.removeResponseTransform(responseTransform)).toBe(false);
  });

  it('reject non-function transforms', () => {
    expect(() => api.addRequestTransform('nope' as unknown as RequestTransform)).toThrow(TypeError);
    expect(() => api.addResponseTransform(1 as unknown as ResponseTransform)).toThrow(TypeError);
  });
});

describe('instance configuration', () => {
  it('exposes a read-only snapshot of the config with normalised headers', () => {
    const local = create({ baseURL: 'https://a.test', timeout: 5 });
    expect(local.config.baseURL).toBe('https://a.test');
    expect(local.config.timeout).toBe(5);
    expect(local.config.headers).toBeInstanceOf(Headers);
    expect(local.config).not.toBe(local.config);
  });

  it('setBaseURL and getBaseURL change where requests go', async () => {
    const local = create({ baseURL: 'http://127.0.0.1:1' });
    local.setBaseURL(server.baseURL);
    expect(local.getBaseURL()).toBe(server.baseURL);
    expect(asOk(await local.get('/json')).data).toEqual({ ok: true });
  });

  it('normalises instance headers given as objects, tuples or Headers', async () => {
    const variants: HeadersInit[] = [{ 'X-H': 'v' }, [['X-H', 'v']], new Headers({ 'X-H': 'v' })];
    for (const headers of variants) {
      const local = create({ baseURL: server.baseURL, headers });
      expect(asOk(await local.get<EchoPayload>('/echo')).data.headers['x-h']).toBe('v');
    }
  });
});
