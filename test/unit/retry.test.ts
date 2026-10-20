import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelError } from '../../src/errors';
import {
  exponentialBackoff,
  getRetryDelay,
  normalizeRetryConfig,
  retryAfterDelay,
  shouldRetry,
  sleep,
} from '../../src/retry';
import { type ApiResponse, PROBLEM_CODE } from '../../src/types';

const failed = (status?: number): ApiResponse<unknown> => ({
  ok: false,
  problem: status ? PROBLEM_CODE.SERVER_ERROR : PROBLEM_CODE.NETWORK_ERROR,
  originalError: new Error('failed'),
  status,
});

const succeeded: ApiResponse<unknown> = {
  ok: true,
  problem: null,
  originalError: null,
  status: 200,
  data: {},
};

describe('normalizeRetryConfig', () => {
  it('returns null when retry is not configured', () => {
    expect(normalizeRetryConfig(undefined)).toBeNull();
    expect(normalizeRetryConfig(null as unknown as undefined)).toBeNull();
  });

  it('expands the numeric shorthand', () => {
    expect(normalizeRetryConfig(3)).toEqual({ attempts: 3 });
  });

  it('returns object configs as-is', () => {
    const config = { attempts: 2, delay: 5 };
    expect(normalizeRetryConfig(config)).toBe(config);
  });
});

describe('getRetryDelay', () => {
  it('is 0 without a delay', () => {
    expect(getRetryDelay({ attempts: 2 }, 1)).toBe(0);
  });

  it('returns fixed delays', () => {
    expect(getRetryDelay({ attempts: 2, delay: 250 }, 1)).toBe(250);
  });

  it('calls delay functions with the 1-based attempt number', () => {
    const delay = vi.fn((attempt: number) => attempt * 100);
    expect(getRetryDelay({ attempts: 3, delay }, 2)).toBe(200);
    expect(delay).toHaveBeenCalledWith(2);
  });
});

describe('getRetryDelay back-off strategies', () => {
  it('keeps the base delay for fixed back-off', () => {
    expect(getRetryDelay({ attempts: 5, delay: 100, backoff: 'fixed' }, 3)).toBe(100);
  });

  it('multiplies by the attempt for linear back-off', () => {
    expect(getRetryDelay({ attempts: 5, delay: 100, backoff: 'linear' }, 3)).toBe(300);
  });

  it('doubles per attempt for exponential back-off', () => {
    const config = { attempts: 5, delay: 100, backoff: 'exponential' as const };
    expect(getRetryDelay(config, 1)).toBe(100);
    expect(getRetryDelay(config, 4)).toBe(800);
  });

  it('caps computed delays with maxDelay', () => {
    expect(
      getRetryDelay({ attempts: 9, delay: 100, backoff: 'exponential', maxDelay: 250 }, 5),
    ).toBe(250);
  });

  it('applies full jitter within [0, delay]', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(getRetryDelay({ attempts: 3, delay: 200, jitter: true }, 1)).toBe(100);
    random.mockRestore();
  });

  it('lets a delay function win over the strategy', () => {
    expect(getRetryDelay({ attempts: 3, delay: (n) => n * 7, backoff: 'exponential' }, 2)).toBe(14);
  });
});

describe('exponentialBackoff', () => {
  it('produces base * factor^(attempt - 1) capped at max', () => {
    const delay = exponentialBackoff({ base: 100, factor: 3, max: 1000 });
    expect([1, 2, 3, 4].map(delay)).toEqual([100, 300, 900, 1000]);
  });

  it('defaults to 300 ms doubling, capped at 30 s', () => {
    const delay = exponentialBackoff();
    expect(delay(1)).toBe(300);
    expect(delay(2)).toBe(600);
    expect(delay(20)).toBe(30_000);
  });

  it('jitters within [0, delay] when asked', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(exponentialBackoff({ base: 400, jitter: true })(1)).toBe(100);
    random.mockRestore();
  });
});

describe('retryAfterDelay', () => {
  const withHeaders = (headers: Record<string, string>): ApiResponse<unknown> => ({
    ...failed(429),
    headers,
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads Retry-After in seconds', () => {
    expect(retryAfterDelay(withHeaders({ 'retry-after': '2' }))).toBe(2000);
  });

  it('reads Retry-After as an HTTP-date relative to now, never negative', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
    expect(retryAfterDelay(withHeaders({ 'retry-after': 'Wed, 21 Oct 2026 00:00:03 GMT' }))).toBe(
      3000,
    );
    expect(retryAfterDelay(withHeaders({ 'retry-after': 'Tue, 20 Oct 2026 00:00:00 GMT' }))).toBe(
      0,
    );
  });

  it('reads RateLimit-Reset as seconds from now and X-RateLimit-Reset as a Unix timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(retryAfterDelay(withHeaders({ 'ratelimit-reset': '5' }))).toBe(5000);
    expect(retryAfterDelay(withHeaders({ 'x-ratelimit-reset': String(nowSeconds + 7) }))).toBe(
      7000,
    );
  });

  it('returns undefined without a usable header', () => {
    expect(retryAfterDelay(withHeaders({}))).toBeUndefined();
    expect(retryAfterDelay(withHeaders({ 'retry-after': 'soon' }))).toBeUndefined();
    expect(retryAfterDelay(failed(undefined))).toBeUndefined();
  });
});

describe('shouldRetry', () => {
  it('never retries successful responses', () => {
    expect(shouldRetry(succeeded, { attempts: 3 })).toBe(false);
  });

  it.each([400, 401, 403, 404, 422])('does not retry %s by default', (status) => {
    expect(shouldRetry(failed(status), { attempts: 3 })).toBe(false);
  });

  it.each([408, 429, 500, 502, 503])('retries %s by default', (status) => {
    expect(shouldRetry(failed(status), { attempts: 3 })).toBe(true);
  });

  it('retries transport failures that have no status by default', () => {
    expect(shouldRetry(failed(undefined), { attempts: 3 })).toBe(true);
  });

  it('does not retry parse errors by default but lets a condition opt in', () => {
    const parseFailure: ApiResponse<unknown> & { error: unknown } = {
      ...failed(200),
      problem: PROBLEM_CODE.PARSE_ERROR,
      error: { kind: 'parse', contentType: 'application/json', cause: new Error('bad') },
    };
    expect(shouldRetry(parseFailure, { attempts: 3 })).toBe(false);
    expect(shouldRetry(parseFailure, { attempts: 3, condition: () => true })).toBe(true);
  });

  it('retries only the listed methods when methods is set', () => {
    const config = { attempts: 3, methods: ['GET', 'put'] };
    expect(shouldRetry(failed(500), config, { method: 'GET' })).toBe(true);
    expect(shouldRetry(failed(500), config, { method: 'POST' })).toBe(false);
    expect(shouldRetry(failed(500), config, { method: 'PUT' })).toBe(true);
  });

  it('retries only the listed status codes when statusCodes is set, transport failures included', () => {
    const config = { attempts: 3, statusCodes: [503] };
    expect(shouldRetry(failed(503), config)).toBe(true);
    expect(shouldRetry(failed(500), config)).toBe(false);
    expect(shouldRetry(failed(undefined), config)).toBe(true);
  });

  it('defers entirely to a custom condition', () => {
    expect(shouldRetry(failed(404), { attempts: 3, condition: () => true })).toBe(true);
    expect(shouldRetry(failed(500), { attempts: 3, condition: () => false })).toBe(false);
    expect(shouldRetry(succeeded, { attempts: 3, condition: () => true })).toBe(true);
  });

  it('never retries cancelled requests', () => {
    const cancelled: ApiResponse<unknown> & { error: unknown } = {
      ...failed(undefined),
      problem: PROBLEM_CODE.CANCEL_ERROR,
      error: { kind: 'cancel', cause: new Error('cancelled') },
    };
    expect(shouldRetry(cancelled, { attempts: 3 })).toBe(false);
  });
});

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the given delay', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const pending = sleep(1000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toHaveBeenCalledOnce();
  });

  it('rejects with the abort reason when the signal fires during the delay', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const assertion = expect(sleep(1000, controller.signal)).rejects.toBeInstanceOf(CancelError);
    controller.abort(new CancelError('stop'));
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new CancelError('pre'));
    await expect(sleep(50, controller.signal)).rejects.toBeInstanceOf(CancelError);
  });

  it('resolves normally when the signal never fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = sleep(10, controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeUndefined();
  });
});
