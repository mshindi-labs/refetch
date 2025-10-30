/**
 * Problem codes representing different types of API errors
 */
export enum PROBLEM_CODE {
  /**
   * No problem - successful response (200-299)
   */
  NONE = 'NONE',

  /**
   * Client error (400-499)
   */
  CLIENT_ERROR = 'CLIENT_ERROR',

  /**
   * Server error (500-599)
   */
  SERVER_ERROR = 'SERVER_ERROR',

  /**
   * Request timeout
   */
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',

  /**
   * Cannot connect to server
   */
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  /**
   * Network not available
   */
  NETWORK_ERROR = 'NETWORK_ERROR',

  /**
   * Request was cancelled
   */
  CANCEL_ERROR = 'CANCEL_ERROR',

  /**
   * Unknown error
   */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Base API response structure
 */
export interface ApiResponse<T> {
  /**
   * Whether the request was successful
   */
  ok: boolean;

  /**
   * The problem type (if any)
   */
  problem: PROBLEM_CODE | null;

  /**
   * The original error (if any)
   */
  originalError: Error | null;

  /**
   * Response data (if successful)
   */
  data?: T;

  /**
   * HTTP status code
   */
  status?: number;

  /**
   * Response headers
   */
  headers?: Record<string, string>;

  /**
   * Request duration in milliseconds
   */
  duration?: number;

  /**
   * The fetch Response object
   */
  response?: Response;
}

/**
 * Successful API response
 */
export interface ApiOkResponse<T> extends ApiResponse<T> {
  ok: true;
  problem: null;
  data: T;
  status: number;
}

/**
 * Failed API response
 */
export interface ApiErrorResponse<T> extends ApiResponse<T> {
  ok: false;
  problem: PROBLEM_CODE;
  originalError: Error;
}

/**
 * Request configuration
 */
export interface RequestConfig extends Omit<RequestInit, 'body' | 'method'> {
  /**
   * Request URL (relative to baseURL if set)
   */
  url?: string;

  /**
   * HTTP method
   */
  method?: string;

  /**
   * Request parameters (for query string or body)
   */
  params?: Record<string, any>;

  /**
   * Request data (will be JSON stringified)
   */
  data?: any;

  /**
   * Request timeout in milliseconds
   */
  timeout?: number;

  /**
   * Base URL to prepend to request URL
   */
  baseURL?: string;
}

/**
 * Configuration for creating a refetch instance
 */
export interface RefetchConfig {
  /**
   * Base URL for all requests
   */
  baseURL?: string;

  /**
   * Default headers for all requests
   */
  headers?: HeadersInit;

  /**
   * Default timeout in milliseconds
   */
  timeout?: number;

  /**
   * Additional fetch options
   */
  [key: string]: any;
}

/**
 * Synchronous request transform function
 */
export type RequestTransform = (config: RequestConfig) => void;

/**
 * Asynchronous request transform function
 */
export type AsyncRequestTransform = (config: RequestConfig) => Promise<void>;

/**
 * Synchronous response transform function
 */
export type ResponseTransform = <T>(response: ApiResponse<T>) => void;

/**
 * Asynchronous response transform function
 */
export type AsyncResponseTransform = <T>(
  response: ApiResponse<T>,
) => Promise<void>;

/**
 * Monitor function for observing API responses
 */
export type Monitor = <T>(response: ApiResponse<T>) => void;

/**
 * The main refetch instance
 */
export interface RefetchInstance {
  /**
   * Base configuration
   */
  config: RefetchConfig;

  /**
   * Make a GET request
   */
  get<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Make a POST request
   */
  post<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Make a PUT request
   */
  put<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Make a PATCH request
   */
  patch<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Make a DELETE request
   */
  delete<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Make a HEAD request
   */
  head<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  /**
   * Add a request transform (sync or async)
   */
  addRequestTransform(
    transform: RequestTransform | AsyncRequestTransform,
  ): void;

  /**
   * Add a response transform (sync or async)
   */
  addResponseTransform(
    transform: ResponseTransform | AsyncResponseTransform,
  ): void;

  /**
   * Add a monitor to observe responses
   */
  addMonitor(monitor: Monitor): void;

  /**
   * Set a header for all requests
   */
  setHeader(name: string, value: string): void;

  /**
   * Set multiple headers
   */
  setHeaders(headers: Record<string, string>): void;

  /**
   * Delete a header
   */
  deleteHeader(name: string): void;

  /**
   * Set the base URL
   */
  setBaseURL(baseURL: string): void;
}
