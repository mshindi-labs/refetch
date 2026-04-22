export enum PROBLEM_CODE {
  NONE = 'NONE',
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CANCEL_ERROR = 'CANCEL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Discriminated union covering every failure mode with narrowable fields per kind.
 *
 * @example
 * if (!response.ok) {
 *   switch (response.error.kind) {
 *     case 'timeout':  // response.error.duration is available
 *     case 'http':     // response.error.status is narrowed to number
 *     case 'cancel':   // response.error.reason may carry a message
 *   }
 * }
 */
export type RefetchError =
  | { kind: 'network'; cause: TypeError }
  | { kind: 'timeout'; duration: number; cause: Error }
  | { kind: 'cancel'; reason?: string; cause: Error }
  | { kind: 'http'; status: number; statusText: string }
  | { kind: 'parse'; contentType: string | null; cause: Error }
  | { kind: 'unknown'; cause: Error };

/**
 * Retry configuration. Pass a plain number as shorthand for `{ attempts: n }`.
 */
export interface RetryConfig {
  /** Total attempts including the first (minimum 1). */
  attempts: number;
  /** Fixed delay in ms, or a function returning ms for each retry (1-based attempt number). */
  delay?: number | ((attempt: number) => number);
  /** Return true to retry. Defaults to retrying on any non-ok response except 400/401/403. */
  condition?: (response: ApiResponse<unknown>) => boolean;
  /** Called before each retry attempt. */
  onRetry?: (attempt: number, response: ApiResponse<unknown>) => void;
}

export interface ApiResponse<T> {
  ok: boolean;
  problem: PROBLEM_CODE | null;
  originalError: Error | null;
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  duration?: number;
  response?: Response;
}

export interface ApiOkResponse<T> extends ApiResponse<T> {
  ok: true;
  problem: null;
  data: T;
  status: number;
}

export interface ApiErrorResponse<T> extends ApiResponse<T> {
  ok: false;
  problem: PROBLEM_CODE;
  /** Discriminated union for precise narrowing — use instead of or alongside `problem`. */
  error: RefetchError;
  originalError: Error | null;
}

export interface RequestConfig extends Omit<RequestInit, 'body' | 'method'> {
  url?: string;
  method?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  timeout?: number;
  baseURL?: string;
  /** Retry on failure. Number = attempt count shorthand; object for full control. */
  retry?: number | RetryConfig;
}

export interface RefetchConfig extends Omit<RequestInit, 'method' | 'body'> {
  baseURL?: string;
  headers?: HeadersInit;
  timeout?: number;
  /** Instance-wide retry default. Overridden by per-request `retry`. */
  retry?: number | RetryConfig;
}

export type RequestTransform = (config: RequestConfig) => void;
export type AsyncRequestTransform = (config: RequestConfig) => Promise<void>;
export type ResponseTransform = <T>(response: ApiResponse<T>) => void;
export type AsyncResponseTransform = <T>(response: ApiResponse<T>) => Promise<void>;
export type Monitor = <T>(response: ApiResponse<T>) => void;

export interface InterceptorHandler<T> {
  onFulfilled?: (value: T) => T | Promise<T>;
  onRejected?: (error: unknown) => T | Promise<T>;
}

export interface InterceptorManager<T> {
  use(
    onFulfilled?: (value: T) => T | Promise<T>,
    onRejected?: (error: unknown) => T | Promise<T>,
  ): number;
  eject(id: number): void;
  clear(): void;
}

export interface RefetchInstance {
  config: RefetchConfig;

  /**
   * Axios-style interceptors.
   * Request interceptors run LIFO (last registered runs first).
   * Response interceptors run FIFO (first registered runs first).
   */
  interceptors: {
    request: InterceptorManager<RequestConfig>;
    response: InterceptorManager<ApiResponse<unknown>>;
  };

  get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  post<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>>;

  put<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>>;

  patch<TResponse = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: RequestConfig,
  ): Promise<ApiResponse<TResponse>>;

  delete<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  head<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  link<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  unlink<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  any<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>>;

  /**
   * Fetch a resource as a raw ReadableStream — no body parsing.
   * Useful for large downloads, SSE, or chunked data.
   */
  stream<T = Uint8Array>(
    url: string,
    params?: Record<string, unknown>,
    config?: RequestConfig,
  ): Promise<ApiResponse<ReadableStream<T>>>;

  /** @deprecated Use `interceptors.request.use()` instead. */
  addRequestTransform(transform: RequestTransform | AsyncRequestTransform): void;
  /** @deprecated Use `interceptors.response.use()` instead. */
  addResponseTransform(transform: ResponseTransform | AsyncResponseTransform): void;
  addMonitor(monitor: Monitor): void;
  /** @deprecated Use `interceptors.request.eject()` instead. */
  removeRequestTransform(transform: RequestTransform | AsyncRequestTransform): boolean;
  /** @deprecated Use `interceptors.response.eject()` instead. */
  removeResponseTransform(transform: ResponseTransform | AsyncResponseTransform): boolean;
  removeMonitor(monitor: Monitor): boolean;
  /** @deprecated Use `interceptors.request.clear()` instead. */
  clearRequestTransforms(): void;
  /** @deprecated Use `interceptors.response.clear()` instead. */
  clearResponseTransforms(): void;
  clearMonitors(): void;

  setHeader(name: string, value: string): void;
  setHeaders(headers: Record<string, string>): void;
  deleteHeader(name: string): void;
  setBaseURL(baseURL: string): void;
  getBaseURL(): string | undefined;
}

export function isOkResponse<T>(
  response: ApiResponse<T>,
): response is ApiOkResponse<T> {
  return response.ok === true;
}

export function isErrorResponse<T>(
  response: ApiResponse<T>,
): response is ApiErrorResponse<T> {
  return response.ok === false;
}
