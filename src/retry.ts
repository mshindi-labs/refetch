import type {
  ApiErrorResponse,
  ApiResponse,
  BackoffOptions,
  RetryConfig,
  RetryContext,
} from './types';

const DEFAULT_NON_RETRYABLE = new Set([400, 401, 403, 404, 422]);
/** Longest server-requested delay honoured by default; longer means "come back later". */
export const DEFAULT_MAX_RETRY_AFTER = 60_000;
/** setTimeout cannot schedule beyond this; larger values would fire immediately. */
const MAX_DELAY = 2_147_483_647;
const RATE_LIMIT_RESET_HEADERS = ['ratelimit-reset', 'x-ratelimit-reset', 'x-rate-limit-reset'];

export function normalizeRetryConfig(retry?: number | RetryConfig): RetryConfig | null {
  if (retry === undefined || retry === null) return null;
  if (typeof retry === 'number') return { attempts: retry };
  return retry;
}

/** Full jitter: a random delay in [0, delay]. Server-provided delays are never jittered. */
function applyJitter(delay: number, jitter: boolean | undefined): number {
  return jitter ? Math.random() * delay : delay;
}

/** Delay before the given 1-based retry attempt, from `delay`, `backoff`, `maxDelay` and `jitter`. */
export function getRetryDelay(config: RetryConfig, attempt: number): number {
  const base = config.delay ?? 0;
  if (typeof base === 'function') return Math.min(MAX_DELAY, base(attempt));
  let delay = base;
  if (config.backoff === 'linear') delay = base * attempt;
  else if (config.backoff === 'exponential') delay = base * 2 ** (attempt - 1);
  if (config.maxDelay !== undefined) delay = Math.min(delay, config.maxDelay);
  return applyJitter(Math.min(MAX_DELAY, delay), config.jitter);
}

/** A `delay` function: `base * factor^(attempt - 1)` capped at `max`, optionally jittered. */
export function exponentialBackoff(options: BackoffOptions = {}): (attempt: number) => number {
  const { base = 300, factor = 2, max = 30_000, jitter = false } = options;
  return (attempt) => applyJitter(Math.min(max, base * factor ** (attempt - 1)), jitter);
}

/**
 * Delay requested by the server in ms, from `Retry-After` (seconds or HTTP-date) or a rate-limit
 * reset header (seconds from now, or a Unix timestamp in seconds or ms). `undefined` when absent.
 */
export function retryAfterDelay(response: ApiResponse<unknown>): number | undefined {
  const headers = response.headers;
  if (!headers) return undefined;

  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  for (const name of RATE_LIMIT_RESET_HEADERS) {
    const value = headers[name];
    if (value === undefined) continue;
    const reset = Number(value);
    if (!Number.isFinite(reset)) continue;
    // Small values are seconds until reset (IETF draft); large ones are Unix timestamps.
    if (reset < 1e9) return Math.max(0, reset * 1000);
    const resetAt = reset < 1e12 ? reset * 1000 : reset;
    return Math.max(0, resetAt - Date.now());
  }
  return undefined;
}

function errorKind(response: ApiResponse<unknown>): string | undefined {
  // Hand-built responses (tests, interceptors) may omit `error`.
  return (response as Partial<ApiErrorResponse<unknown>>).error?.kind;
}

/** Cancelled requests and total-timeout expiries are never retried, whatever `condition` says. */
function isUnretryable(response: ApiResponse<unknown>): boolean {
  if (response.ok) return false;
  const error = (response as Partial<ApiErrorResponse<unknown>>).error;
  if (!error) return false;
  if (error.kind === 'cancel') return true;
  // Duck-typed so this module stays free of runtime imports (see TimeoutError.scope).
  return error.kind === 'timeout' && (error.cause as { scope?: unknown }).scope === 'total';
}

export function shouldRetry(
  response: ApiResponse<unknown>,
  config: RetryConfig,
  context: RetryContext = {},
): boolean {
  if (isUnretryable(response)) return false;
  if (config.condition) return config.condition(response);
  if (response.ok) return false;
  if (errorKind(response) === 'parse') return false;

  const method = context.method?.toUpperCase();
  if (config.methods && method && !config.methods.some((m) => m.toUpperCase() === method)) {
    return false;
  }
  if (response.status) {
    if (config.statusCodes) return config.statusCodes.includes(response.status);
    if (DEFAULT_NON_RETRYABLE.has(response.status)) return false;
  }
  return true;
}

/** Resolves after `ms`; rejects with `signal.reason` as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
