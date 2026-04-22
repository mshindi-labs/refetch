import { PROBLEM_CODE, type RefetchError } from './types';
import { STATUS_RANGES } from './constants';

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

export function classifyProblem(status?: number, error?: Error): PROBLEM_CODE {
  if (error) {
    const errorName = error.name;
    const errorMessage = error.message?.toLowerCase() || '';

    if (
      errorName === 'AbortError' ||
      errorName === 'CancelError' ||
      errorMessage.includes('aborted')
    ) {
      if (errorMessage.includes('timeout')) {
        return PROBLEM_CODE.TIMEOUT_ERROR;
      }
      return PROBLEM_CODE.CANCEL_ERROR;
    }

    if (
      errorName === 'TypeError' &&
      (errorMessage.includes('fetch') || errorMessage.includes('network'))
    ) {
      return PROBLEM_CODE.NETWORK_ERROR;
    }

    if (
      errorMessage.includes('connection') ||
      errorMessage.includes('refused')
    ) {
      return PROBLEM_CODE.CONNECTION_ERROR;
    }
  }

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

    case PROBLEM_CODE.CLIENT_ERROR:
    case PROBLEM_CODE.SERVER_ERROR:
      return {
        kind: 'http',
        status: status!,
        statusText: statusText ?? '',
      };

    default:
      // Detect parse errors by name convention
      if (error.name === 'ParseError' || error.message.includes('parse')) {
        return {
          kind: 'parse',
          contentType: contentType ?? null,
          cause: error,
        };
      }
      return { kind: 'unknown', cause: error };
  }
}
