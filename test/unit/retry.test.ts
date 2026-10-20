import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRetryDelay, normalizeRetryConfig, shouldRetry, sleep } from '../../src/retry';
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

  it('defers entirely to a custom condition', () => {
    expect(shouldRetry(failed(404), { attempts: 3, condition: () => true })).toBe(true);
    expect(shouldRetry(failed(500), { attempts: 3, condition: () => false })).toBe(false);
    expect(shouldRetry(succeeded, { attempts: 3, condition: () => true })).toBe(true);
  });

  // Known bug #3 — cancelled requests are retried today.
  it.fails('never retries cancelled requests (known bug #3)', () => {
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
});
