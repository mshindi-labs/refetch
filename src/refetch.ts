import {
  type ApiResponse,
  type RefetchConfig,
  type RefetchInstance,
  type RequestConfig,
  type RequestTransform,
  type AsyncRequestTransform,
  type ResponseTransform,
  type AsyncResponseTransform,
  type Monitor,
  PROBLEM_CODE,
} from './types';
import { DEFAULT_HEADERS } from './constants';
import { createInterceptorManager } from './interceptors';
import { buildUrl } from './url';
import { mergeHeaders } from './headers';
import { prepareRequestBody, shouldHaveBody, getBodyContentType } from './body';
import { fetchWithTimeout } from './fetch';
import {
  parseResponseBody,
  normalizeSuccessResponse,
  normalizeErrorResponse,
} from './response';
import {
  normalizeRetryConfig,
  getRetryDelay,
  shouldRetry,
  sleep,
} from './retry';

export function create(config: RefetchConfig = {}): RefetchInstance {
  const normalizedConfig = { ...config };
  if (normalizedConfig.headers) {
    if (!(normalizedConfig.headers instanceof Headers)) {
      normalizedConfig.headers = new Headers(
        normalizedConfig.headers as HeadersInit,
      );
    }
  } else {
    normalizedConfig.headers = new Headers();
  }

  const state = {
    config: normalizedConfig,
    monitors: [] as Monitor[],
    requestInterceptors: createInterceptorManager<RequestConfig>(),
    responseInterceptors: createInterceptorManager<ApiResponse<unknown>>(),
  };

  // Maps original transform fn → interceptor ID for reference-based removal
  const requestTransformIds = new Map<Function, number>();
  const responseTransformIds = new Map<Function, number>();

  // ─── Interceptor pipeline ───────────────────────────────────────────────

  async function applyRequestInterceptors(
    config: RequestConfig,
  ): Promise<RequestConfig> {
    const handlers = [...state.requestInterceptors.getAll()].reverse(); // LIFO
    if (handlers.length === 0) return config;
    let chain = Promise.resolve(config);
    for (const handler of handlers) {
      chain = chain.then(handler.onFulfilled, handler.onRejected);
    }
    return chain;
  }

  async function applyResponseInterceptors<T>(
    response: ApiResponse<T>,
  ): Promise<ApiResponse<T>> {
    const handlers = state.responseInterceptors.getAll(); // FIFO
    if (handlers.length === 0) return response;
    let chain = Promise.resolve(response as ApiResponse<unknown>);
    for (const handler of handlers) {
      chain = chain.then(handler.onFulfilled, handler.onRejected);
    }
    try {
      return (await chain) as ApiResponse<T>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return normalizeErrorResponse<T>(err, undefined, response.duration);
    }
  }

  function notifyMonitors<T>(response: ApiResponse<T>): void {
    state.monitors.forEach((monitor) => {
      try {
        monitor(response);
      } catch (error) {
        console.error('Monitor error:', error);
      }
    });
  }

  // ─── Single attempt ─────────────────────────────────────────────────────

  async function executeSingleRequest<T>(
    config: RequestConfig,
    startTime: number,
  ): Promise<ApiResponse<T>> {
    try {
      const url = config.url ?? '';
      const fullUrl = buildUrl(
        config.baseURL || state.config.baseURL,
        url,
        config.params,
      );

      const body = shouldHaveBody(config.method ?? 'GET')
        ? prepareRequestBody(config.data)
        : undefined;

      // Always merge Accept from defaults; Content-Type is set per body type below
      const headers = mergeHeaders(
        DEFAULT_HEADERS,
        state.config.headers,
        config.headers,
      );

      const bodyContentType = getBodyContentType(body);
      if (bodyContentType === null) {
        // FormData: browser must set Content-Type with multipart boundary
        headers.delete('Content-Type');
      } else if (bodyContentType !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', bodyContentType);
      }

      const fetchConfig: RequestInit & { timeout?: number } = {
        ...config,
        method: config.method,
        headers,
        body,
        timeout: config.timeout || state.config.timeout,
      };

      const response = await fetchWithTimeout(fullUrl, fetchConfig);
      const duration = Date.now() - startTime;

      const data = await parseResponseBody<T>(response);

      let apiResponse: ApiResponse<T>;
      if (response.ok) {
        apiResponse = normalizeSuccessResponse(data as T, response, duration);
      } else {
        const error = new Error(
          `HTTP ${config.method} ${fullUrl} failed with status ${response.status}: ${response.statusText}`,
        );
        apiResponse = normalizeErrorResponse<T>(error, response, duration);
        apiResponse.data = data as T;
      }

      apiResponse = await applyResponseInterceptors(apiResponse);
      notifyMonitors(apiResponse);
      return apiResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      let apiResponse = normalizeErrorResponse<T>(
        error as Error,
        undefined,
        duration,
      );
      apiResponse = await applyResponseInterceptors(apiResponse);
      notifyMonitors(apiResponse);
      return apiResponse;
    }
  }

  // ─── Core request (with retry) ──────────────────────────────────────────

  async function request<T = unknown>(
    method: string,
    url: string,
    dataOrParams?: unknown,
    requestConfig: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    const startTime = Date.now();

    let config: RequestConfig = {
      ...state.config,
      ...requestConfig,
      url,
      method: method.toUpperCase(),
    };

    if (shouldHaveBody(method)) {
      config.data = dataOrParams;
    } else {
      config.params = dataOrParams as Record<string, unknown> | undefined;
    }

    // Request interceptors run once before any retry
    config = await applyRequestInterceptors(config);

    const retryConfig = normalizeRetryConfig(
      config.retry ?? state.config.retry,
    );
    let attempt = 0;
    let lastResponse!: ApiResponse<T>;

    do {
      if (attempt > 0 && retryConfig) {
        await sleep(getRetryDelay(retryConfig, attempt));
        retryConfig.onRetry?.(attempt, lastResponse);
      }
      lastResponse = await executeSingleRequest<T>(config, startTime);
      attempt++;
    } while (
      retryConfig !== null &&
      attempt < retryConfig.attempts &&
      shouldRetry(lastResponse, retryConfig)
    );

    return lastResponse;
  }

  // ─── HTTP method wrappers ────────────────────────────────────────────────

  function get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('GET', url, params, config);
  }

  function post<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>> {
    return request<TResponse>('POST', url, data, config);
  }

  function put<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>> {
    return request<TResponse>('PUT', url, data, config);
  }

  function patch<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>> {
    return request<TResponse>('PATCH', url, data, config);
  }

  function deleteRequest<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('DELETE', url, params, config);
  }

  function head<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('HEAD', url, params, config);
  }

  function link<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('LINK', url, params, config);
  }

  function unlink<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('UNLINK', url, params, config);
  }

  function any<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>> {
    const method = config.method || 'GET';
    const url = config.url || '/';
    const dataOrParams = shouldHaveBody(method) ? config.data : config.params;
    return request<T>(method, url, dataOrParams, config);
  }

  // ─── Streaming ──────────────────────────────────────────────────────────

  async function stream<T = Uint8Array>(
    url: string,
    params?: Record<string, unknown>,
    config: RequestConfig = {},
  ): Promise<ApiResponse<ReadableStream<T>>> {
    const startTime = Date.now();

    let mergedConfig: RequestConfig = {
      ...state.config,
      ...config,
      url,
      method: 'GET',
      params,
    };

    mergedConfig = await applyRequestInterceptors(mergedConfig);

    const fullUrl = buildUrl(
      mergedConfig.baseURL || state.config.baseURL,
      mergedConfig.url || url,
      mergedConfig.params,
    );

    const headers = mergeHeaders(
      DEFAULT_HEADERS,
      state.config.headers,
      mergedConfig.headers,
    );

    try {
      const response = await fetchWithTimeout(fullUrl, {
        ...mergedConfig,
        method: 'GET',
        headers,
        timeout: mergedConfig.timeout ?? state.config.timeout,
      });
      const duration = Date.now() - startTime;

      if (!response.ok) {
        const error = new Error(
          `HTTP GET ${fullUrl} failed with status ${response.status}: ${response.statusText}`,
        );
        return normalizeErrorResponse(
          error,
          response,
          duration,
        ) as ApiResponse<ReadableStream<T>>;
      }

      if (!response.body) {
        const error = new Error(
          'Response body is null — streaming not supported in this environment',
        );
        return normalizeErrorResponse(
          error,
          response,
          duration,
        ) as ApiResponse<ReadableStream<T>>;
      }

      return normalizeSuccessResponse(
        response.body as ReadableStream<T>,
        response,
        duration,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      return normalizeErrorResponse(
        error as Error,
        undefined,
        duration,
      ) as ApiResponse<ReadableStream<T>>;
    }
  }

  // ─── Transform aliases (backward compat) ────────────────────────────────

  function addRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Request transform must be a function');
    }
    const id = state.requestInterceptors.use(async (config) => {
      await transform(config);
      return config;
    });
    requestTransformIds.set(transform, id);
  }

  function addResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Response transform must be a function');
    }
    const id = state.responseInterceptors.use(async (response) => {
      await (transform as ResponseTransform)(response);
      return response;
    });
    responseTransformIds.set(transform, id);
  }

  function removeRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): boolean {
    const id = requestTransformIds.get(transform);
    if (id !== undefined) {
      state.requestInterceptors.eject(id);
      requestTransformIds.delete(transform);
      return true;
    }
    return false;
  }

  function removeResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): boolean {
    const id = responseTransformIds.get(transform);
    if (id !== undefined) {
      state.responseInterceptors.eject(id);
      responseTransformIds.delete(transform);
      return true;
    }
    return false;
  }

  function clearRequestTransforms(): void {
    requestTransformIds.forEach((id) => state.requestInterceptors.eject(id));
    requestTransformIds.clear();
  }

  function clearResponseTransforms(): void {
    responseTransformIds.forEach((id) => state.responseInterceptors.eject(id));
    responseTransformIds.clear();
  }

  // ─── Monitors ───────────────────────────────────────────────────────────

  function addMonitor(monitor: Monitor): void {
    if (typeof monitor !== 'function') {
      throw new TypeError('Monitor must be a function');
    }
    state.monitors.push(monitor);
  }

  function removeMonitor(monitor: Monitor): boolean {
    const index = state.monitors.indexOf(monitor);
    if (index > -1) {
      state.monitors.splice(index, 1);
      return true;
    }
    return false;
  }

  function clearMonitors(): void {
    state.monitors = [];
  }

  // ─── Header / URL helpers ────────────────────────────────────────────────

  function setHeader(name: string, value: string): void {
    (state.config.headers as Headers).set(name, value);
  }

  function setHeaders(headers: Record<string, string>): void {
    Object.entries(headers).forEach(([name, value]) => setHeader(name, value));
  }

  function deleteHeader(name: string): void {
    (state.config.headers as Headers).delete(name);
  }

  function setBaseURL(baseURL: string): void {
    state.config.baseURL = baseURL;
  }

  function getBaseURL(): string | undefined {
    return state.config.baseURL;
  }

  // ─── Public instance ─────────────────────────────────────────────────────

  return {
    get config(): Readonly<RefetchConfig> {
      return { ...state.config };
    },
    interceptors: {
      request: state.requestInterceptors,
      response: state.responseInterceptors,
    },
    get,
    post,
    put,
    patch,
    delete: deleteRequest,
    head,
    link,
    unlink,
    any,
    stream,
    addRequestTransform,
    addResponseTransform,
    addMonitor,
    removeRequestTransform,
    removeResponseTransform,
    removeMonitor,
    clearRequestTransforms,
    clearResponseTransforms,
    clearMonitors,
    setHeader,
    setHeaders,
    deleteHeader,
    setBaseURL,
    getBaseURL,
  };
}
