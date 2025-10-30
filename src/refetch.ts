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
  classifyProblem,
} from './utils';

/**
 * Create a new refetch instance
 */
export function create(config: RefetchConfig = {}): RefetchInstance {
  // Internal state
  const state = {
    config: { ...config },
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
  async function request<T = any>(
    method: string,
    url: string,
    dataOrParams?: any,
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
        config.params = dataOrParams;
      }

      // Apply request transforms
      await applyRequestTransforms(config);

      // Build the URL
      const fullUrl = buildUrl(
        config.baseURL || state.config.baseURL,
        url,
        config.params,
      );

      // Merge headers
      const headers = mergeHeaders(
        DEFAULT_HEADERS,
        state.config.headers,
        config.headers,
      );

      // Prepare the request body
      const body = shouldHaveBody(method)
        ? prepareRequestBody(config.data)
        : undefined;

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
          `HTTP Error ${response.status}: ${response.statusText}`,
        );
        apiResponse = {
          ok: false,
          problem: classifyProblem(response.status),
          originalError: error,
          data: data as T,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          duration,
          response,
        };
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
  function get<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('GET', url, params, config);
  }

  /**
   * POST request
   */
  function post<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('POST', url, data, config);
  }

  /**
   * PUT request
   */
  function put<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('PUT', url, data, config);
  }

  /**
   * PATCH request
   */
  function patch<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('PATCH', url, data, config);
  }

  /**
   * DELETE request
   */
  function deleteRequest<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('DELETE', url, params, config);
  }

  /**
   * HEAD request
   */
  function head<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return request<T>('HEAD', url, params, config);
  }

  /**
   * Add a request transform
   */
  function addRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): void {
    state.requestTransforms.push(transform);
  }

  /**
   * Add a response transform
   */
  function addResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): void {
    state.responseTransforms.push(transform);
  }

  /**
   * Add a monitor
   */
  function addMonitor(monitor: Monitor): void {
    state.monitors.push(monitor);
  }

  /**
   * Set a single header
   */
  function setHeader(name: string, value: string): void {
    if (!state.config.headers) {
      state.config.headers = {};
    }

    if (state.config.headers instanceof Headers) {
      state.config.headers.set(name, value);
    } else if (Array.isArray(state.config.headers)) {
      const existingIndex = state.config.headers.findIndex(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      );
      if (existingIndex !== -1) {
        state.config.headers[existingIndex] = [name, value];
      } else {
        state.config.headers.push([name, value]);
      }
    } else {
      state.config.headers[name] = value;
    }
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
    if (!state.config.headers) return;

    if (state.config.headers instanceof Headers) {
      state.config.headers.delete(name);
    } else if (Array.isArray(state.config.headers)) {
      state.config.headers = state.config.headers.filter(
        ([key]) => key.toLowerCase() !== name.toLowerCase(),
      );
    } else {
      delete state.config.headers[name];
    }
  }

  /**
   * Set base URL
   */
  function setBaseURL(baseURL: string): void {
    state.config.baseURL = baseURL;
  }

  // Return the instance
  return {
    config: state.config,
    get,
    post,
    put,
    patch,
    delete: deleteRequest,
    head,
    addRequestTransform,
    addResponseTransform,
    addMonitor,
    setHeader,
    setHeaders,
    deleteHeader,
    setBaseURL,
  };
}
