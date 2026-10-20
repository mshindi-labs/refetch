import {
  type ApiErrorResponse,
  type ApiOkResponse,
  type ApiResponse,
  isErrorResponse,
  isOkResponse,
} from '../../src/types';

/** Narrows to the ok branch or throws a descriptive assertion error. */
export function asOk<T>(response: ApiResponse<T>): ApiOkResponse<T> {
  if (!isOkResponse(response)) {
    throw new Error(
      `expected an ok response, got problem=${response.problem} status=${response.status}: ${response.originalError?.message}`,
    );
  }
  return response;
}

/** Narrows to the error branch or throws a descriptive assertion error. */
export function asError<T>(response: ApiResponse<T>): ApiErrorResponse<T> {
  if (!isErrorResponse(response)) {
    throw new Error(`expected an error response, got ok with status=${response.status}`);
  }
  return response;
}
