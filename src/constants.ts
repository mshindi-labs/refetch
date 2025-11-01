/**
 * HTTP status code ranges
 */
export const STATUS_RANGES = {
  SUCCESS_MIN: 200,
  SUCCESS_MAX: 299,
  CLIENT_ERROR_MIN: 400,
  CLIENT_ERROR_MAX: 499,
  SERVER_ERROR_MIN: 500,
  SERVER_ERROR_MAX: 599,
} as const;

/**
 * Default timeout in milliseconds (10 seconds)
 */
export const DEFAULT_TIMEOUT = 10000;

/**
 * Default headers
 */
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
} as const;
