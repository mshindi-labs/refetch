import type { ApiResponse, RetryConfig } from './types';

const DEFAULT_NON_RETRYABLE = new Set([400, 401, 403, 404, 422]);

export function normalizeRetryConfig(
  retry?: number | RetryConfig,
): RetryConfig | null {
  if (retry === undefined || retry === null) return null;
  if (typeof retry === 'number') return { attempts: retry };
  return retry;
}

export function getRetryDelay(config: RetryConfig, attempt: number): number {
  if (!config.delay) return 0;
  if (typeof config.delay === 'function') return config.delay(attempt);
  return config.delay;
}

export function shouldRetry(
  response: ApiResponse<unknown>,
  config: RetryConfig,
): boolean {
  if (config.condition) return config.condition(response);
  if (response.ok) return false;
  if (response.status && DEFAULT_NON_RETRYABLE.has(response.status)) return false;
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
