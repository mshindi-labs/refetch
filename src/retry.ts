import type { ApiErrorResponse, ApiResponse, RetryConfig } from './types';

const DEFAULT_NON_RETRYABLE = new Set([400, 401, 403, 404, 422]);

export function normalizeRetryConfig(retry?: number | RetryConfig): RetryConfig | null {
  if (retry === undefined || retry === null) return null;
  if (typeof retry === 'number') return { attempts: retry };
  return retry;
}

export function getRetryDelay(config: RetryConfig, attempt: number): number {
  if (!config.delay) return 0;
  if (typeof config.delay === 'function') return config.delay(attempt);
  return config.delay;
}

/** Cancelled requests and total-timeout expiries are never retried, whatever `condition` says. */
function isUnretryable(response: ApiResponse<unknown>): boolean {
  if (response.ok) return false;
  // Hand-built responses (tests, interceptors) may omit `error`; treat them as retryable.
  const error = (response as Partial<ApiErrorResponse<unknown>>).error;
  if (!error) return false;
  if (error.kind === 'cancel') return true;
  // Duck-typed so this module stays free of runtime imports (see TimeoutError.scope).
  return error.kind === 'timeout' && (error.cause as { scope?: unknown }).scope === 'total';
}

export function shouldRetry(response: ApiResponse<unknown>, config: RetryConfig): boolean {
  if (isUnretryable(response)) return false;
  if (config.condition) return config.condition(response);
  if (response.ok) return false;
  if (response.status && DEFAULT_NON_RETRYABLE.has(response.status)) return false;
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
