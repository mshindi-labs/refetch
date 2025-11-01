import { type ApiResponse, PROBLEM_CODE, type RequestConfig } from './types';
import { STATUS_RANGES, DEFAULT_TIMEOUT } from './constants';

/**
 * Classify the problem based on status code or error
 */
export function classifyProblem(status?: number, error?: Error): PROBLEM_CODE {
  // Check for specific error types
  if (error) {
    const errorName = error.name;
    const errorMessage = error.message?.toLowerCase() || '';

    // Abort/timeout errors
    if (errorName === 'AbortError' || errorMessage.includes('aborted')) {
      if (errorMessage.includes('timeout')) {
        return PROBLEM_CODE.TIMEOUT_ERROR;
      }
      return PROBLEM_CODE.CANCEL_ERROR;
    }

    // Network errors
    if (
      errorName === 'TypeError' &&
      (errorMessage.includes('fetch') || errorMessage.includes('network'))
    ) {
      return PROBLEM_CODE.NETWORK_ERROR;
    }

    // Connection errors
    if (
      errorMessage.includes('connection') ||
      errorMessage.includes('refused')
    ) {
      return PROBLEM_CODE.CONNECTION_ERROR;
    }
  }

  // Check status code ranges
  if (status !== undefined) {
    if (
      status >= STATUS_RANGES.CLIENT_ERROR_MIN &&
      status <= STATUS_RANGES.CLIENT_ERROR_MAX
    ) {
      return PROBLEM_CODE.CLIENT_ERROR;
    }

    if (
      status >= STATUS_RANGES.SERVER_ERROR_MIN &&
      status <= STATUS_RANGES.SERVER_ERROR_MAX
    ) {
      return PROBLEM_CODE.SERVER_ERROR;
    }

    if (
      status >= STATUS_RANGES.SUCCESS_MIN &&
      status <= STATUS_RANGES.SUCCESS_MAX
    ) {
      return PROBLEM_CODE.NONE;
    }
  }

  return PROBLEM_CODE.UNKNOWN_ERROR;
}

/**
 * Build a query string from params object
 */
export function buildQueryString(params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return '';
  }

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });

  return searchParams.toString();
}

/**
 * Build a full URL with query parameters
 */
export function buildUrl(
  baseURL: string | undefined,
  url: string,
  params?: Record<string, unknown>,
): string {
  if (typeof url !== 'string') {
    throw new TypeError('URL must be a string');
  }

  // If URL is absolute, use it directly
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const queryString = buildQueryString(params || {});
    if (queryString) {
      return url + (url.includes('?') ? '&' : '?') + queryString;
    }
    return url;
  }

  // Handle baseURL and relative URL
  let fullUrl: string;
  if (baseURL) {
    const normalizedBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const normalizedUrl = url.startsWith('/') ? url : '/' + url;
    fullUrl = normalizedBase + normalizedUrl;
  } else {
    fullUrl = url;
  }

  const queryString = buildQueryString(params || {});
  if (queryString) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
  }

  return fullUrl;
}

/**
 * Merge headers from multiple sources
 */
export function mergeHeaders(
  ...headersList: (HeadersInit | undefined)[]
): Headers {
  const merged = new Headers();

  for (const headers of headersList) {
    if (!headers) continue;

    if (headers instanceof Headers) {
      headers.forEach((value, key) => merged.set(key, value));
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => merged.set(key, value));
    } else {
      Object.entries(headers).forEach(([key, value]) => merged.set(key, value));
    }
  }

  return merged;
}

/**
 * Convert Headers object to plain object
 */
export function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * Execute fetch with timeout
 */
export async function fetchWithTimeout(
  url: string,
  config: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, signal, ...fetchConfig } = config;

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signalHandler: (() => void) | undefined;

  try {
    // Set up timeout
    if (timeout) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error('Request timeout'));
      }, timeout);
    }

    // Combine signals if one was provided
    if (signal) {
      signalHandler = () => {
        controller.abort(signal.reason);
      };
      signal.addEventListener('abort', signalHandler);
    }

    const response = await fetch(url, {
      ...fetchConfig,
      signal: controller.signal,
    });

    return response;
  } finally {
    // Cleanup timeout and signal listener
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && signalHandler) {
      signal.removeEventListener('abort', signalHandler);
    }
  }
}

/**
 * Parse response body based on content type
 */
export async function parseResponseBody<T>(
  response: Response,
): Promise<T | string | Blob | null> {
  const contentType = response.headers.get('content-type');

  try {
    if (!contentType) {
      const text = await response.text();
      return text || null;
    }

    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    if (
      contentType.includes('text/') ||
      contentType.includes('application/xml')
    ) {
      return await response.text();
    }

    if (contentType.includes('application/octet-stream')) {
      return await response.blob();
    }

    // Default to text
    return await response.text();
  } catch (error) {
    // If parsing fails, return null
    return null;
  }
}

/**
 * Normalize a successful response
 */
export function normalizeSuccessResponse<T>(
  data: T,
  response: Response,
  duration: number,
): ApiResponse<T> {
  return {
    ok: true,
    problem: null,
    originalError: null,
    data,
    status: response.status,
    headers: headersToObject(response.headers),
    duration,
    response,
  };
}

/**
 * Normalize an error response
 */
export function normalizeErrorResponse<T>(
  error: Error,
  response?: Response,
  duration?: number,
): ApiResponse<T> {
  const status = response?.status;
  const problem = classifyProblem(status, error);

  return {
    ok: false,
    problem,
    originalError: error,
    data: undefined,
    status,
    headers: response ? headersToObject(response.headers) : undefined,
    duration,
    response,
  };
}

/**
 * Prepare request body
 */
export function prepareRequestBody(
  data: unknown,
): string | FormData | URLSearchParams | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }

  // If it's already FormData, URLSearchParams, or a string, return as-is
  if (
    data instanceof FormData ||
    data instanceof URLSearchParams ||
    typeof data === 'string'
  ) {
    return data;
  }

  // Otherwise, JSON stringify
  return JSON.stringify(data);
}

/**
 * Check if the request should have a body
 */
export function shouldHaveBody(method: string): boolean {
  const noBodyMethods = ['GET', 'HEAD', 'DELETE'];
  return !noBodyMethods.includes(method.toUpperCase());
}
