import { STATUS_RANGES } from './constants';
import { PROBLEM_CODE, type RefetchError } from './types';

export class CancelError extends Error {
  constructor(message?: string) {
    super(message ?? 'Request cancelled');
    this.name = 'CancelError';
  }
}

export function createCancelToken(): {
  token: AbortSignal;
  cancel: (reason?: string) => void;
} {
  const controller = new AbortController();
  return {
    token: controller.signal,
    cancel: (reason?: string) => {
      controller.abort(new CancelError(reason));
    },
  };
}

export type TimeoutScope = 'request' | 'total';

/**
 * Abort reason used when a request exceeds `timeout` (scope `request`) or `totalTimeout`
 * (scope `total`, which also covers retries and back-off delays).
 */
export class TimeoutError extends Error {
  readonly timeout: number;
  readonly scope: TimeoutScope;

  constructor(timeout: number, scope: TimeoutScope = 'request') {
    super(
      scope === 'total' ? `Total timeout of ${timeout}ms exceeded` : `Timed out after ${timeout}ms`,
    );
    this.name = 'TimeoutError';
    this.timeout = timeout;
    this.scope = scope;
  }
}

/**
 * Wraps the `TypeError` that `fetch()` throws when the transport fails (DNS, refused
 * connection, TLS, CORS). It extends `TypeError` so existing `instanceof` checks keep
 * working; `code` carries the platform error code when one is available (`ECONNREFUSED`…).
 */
export class NetworkError extends TypeError {
  readonly code: string | undefined;

  constructor(cause: unknown) {
    const original = cause instanceof Error ? cause : new Error(String(cause));
    super(original.message, { cause: original });
    this.name = 'NetworkError';
    this.code = findErrorCode(original);
  }
}

/**
 * Thrown by `parseResponseBody` when a body cannot be decoded as its declared media type.
 * `raw` holds the body text when it could be read, so callers can still inspect it.
 */
export class ParseError extends Error {
  readonly contentType: string | null;
  readonly raw: string | undefined;

  constructor(contentType: string | null, cause: unknown, raw?: string) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse ${contentType ?? 'untyped'} response body: ${reason}`, { cause });
    this.name = 'ParseError';
    this.contentType = contentType;
    this.raw = raw;
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

// Chrome "Failed to fetch", Firefox "NetworkError when attempting to fetch resource.",
// Safari "Load failed", Node/undici "fetch failed".
const NETWORK_MESSAGE_RE = /fetch|network|load failed/;

/** Walks `error.cause` chains (undici nests the socket error) looking for a string `code`. */
function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

function isSuccessStatus(status: number): boolean {
  return status >= STATUS_RANGES.SUCCESS_MIN && status <= STATUS_RANGES.SUCCESS_MAX;
}

export function classifyProblem(status?: number, error?: Error): PROBLEM_CODE {
  if (error) {
    const name = error.name;
    const message = error.message?.toLowerCase() ?? '';

    // Our TimeoutError, AbortSignal.timeout()'s DOMException, undici's HeadersTimeoutError…
    if (name.endsWith('TimeoutError')) return PROBLEM_CODE.TIMEOUT_ERROR;
    if (name === 'CancelError') return PROBLEM_CODE.CANCEL_ERROR;
    if (name === 'ParseError') return PROBLEM_CODE.PARSE_ERROR;
    if (name === 'AbortError' || message.includes('aborted')) {
      return message.includes('timeout') ? PROBLEM_CODE.TIMEOUT_ERROR : PROBLEM_CODE.CANCEL_ERROR;
    }

    if (name === 'NetworkError' || (name === 'TypeError' && NETWORK_MESSAGE_RE.test(message))) {
      const code = error instanceof NetworkError ? error.code : findErrorCode(error);
      return code !== undefined && CONNECTION_CODES.has(code)
        ? PROBLEM_CODE.CONNECTION_ERROR
        : PROBLEM_CODE.NETWORK_ERROR;
    }

    // Fallbacks for foreign errors that only describe themselves in their message.
    if (message.includes('timeout')) return PROBLEM_CODE.TIMEOUT_ERROR;
    if (message.includes('connection') || message.includes('refused')) {
      return PROBLEM_CODE.CONNECTION_ERROR;
    }
  }

  if (status !== undefined) {
    if (status >= STATUS_RANGES.CLIENT_ERROR_MIN && status <= STATUS_RANGES.CLIENT_ERROR_MAX) {
      return PROBLEM_CODE.CLIENT_ERROR;
    }
    if (status >= STATUS_RANGES.SERVER_ERROR_MIN && status <= STATUS_RANGES.SERVER_ERROR_MAX) {
      return PROBLEM_CODE.SERVER_ERROR;
    }
    if (isSuccessStatus(status)) {
      return PROBLEM_CODE.NONE;
    }
  }

  return PROBLEM_CODE.UNKNOWN_ERROR;
}

export function buildRefetchError(
  error: Error,
  status?: number,
  duration?: number,
  statusText?: string,
  contentType?: string | null,
): RefetchError {
  const problem = classifyProblem(status, error);

  switch (problem) {
    case PROBLEM_CODE.TIMEOUT_ERROR:
      return { kind: 'timeout', duration: duration ?? 0, cause: error };

    case PROBLEM_CODE.CANCEL_ERROR:
      return {
        kind: 'cancel',
        reason: error.message !== 'Request cancelled' ? error.message : undefined,
        cause: error,
      };

    case PROBLEM_CODE.NETWORK_ERROR:
    case PROBLEM_CODE.CONNECTION_ERROR:
      return { kind: 'network', cause: error as TypeError };

    case PROBLEM_CODE.PARSE_ERROR:
      return {
        kind: 'parse',
        contentType: error instanceof ParseError ? error.contentType : (contentType ?? null),
        cause: error,
      };

    case PROBLEM_CODE.CLIENT_ERROR:
    case PROBLEM_CODE.SERVER_ERROR:
      return { kind: 'http', status: status ?? 0, statusText: statusText ?? '' };

    default:
      // Any other non-2xx status (1xx, 3xx under redirect: 'manual', opaque 0) is still an
      // HTTP-level failure with a status the caller can act on.
      if (status !== undefined && !isSuccessStatus(status)) {
        return { kind: 'http', status, statusText: statusText ?? '' };
      }
      if (error.name === 'ParseError' || error.message.includes('parse')) {
        return { kind: 'parse', contentType: contentType ?? null, cause: error };
      }
      return { kind: 'unknown', cause: error };
  }
}
