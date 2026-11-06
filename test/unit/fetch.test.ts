import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUT } from '../../src/constants';
import { CancelError, TimeoutError } from '../../src/errors';
import { createAttemptSignal, fetchWithTimeout, resolveTimeout } from '../../src/fetch';

const withoutAbortSignalAny = () => {
  const original = AbortSignal.any;
  beforeEach(() => {
    Object.defineProperty(AbortSignal, 'any', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(AbortSignal, 'any', {
      value: original,
      configurable: true,
      writable: true,
    });
  });
};

describe('resolveTimeout', () => {
  it('falls back to the default when nothing is configured', () => {
    expect(resolveTimeout(undefined)).toBe(DEFAULT_TIMEOUT);
    expect(resolveTimeout(undefined, undefined)).toBe(DEFAULT_TIMEOUT);
  });

  it('prefers the request value over the instance fallback', () => {
    expect(resolveTimeout(250, 1000)).toBe(250);
    expect(resolveTimeout(undefined, 1000)).toBe(1000);
  });

  it('treats 0 and false as disabled', () => {
    expect(resolveTimeout(0, 1000)).toBe(false);
    expect(resolveTimeout(false, 1000)).toBe(false);
    expect(resolveTimeout(undefined, 0)).toBe(false);
    expect(resolveTimeout(undefined, false)).toBe(false);
  });

  it('rejects negative, NaN and oversized values', () => {
    expect(() => resolveTimeout(-1)).toThrow(TypeError);
    expect(() => resolveTimeout(Number.NaN)).toThrow(TypeError);
    expect(() => resolveTimeout(2 ** 31)).toThrow(RangeError);
  });
});

describe('createAttemptSignal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts with a TimeoutError when the timeout elapses', () => {
    vi.useFakeTimers();
    const attempt = createAttemptSignal({ timeout: 100 });
    vi.advanceTimersByTime(99);
    expect(attempt.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toBeInstanceOf(TimeoutError);
    expect((attempt.signal.reason as TimeoutError).timeout).toBe(100);
    attempt.dispose();
  });

  it('never aborts on its own when the timeout is disabled', () => {
    vi.useFakeTimers();
    const attempt = createAttemptSignal({ timeout: false });
    vi.advanceTimersByTime(DEFAULT_TIMEOUT * 2);
    expect(attempt.signal.aborted).toBe(false);
    attempt.dispose();
  });

  it('is already aborted when the caller signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort(new CancelError('early'));
    const attempt = createAttemptSignal({ signal: controller.signal, timeout: 100 });
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.signal.reason).toBeInstanceOf(CancelError);
    attempt.dispose();
  });

  it('forwards the caller abort reason', () => {
    const controller = new AbortController();
    const attempt = createAttemptSignal({ signal: controller.signal, timeout: false });
    controller.abort(new CancelError('later'));
    expect(attempt.signal.aborted).toBe(true);
    expect((attempt.signal.reason as Error).message).toBe('later');
    attempt.dispose();
  });

  it('also aborts for extra signals such as a total deadline', () => {
    const deadline = new AbortController();
    const attempt = createAttemptSignal({ timeout: false, extraSignals: [deadline.signal] });
    deadline.abort(new TimeoutError(5, 'total'));
    expect(attempt.signal.reason).toBeInstanceOf(TimeoutError);
    attempt.dispose();
  });

  it('clearTimeout stops the timer but keeps the caller link', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const attempt = createAttemptSignal({ signal: controller.signal, timeout: 50 });
    attempt.clearTimeout();
    vi.advanceTimersByTime(1000);
    expect(attempt.signal.aborted).toBe(false);
    controller.abort();
    expect(attempt.signal.aborted).toBe(true);
    attempt.dispose();
  });

  describe('without AbortSignal.any', () => {
    withoutAbortSignalAny();

    it('combines signals with listeners and removes them on dispose', () => {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const attempt = createAttemptSignal({ signal: controller.signal, timeout: false });
      expect(attempt.signal.aborted).toBe(false);
      attempt.dispose();
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      controller.abort();
      expect(attempt.signal.aborted).toBe(false);
    });

    it('honours an already-aborted caller signal', () => {
      const controller = new AbortController();
      controller.abort(new CancelError('pre'));
      const attempt = createAttemptSignal({ signal: controller.signal, timeout: 100 });
      expect(attempt.signal.reason).toBeInstanceOf(CancelError);
      attempt.dispose();
    });

    it('forwards aborts while attached', () => {
      const controller = new AbortController();
      const attempt = createAttemptSignal({ signal: controller.signal, timeout: false });
      controller.abort(new CancelError('x'));
      expect(attempt.signal.aborted).toBe(true);
      expect((attempt.signal.reason as Error).message).toBe('x');
      attempt.dispose();
    });
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A fetch stand-in that settles only through its signal, like a request that never answers. */
  const neverAnswers = () =>
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

  it('rejects immediately when the signal is already aborted', async () => {
    vi.stubGlobal('fetch', neverAnswers());
    const controller = new AbortController();
    controller.abort(new CancelError('pre'));
    await expect(
      fetchWithTimeout('http://x', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelError);
  });

  it('rejects with a TimeoutError after the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', neverAnswers());
    const assertion = expect(fetchWithTimeout('http://x', { timeout: 30 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
  });

  it('passes a combined signal to fetch and strips the timeout option', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit & { timeout?: unknown }) =>
      Promise.resolve(new Response('ok')),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithTimeout('http://x', { timeout: 50, method: 'POST' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe('POST');
    expect(init && 'timeout' in init).toBe(false);
  });
});
