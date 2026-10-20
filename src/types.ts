export enum PROBLEM_CODE {
  NONE = 'NONE',
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CANCEL_ERROR = 'CANCEL_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
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
  /**
   * Return true to retry. Defaults to retrying on any non-ok response except
   * 400/401/403/404/422 or a parse failure. Cancelled requests and total-timeout expiries are
   * never retried, and requests whose body is a one-shot ReadableStream cannot be retried.
   */
  condition?: (response: ApiResponse<unknown>) => boolean;
  /** Grows the base `delay` per attempt. Ignored when `delay` is a function. Default `'fixed'`. */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Full jitter: each computed delay becomes a random value in [0, delay]. Default `false`. */
  jitter?: boolean;
  /** Upper bound in ms for computed delays. */
  maxDelay?: number;
  /** Honour `Retry-After` and rate-limit reset headers instead of the computed delay. Default `true`. */
  respectRetryAfter?: boolean;
  /** Give up instead of waiting when the server asks for more than this many ms. Default 60 000. */
  maxRetryAfter?: number;
  /** Only retry these HTTP methods (case-insensitive). Default: every method. */
  methods?: string[];
  /** Only retry these status codes; transport failures stay retryable. Default: see `condition`. */
  statusCodes?: number[];
  /** Called before each retry's delay with the 1-based attempt, the last response and the delay in ms. */
  onRetry?: (attempt: number, response: ApiResponse<unknown>, delay: number) => void;
}

/** Extra facts `shouldRetry` needs beyond the response. */
export interface RetryContext {
  /** HTTP method of the request being retried, checked against `RetryConfig.methods`. */
  method?: string;
}

/** Options for `exponentialBackoff()`. */
export interface BackoffOptions {
  /** First delay in ms. Default 300. */
  base?: number;
  /** Growth factor per attempt. Default 2. */
  factor?: number;
  /** Upper bound in ms. Default 30 000. */
  max?: number;
  /** Full jitter in [0, delay]. Default `false`. */
  jitter?: boolean;
}

/**
 * Query parameters: a plain object (arrays repeat the key, Dates become ISO 8601 strings,
 * `null`/`undefined` are omitted, nested objects throw), a `URLSearchParams`, or key/value tuples.
 */
export type QueryParams = Record<string, unknown> | URLSearchParams | Array<[string, unknown]>;

/** Custom query serializer; returns the query string without the leading `?`. */
export type ParamsSerializer = (params: QueryParams) => string;

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
  params?: QueryParams;
  /** Replaces the default query serialisation for this request. */
  paramsSerializer?: ParamsSerializer;
  data?: unknown;
  /** Per-attempt timeout in ms (covers headers and body). `0` or `false` disables it. */
  timeout?: number | false;
  /** Deadline for the whole call including retries and back-off. Disabled by default. */
  totalTimeout?: number | false;
  /** Required by fetch for ReadableStream bodies; set automatically when omitted. */
  duplex?: 'half';
  baseURL?: string;
  /** Retry on failure. Number = attempt count shorthand; object for full control. */
  retry?: number | RetryConfig;
}

export interface RefetchConfig extends Omit<RequestInit, 'method' | 'body'> {
  baseURL?: string;
  headers?: HeadersInit;
  /** Default per-attempt timeout in ms. `0` or `false` disables it. Defaults to 10 000. */
  timeout?: number | false;
  /** Default deadline for a whole call including retries. Disabled by default. */
  totalTimeout?: number | false;
  /** Replaces the default query serialisation for every request. */
  paramsSerializer?: ParamsSerializer;
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
    params?: QueryParams,
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
    params?: QueryParams,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  head<T = unknown>(
    url: string,
    params?: QueryParams,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  link<T = unknown>(
    url: string,
    params?: QueryParams,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  unlink<T = unknown>(
    url: string,
    params?: QueryParams,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>>;

  any<T = unknown>(config: RequestConfig): Promise<ApiResponse<T>>;

  /**
   * Fetch a resource as a raw ReadableStream — no body parsing.
   * Useful for large downloads, SSE, or chunked data.
   */
  stream<T = Uint8Array>(
    url: string,
    params?: QueryParams,
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

export function isOkResponse<T>(response: ApiResponse<T>): response is ApiOkResponse<T> {
  return response.ok === true;
}

export function isErrorResponse<T>(response: ApiResponse<T>): response is ApiErrorResponse<T> {
  return response.ok === false;
}
