import { describe, expect, it } from 'vitest';
import {
  buildRefetchError,
  CancelError,
  classifyProblem,
  createCancelToken,
} from '../../src/errors';
import { PROBLEM_CODE } from '../../src/types';

const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

describe('CancelError and createCancelToken', () => {
  it('defaults the message and sets the name', () => {
    const error = new CancelError();
    expect(error.name).toBe('CancelError');
    expect(error.message).toBe('Request cancelled');
    expect(error).toBeInstanceOf(Error);
  });

  it('aborts the token with a CancelError carrying the reason', () => {
    const { token, cancel } = createCancelToken();
    expect(token.aborted).toBe(false);
    cancel('navigated away');
    expect(token.aborted).toBe(true);
    expect(token.reason).toBeInstanceOf(CancelError);
    expect((token.reason as CancelError).message).toBe('navigated away');
  });
});

describe('classifyProblem', () => {
  it.each<[string, Error | undefined, number | undefined, PROBLEM_CODE]>([
    [
      'an AbortError',
      named('AbortError', 'This operation was aborted'),
      undefined,
      PROBLEM_CODE.CANCEL_ERROR,
    ],
    ['a CancelError', new CancelError(), undefined, PROBLEM_CODE.CANCEL_ERROR],
    [
      'an AbortSignal.timeout() reason',
      named('TimeoutError', 'The operation was aborted due to timeout'),
      undefined,
      PROBLEM_CODE.TIMEOUT_ERROR,
    ],
    [
      'a Node (undici) network failure',
      new TypeError('fetch failed'),
      undefined,
      PROBLEM_CODE.NETWORK_ERROR,
    ],
    [
      'a Chromium network failure',
      new TypeError('Failed to fetch'),
      undefined,
      PROBLEM_CODE.NETWORK_ERROR,
    ],
    [
      'a Firefox network failure',
      new TypeError('NetworkError when attempting to fetch resource.'),
      undefined,
      PROBLEM_CODE.NETWORK_ERROR,
    ],
    [
      'a connection-refused message',
      new Error('connect ECONNREFUSED 127.0.0.1:1 (connection refused)'),
      undefined,
      PROBLEM_CODE.CONNECTION_ERROR,
    ],
    ['a 4xx status', undefined, 404, PROBLEM_CODE.CLIENT_ERROR],
    ['a 5xx status', undefined, 503, PROBLEM_CODE.SERVER_ERROR],
    ['a 2xx status', undefined, 204, PROBLEM_CODE.NONE],
    ['nothing at all', undefined, undefined, PROBLEM_CODE.UNKNOWN_ERROR],
  ])('classifies %s', (_label, error, status, expected) => {
    expect(classifyProblem(status, error)).toBe(expected);
  });

  it('prefers the error over the status when both are present', () => {
    expect(classifyProblem(500, named('AbortError', 'aborted'))).toBe(PROBLEM_CODE.CANCEL_ERROR);
  });

  // Known bugs #2 and #10 — flip `it.fails` to `it` when fixed.
  it.fails('classifies the internal timeout reason as TIMEOUT_ERROR (known bug #2)', () => {
    expect(classifyProblem(undefined, new Error('Request timeout'))).toBe(
      PROBLEM_CODE.TIMEOUT_ERROR,
    );
  });

  it.fails('classifies Safari "Load failed" as NETWORK_ERROR (known bug #10)', () => {
    expect(classifyProblem(undefined, new TypeError('Load failed'))).toBe(
      PROBLEM_CODE.NETWORK_ERROR,
    );
  });
});

describe('buildRefetchError', () => {
  it('builds timeout errors with the duration', () => {
    const error = named('TimeoutError', 'aborted due to timeout');
    expect(buildRefetchError(error, undefined, 1500)).toEqual({
      kind: 'timeout',
      duration: 1500,
      cause: error,
    });
  });

  it('builds cancel errors, omitting the default reason', () => {
    expect(buildRefetchError(new CancelError())).toMatchObject({
      kind: 'cancel',
      reason: undefined,
    });
    expect(buildRefetchError(new CancelError('bye'))).toMatchObject({
      kind: 'cancel',
      reason: 'bye',
    });
  });

  it('builds network errors for network and connection problems', () => {
    expect(buildRefetchError(new TypeError('fetch failed')).kind).toBe('network');
    expect(buildRefetchError(new Error('connection refused')).kind).toBe('network');
  });

  it('builds http errors with status and statusText', () => {
    expect(buildRefetchError(new Error('HTTP 404'), 404, 3, 'Not Found')).toEqual({
      kind: 'http',
      status: 404,
      statusText: 'Not Found',
    });
  });

  it('builds parse errors from ParseError-named errors', () => {
    const error = named('ParseError', 'bad');
    expect(buildRefetchError(error, undefined, undefined, undefined, 'application/json')).toEqual({
      kind: 'parse',
      contentType: 'application/json',
      cause: error,
    });
  });

  it('falls back to unknown', () => {
    expect(buildRefetchError(new Error('???')).kind).toBe('unknown');
  });

  it.fails('treats statuses outside 4xx/5xx as http errors when not ok (known bug #10)', () => {
    expect(buildRefetchError(new Error('HTTP 301'), 301, 1, 'Moved Permanently').kind).toBe('http');
  });
});
