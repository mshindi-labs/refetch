import { PROBLEM_CODE } from './types';

/**
 * Map of problem codes
 */
export const PROBLEM_CODES = {
  NONE: PROBLEM_CODE.NONE,
  CLIENT_ERROR: PROBLEM_CODE.CLIENT_ERROR,
  SERVER_ERROR: PROBLEM_CODE.SERVER_ERROR,
  TIMEOUT_ERROR: PROBLEM_CODE.TIMEOUT_ERROR,
  CONNECTION_ERROR: PROBLEM_CODE.CONNECTION_ERROR,
  NETWORK_ERROR: PROBLEM_CODE.NETWORK_ERROR,
  CANCEL_ERROR: PROBLEM_CODE.CANCEL_ERROR,
  UNKNOWN_ERROR: PROBLEM_CODE.UNKNOWN_ERROR,
} as const;

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

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  TIMEOUT: 'Request timeout',
  NETWORK: 'Network error',
  CONNECTION: 'Connection error',
  CANCELLED: 'Request was cancelled',
  UNKNOWN: 'Unknown error occurred',
} as const;
