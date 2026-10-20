import { describe, expect, it } from 'vitest';
import {
  buildRefetchError,
  CancelError,
  classifyProblem,
  createCancelToken,
  NetworkError,
  ParseError,
  TimeoutError,
} from '../../src/errors';
import { PROBLEM_CODE } from '../../src/types';

const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

/** What undici throws for a refused connection: TypeError('fetch failed') with a coded cause. */
const refused = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }),
  });

describe('TimeoutError and NetworkError', () => {
  it('TimeoutError carries the timeout and scope', () => {
    const error = new TimeoutError(500);
    expect(error.name).toBe('TimeoutError');
    expect(error.timeout).toBe(500);
    expect(error.scope).toBe('request');
    expect(error.message).toContain('500');
    expect(new TimeoutError(9, 'total').scope).toBe('total');
  });

  it('NetworkError wraps the transport TypeError and extracts the error code', () => {
    const cause = refused();
    const error = new NetworkError(cause);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.name).toBe('NetworkError');
    expect(error.message).toBe('fetch failed');
    expect(error.cause).toBe(cause);
    expect(error.code).toBe('ECONNREFUSED');
  });

  it('ParseError carries the content type, the raw body and the cause', () => {
    const cause = new SyntaxError('Unexpected token');
    const error = new ParseError('application/json', cause, '{bad');
    expect(error.name).toBe('ParseError');
    expect(error.contentType).toBe('application/json');
    expect(error.raw).toBe('{bad');
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('application/json');
    expect(new ParseError(null, 'oops').contentType).toBeNull();
  });

  it('NetworkError tolerates causes without a code or that are not Errors', () => {
    expect(new NetworkError(new TypeError('Load failed')).code).toBeUndefined();
    expect(new NetworkError('boom').message).toBe('boom');
  });
});

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
    [
      'a TimeoutError raised by the client',
      new TimeoutError(10),
      undefined,
      PROBLEM_CODE.TIMEOUT_ERROR,
    ],
    [
      'a NetworkError with a connection code',
      new NetworkError(refused()),
      undefined,
      PROBLEM_CODE.CONNECTION_ERROR,
    ],
    [
      'a NetworkError without a code',
      new NetworkError(new TypeError('Load failed')),
      undefined,
      PROBLEM_CODE.NETWORK_ERROR,
    ],
    [
      'a raw TypeError carrying a connection code',
      refused(),
      undefined,
      PROBLEM_CODE.CONNECTION_ERROR,
    ],
    [
      'a ParseError',
      new ParseError('application/json', new SyntaxError('bad'), '{'),
      undefined,
      PROBLEM_CODE.PARSE_ERROR,
    ],
    [
      'a ParseError even with a 2xx status',
      new ParseError('text/plain', new Error('bad')),
      200,
      PROBLEM_CODE.PARSE_ERROR,
    ],
    ['nothing at all', undefined, undefined, PROBLEM_CODE.UNKNOWN_ERROR],
  ])('classifies %s', (_label, error, status, expected) => {
    expect(classifyProblem(status, error)).toBe(expected);
  });

  it('prefers the error over the status when both are present', () => {
    expect(classifyProblem(500, named('AbortError', 'aborted'))).toBe(PROBLEM_CODE.CANCEL_ERROR);
  });

  it('falls back to the message for foreign errors that mention a timeout', () => {
    expect(classifyProblem(undefined, new Error('Request timeout'))).toBe(
      PROBLEM_CODE.TIMEOUT_ERROR,
    );
  });

  it('classifies Safari "Load failed" as NETWORK_ERROR', () => {
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

  it('treats an opaque status 0 as an http error', () => {
    expect(buildRefetchError(new Error('HTTP 0'), 0, 1, '')).toEqual({
      kind: 'http',
      status: 0,
      statusText: '',
    });
  });

  it('builds parse errors from ParseError instances using their own content type', () => {
    const error = new ParseError('application/vnd.api+json', new SyntaxError('bad'), '{');
    expect(buildRefetchError(error, 200, 3)).toEqual({
      kind: 'parse',
      contentType: 'application/vnd.api+json',
      cause: error,
    });
  });

  it('falls back to unknown', () => {
    expect(buildRefetchError(new Error('???')).kind).toBe('unknown');
  });

  it('treats statuses outside 4xx/5xx as http errors when not ok', () => {
    expect(buildRefetchError(new Error('HTTP 301'), 301, 1, 'Moved Permanently').kind).toBe('http');
  });
});
