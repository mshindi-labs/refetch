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

import {
  buildUrl,
  mergeHeaders,
  fetchWithTimeout,
  parseResponseBody,
  normalizeSuccessResponse,
  normalizeErrorResponse,
  prepareRequestBody,
  shouldHaveBody,
} from './utils';

/**
 * Create a new refetch instance
 */
export function create(config: RefetchConfig = {}): RefetchInstance {
  // Normalize headers to Headers class for internal use
  const normalizedConfig = { ...config };
  if (normalizedConfig.headers) {
    if (!(normalizedConfig.headers instanceof Headers)) {
      normalizedConfig.headers = new Headers(normalizedConfig.headers as HeadersInit);
    }
  } else {
    normalizedConfig.headers = new Headers();
  }

  // Internal state
  const state = {
    config: normalizedConfig,
    requestTransforms: [] as Array<RequestTransform | AsyncRequestTransform>,
    responseTransforms: [] as Array<ResponseTransform | AsyncResponseTransform>,
    monitors: [] as Monitor[],
  };

  /**
   * Apply all request transforms to the config
   */
  async function applyRequestTransforms(
    requestConfig: RequestConfig,
  ): Promise<void> {
    for (const transform of state.requestTransforms) {
      await transform(requestConfig);
    }
  }

  /**
   * Apply all response transforms to the response
   */
  async function applyResponseTransforms<T>(
    response: ApiResponse<T>,
  ): Promise<void> {
    for (const transform of state.responseTransforms) {
      await transform(response);
    }
  }

  /**
   * Notify all monitors about the response
   */
  function notifyMonitors<T>(response: ApiResponse<T>): void {
    state.monitors.forEach((monitor) => {
      try {
        monitor(response);
      } catch (error) {
        // Silently catch monitor errors to prevent breaking the request flow
        console.error('Monitor error:', error);
      }
    });
  }

  /**
   * Make an HTTP request
   */
  async function request<T = unknown>(
    method: string,
    url: string,
    dataOrParams?: unknown,
    requestConfig: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    const startTime = Date.now();

    try {
      // Merge configurations
      const config: RequestConfig = {
        ...state.config,
        ...requestConfig,
        url,
        method: method.toUpperCase(),
      };

      // Handle data vs params based on method
      if (shouldHaveBody(method)) {
        config.data = dataOrParams;
      } else {
        config.params = dataOrParams as Record<string, unknown> | undefined;
      }

      // Apply request transforms
      await applyRequestTransforms(config);

      // Build the URL
      const fullUrl = buildUrl(
        config.baseURL || state.config.baseURL,
        url,
        config.params,
      );

      // Prepare the request body
      const body = shouldHaveBody(method)
        ? prepareRequestBody(config.data)
        : undefined;

      // Conditionally apply DEFAULT_HEADERS based on body type
      // Skip JSON headers for FormData and URLSearchParams
      const shouldApplyDefaultHeaders =
        !body || (!(body instanceof FormData) && !(body instanceof URLSearchParams));

      const headers = mergeHeaders(
        shouldApplyDefaultHeaders ? DEFAULT_HEADERS : undefined,
        state.config.headers,
        config.headers,
      );

      // Make the fetch request with timeout
      const fetchConfig: RequestInit & { timeout?: number } = {
        method: config.method,
        headers,
        body,
        timeout: config.timeout || state.config.timeout,
        ...config,
      };

      const response = await fetchWithTimeout(fullUrl, fetchConfig);
      const duration = Date.now() - startTime;

      // Parse response body
      const data = await parseResponseBody<T>(response);

      // Check if response is ok
      const isOk = response.ok;

      // Create normalized response
      let apiResponse: ApiResponse<T>;

      if (isOk) {
        apiResponse = normalizeSuccessResponse(data as T, response, duration);
      } else {
        const error = new Error(
          `HTTP ${config.method} ${fullUrl} failed with status ${response.status}: ${response.statusText}`,
        );
        apiResponse = normalizeErrorResponse<T>(error, response, duration);
        // Preserve the parsed data for error responses
        apiResponse.data = data as T;
      }

      // Apply response transforms
      await applyResponseTransforms(apiResponse);

      // Notify monitors
      notifyMonitors(apiResponse);

      return apiResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      const apiResponse = normalizeErrorResponse<T>(
        error as Error,
        undefined,
        duration,
      );

      // Apply response transforms even for errors
      await applyResponseTransforms(apiResponse);

      // Notify monitors
      notifyMonitors(apiResponse);

      return apiResponse;
    }
  }

  /**
   * GET request
   */
  function get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('GET', url, params, config);
  }

  /**
   * POST request
   */
  function post<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('POST', url, data, config);
  }

  /**
   * PUT request
   */
  function put<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('PUT', url, data, config);
  }

  /**
   * PATCH request
   */
  function patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('PATCH', url, data, config);
  }

  /**
   * DELETE request
   */
  function deleteRequest<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('DELETE', url, params, config);
  }

  /**
   * HEAD request
   */
  function head<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('HEAD', url, params, config);
  }

  /**
   * LINK request
   */
  function link<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('LINK', url, params, config);
  }

  /**
   * UNLINK request
   */
  function unlink<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('UNLINK', url, params, config);
  }

  /**
   * Generic request for any HTTP method
   */
  function any<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>> {
    const method = config.method || 'GET';
    const url = config.url || '/';
    const dataOrParams = shouldHaveBody(method) ? config.data : config.params;
    return request<T>(method, url, dataOrParams, config);
  }

  /**
   * Add a request transform
   */
  function addRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Request transform must be a function');
    }
    state.requestTransforms.push(transform);
  }

  /**
   * Add a response transform
   */
  function addResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): void {
    if (typeof transform !== 'function') {
      throw new TypeError('Response transform must be a function');
    }
    state.responseTransforms.push(transform);
  }

  /**
   * Add a monitor
   */
  function addMonitor(monitor: Monitor): void {
    if (typeof monitor !== 'function') {
      throw new TypeError('Monitor must be a function');
    }
    state.monitors.push(monitor);
  }

  /**
   * Remove a specific request transform
   */
  function removeRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): boolean {
    const index = state.requestTransforms.indexOf(transform);
    if (index > -1) {
      state.requestTransforms.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove a specific response transform
   */
  function removeResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): boolean {
    const index = state.responseTransforms.indexOf(transform);
    if (index > -1) {
      state.responseTransforms.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove a specific monitor
   */
  function removeMonitor(monitor: Monitor): boolean {
    const index = state.monitors.indexOf(monitor);
    if (index > -1) {
      state.monitors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all request transforms
   */
  function clearRequestTransforms(): void {
    state.requestTransforms = [];
  }

  /**
   * Clear all response transforms
   */
  function clearResponseTransforms(): void {
    state.responseTransforms = [];
  }

  /**
   * Clear all monitors
   */
  function clearMonitors(): void {
    state.monitors = [];
  }

  /**
   * Set a single header
   */
  function setHeader(name: string, value: string): void {
    // Headers are always normalized to Headers class now
    (state.config.headers as Headers).set(name, value);
  }

  /**
   * Set multiple headers
   */
  function setHeaders(headers: Record<string, string>): void {
    Object.entries(headers).forEach(([name, value]) => {
      setHeader(name, value);
    });
  }

  /**
   * Delete a header
   */
  function deleteHeader(name: string): void {
    // Headers are always normalized to Headers class now
    (state.config.headers as Headers).delete(name);
  }

  /**
   * Set base URL
   */
  function setBaseURL(baseURL: string): void {
    state.config.baseURL = baseURL;
  }

  /**
   * Get base URL
   */
  function getBaseURL(): string | undefined {
    return state.config.baseURL;
  }

  // Return the instance
  return {
    get config(): Readonly<RefetchConfig> {
      return { ...state.config };
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
