import { getBodyContentType, prepareRequestBody, shouldHaveBody } from './body';
import { DEFAULT_HEADERS } from './constants';
import { CancelError, NetworkError, ParseError, TimeoutError } from './errors';
import { type AttemptSignal, createAttemptSignal, resolveTimeout } from './fetch';
import { headersToObject, mergeHeaders } from './headers';
import { createInterceptorManager } from './interceptors';
import { normalizeErrorResponse, normalizeSuccessResponse, parseResponseBody } from './response';
import { getRetryDelay, normalizeRetryConfig, shouldRetry, sleep } from './retry';
import type {
  ApiResponse,
  AsyncRequestTransform,
  AsyncResponseTransform,
  Monitor,
  QueryParams,
  RefetchConfig,
  RefetchInstance,
  RequestConfig,
  RequestTransform,
  ResponseTransform,
} from './types';
import { buildUrl } from './url';

/** Config keys that belong to refetch and must not reach `fetch()`. */
const REFETCH_KEYS = [
  'url',
  'method',
  'params',
  'paramsSerializer',
  'data',
  'timeout',
  'totalTimeout',
  'baseURL',
  'retry',
  'signal',
  'headers',
] as const;

function toRequestInit(config: RequestConfig): RequestInit {
  const init: Record<string, unknown> = { ...config };
  for (const key of REFETCH_KEYS) delete init[key];
  return init as RequestInit;
}

function isStream(value: unknown): value is ReadableStream {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Turns whatever aborted a signal into an Error the classifier understands. */
function abortReasonToError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new CancelError(typeof reason === 'string' ? reason : undefined);
}

/**
 * Picks the error to report for a failed attempt: the abort reason when the attempt was
 * aborted (timeout, cancellation, total deadline), a NetworkError for transport failures
 * thrown by `fetch` itself, and the raw error otherwise.
 */
function resolveFailure(error: unknown, signal: AbortSignal, fromTransport: boolean): Error {
  if (signal.aborted) return abortReasonToError(signal.reason);
  if (fromTransport && error instanceof TypeError && !(error instanceof NetworkError)) {
    return new NetworkError(error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

interface Deadline {
  readonly signal: AbortSignal | undefined;
  dispose(): void;
}

function createDeadline(totalTimeout: number | false): Deadline {
  if (totalTimeout === false) return { signal: undefined, dispose: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new TimeoutError(totalTimeout, 'total')),
    totalTimeout,
  );
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

export function create(config: RefetchConfig = {}): RefetchInstance {
  const normalizedConfig = { ...config };
  if (normalizedConfig.headers) {
    if (!(normalizedConfig.headers instanceof Headers)) {
      normalizedConfig.headers = new Headers(normalizedConfig.headers as HeadersInit);
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

  async function applyRequestInterceptors(config: RequestConfig): Promise<RequestConfig> {
    const handlers = [...state.requestInterceptors.getAll()].reverse(); // LIFO
    if (handlers.length === 0) return config;
    let chain = Promise.resolve(config);
    for (const handler of handlers) {
      chain = chain.then(handler.onFulfilled, handler.onRejected);
    }
    return chain;
  }

  async function applyResponseInterceptors<T>(response: ApiResponse<T>): Promise<ApiResponse<T>> {
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

  async function finalize<T>(response: ApiResponse<T>): Promise<ApiResponse<T>> {
    const finalResponse = await applyResponseInterceptors(response);
    notifyMonitors(finalResponse);
    return finalResponse;
  }

  async function executeSingleRequest<T>(
    config: RequestConfig,
    startTime: number,
    parentSignal: AbortSignal | undefined,
  ): Promise<ApiResponse<T>> {
    const attempt: AttemptSignal = createAttemptSignal({
      signal: parentSignal,
      timeout: resolveTimeout(config.timeout, state.config.timeout),
    });
    let transportFailed = false;

    try {
      const method = config.method ?? 'GET';
      const fullUrl = buildUrl(
        config.baseURL || state.config.baseURL,
        config.url ?? '',
        config.params,
        config.paramsSerializer,
      );
      const body = shouldHaveBody(method) ? prepareRequestBody(config.data) : undefined;

      // Always merge Accept from defaults; Content-Type is set per body type below
      const headers = mergeHeaders(DEFAULT_HEADERS, config.headers);
      const bodyContentType = getBodyContentType(body);
      if (bodyContentType === null) {
        // FormData: browser must set Content-Type with multipart boundary
        headers.delete('Content-Type');
      } else if (bodyContentType !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', bodyContentType);
      }

      let response: Response;
      try {
        transportFailed = true;
        response = await fetch(fullUrl, {
          ...toRequestInit(config),
          method,
          headers,
          body,
          // fetch requires duplex for stream bodies (Node, Chromium); callers may override.
          ...(isStream(body) && !config.duplex ? { duplex: 'half' as const } : {}),
          signal: attempt.signal,
        });
        transportFailed = false;
      } catch (error) {
        throw resolveFailure(error, attempt.signal, true);
      }
      const duration = Date.now() - startTime;

      // The same signal bounds the body read, so a timeout or cancel here surfaces as such.
      let data: unknown;
      try {
        data = await parseResponseBody<T>(response);
      } catch (error) {
        if (attempt.signal.aborted) throw abortReasonToError(attempt.signal.reason);
        if (error instanceof ParseError) {
          // An unreadable error body must not mask the HTTP failure; keep the raw text instead.
          if (!response.ok) {
            data = error.raw;
          } else {
            const failure = normalizeErrorResponse<T>(error, response, duration);
            failure.data = error.raw as T;
            return await finalize(failure);
          }
        } else {
          // A connection dropped mid-body is a transport failure, like a failed fetch().
          throw error instanceof TypeError ? new NetworkError(error) : error;
        }
      }
      if (attempt.signal.aborted) throw abortReasonToError(attempt.signal.reason);

      let apiResponse: ApiResponse<T>;
      if (response.ok) {
        apiResponse = normalizeSuccessResponse(data as T, response, duration);
      } else {
        const error = new Error(
          `HTTP ${method} ${fullUrl} failed with status ${response.status}: ${response.statusText}`,
        );
        apiResponse = normalizeErrorResponse<T>(error, response, duration);
        apiResponse.data = data as T;
      }
      return await finalize(apiResponse);
    } catch (error) {
      const duration = Date.now() - startTime;
      const failure = resolveFailure(error, attempt.signal, transportFailed);
      return await finalize(normalizeErrorResponse<T>(failure, undefined, duration));
    } finally {
      attempt.dispose();
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
      config.params = dataOrParams as QueryParams | undefined;
    }

    // Interceptors always see one shape: a lower-cased plain object with the instance headers
    // merged in. Defaults (Accept) are applied at send time so they can still be overridden.
    config.headers = headersToObject(mergeHeaders(state.config.headers, requestConfig.headers));

    // Validate up front so invalid values are programmer errors, not error responses.
    resolveTimeout(config.timeout, state.config.timeout);
    const totalTimeout = resolveTimeout(
      config.totalTimeout,
      state.config.totalTimeout ?? false,
      'totalTimeout',
    );

    // Request interceptors run once before any retry. They never throw to the caller: a
    // failing interceptor (e.g. a token fetch) produces an error response like any other failure.
    try {
      config = await applyRequestInterceptors(config);
    } catch (error) {
      return finalize(normalizeErrorResponse<T>(toError(error), undefined, Date.now() - startTime));
    }

    const retryConfig = normalizeRetryConfig(config.retry ?? state.config.retry);
    const deadline = createDeadline(totalTimeout);
    // One signal for the whole call: the caller's signal plus the total deadline. Attempts
    // layer their per-attempt timeout on top; back-off sleeps watch it directly.
    const call = createAttemptSignal({
      signal: config.signal,
      timeout: false,
      extraSignals: deadline.signal ? [deadline.signal] : [],
    });

    try {
      let attempt = 0;
      let lastResponse!: ApiResponse<T>;

      do {
        if (attempt > 0 && retryConfig) {
          try {
            await sleep(getRetryDelay(retryConfig, attempt), call.signal);
          } catch (reason) {
            lastResponse = await finalize(
              normalizeErrorResponse<T>(
                abortReasonToError(reason),
                undefined,
                Date.now() - startTime,
              ),
            );
            break;
          }
          retryConfig.onRetry?.(attempt, lastResponse);
        }
        lastResponse = await executeSingleRequest<T>(config, startTime, call.signal);
        attempt++;
      } while (
        retryConfig !== null &&
        attempt < retryConfig.attempts &&
        !call.signal.aborted &&
        // A ReadableStream body is consumed by the first attempt and cannot be replayed.
        !isStream(config.data) &&
        shouldRetry(lastResponse, retryConfig)
      );

      return lastResponse;
    } finally {
      call.dispose();
      deadline.dispose();
    }
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
    mergedConfig.headers = headersToObject(mergeHeaders(state.config.headers, config.headers));
    resolveTimeout(mergedConfig.timeout, state.config.timeout);

    try {
      mergedConfig = await applyRequestInterceptors(mergedConfig);
    } catch (error) {
      return normalizeErrorResponse(
        toError(error),
        undefined,
        Date.now() - startTime,
      ) as ApiResponse<ReadableStream<T>>;
    }

    const fullUrl = buildUrl(
      mergedConfig.baseURL || state.config.baseURL,
      mergedConfig.url || url,
      mergedConfig.params,
      mergedConfig.paramsSerializer,
    );
    const headers = mergeHeaders(DEFAULT_HEADERS, mergedConfig.headers);

    // The timeout covers the wait for headers only; the caller's signal stays linked to the
    // body stream so an abort after headers still cancels the download.
    const attempt = createAttemptSignal({
      signal: mergedConfig.signal,
      timeout: resolveTimeout(mergedConfig.timeout, state.config.timeout),
    });

    try {
      const response = await fetch(fullUrl, {
        ...toRequestInit(mergedConfig),
        method: 'GET',
        headers,
        signal: attempt.signal,
      });
      attempt.clearTimeout();
      const duration = Date.now() - startTime;

      if (!response.ok) {
        attempt.dispose();
        const error = new Error(
          `HTTP GET ${fullUrl} failed with status ${response.status}: ${response.statusText}`,
        );
        return normalizeErrorResponse(error, response, duration) as ApiResponse<ReadableStream<T>>;
      }

      if (!response.body) {
        attempt.dispose();
        const error = new Error(
          'Response body is null — streaming not supported in this environment',
        );
        return normalizeErrorResponse(error, response, duration) as ApiResponse<ReadableStream<T>>;
      }

      return normalizeSuccessResponse(response.body as ReadableStream<T>, response, duration);
    } catch (error) {
      attempt.dispose();
      const duration = Date.now() - startTime;
      const failure = resolveFailure(error, attempt.signal, true);
      return normalizeErrorResponse(failure, undefined, duration) as ApiResponse<ReadableStream<T>>;
    }
  }

  // ─── Transform aliases (backward compat) ────────────────────────────────

  function addRequestTransform(transform: RequestTransform | AsyncRequestTransform): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Request transform must be a function');
    }
    const id = state.requestInterceptors.use(async (config) => {
      await transform(config);
      return config;
    });
    requestTransformIds.set(transform, id);
  }

  function addResponseTransform(transform: ResponseTransform | AsyncResponseTransform): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Response transform must be a function');
    }
    const id = state.responseInterceptors.use(async (response) => {
      await (transform as ResponseTransform)(response);
      return response;
    });
    responseTransformIds.set(transform, id);
  }

  function removeRequestTransform(transform: RequestTransform | AsyncRequestTransform): boolean {
    const id = requestTransformIds.get(transform);
    if (id !== undefined) {
      state.requestInterceptors.eject(id);
      requestTransformIds.delete(transform);
      return true;
    }
    return false;
  }

  function removeResponseTransform(transform: ResponseTransform | AsyncResponseTransform): boolean {
    const id = responseTransformIds.get(transform);
    if (id !== undefined) {
      state.responseInterceptors.eject(id);
      responseTransformIds.delete(transform);
      return true;
    }
    return false;
  }

  function clearRequestTransforms(): void {
    requestTransformIds.forEach((id) => {
      state.requestInterceptors.eject(id);
    });
    requestTransformIds.clear();
  }

  function clearResponseTransforms(): void {
    responseTransformIds.forEach((id) => {
      state.responseInterceptors.eject(id);
    });
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
    Object.entries(headers).forEach(([name, value]) => {
      setHeader(name, value);
    });
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
