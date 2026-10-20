import { DEFAULT_TIMEOUT } from './constants';
import { TimeoutError } from './errors';

/** `setTimeout` cannot schedule beyond a signed 32-bit millisecond value. */
const MAX_TIMEOUT = 2_147_483_647;

/** `undefined` → use the fallback; `0` or `false` → no timeout; otherwise milliseconds. */
export type TimeoutInput = number | false | undefined;

/**
 * Resolves the effective timeout. The request value wins over the instance fallback,
 * `undefined` means "use the fallback" (ultimately `DEFAULT_TIMEOUT`), and `0` or `false`
 * disable the timeout entirely. Invalid values throw so programmer errors surface early.
 */
export function resolveTimeout(
  timeout: TimeoutInput,
  fallback: TimeoutInput = DEFAULT_TIMEOUT,
  label = 'timeout',
): number | false {
  const value = timeout ?? fallback ?? DEFAULT_TIMEOUT;
  if (value === false || value === 0) return false;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new TypeError(`${label} must be a number >= 0 or false`);
  }
  if (value > MAX_TIMEOUT) {
    throw new RangeError(`${label} exceeds ${MAX_TIMEOUT}ms`);
  }
  return value;
}

export interface AttemptSignalOptions {
  /** The caller's cancellation signal. */
  signal?: AbortSignal | null;
  /** Per-attempt timeout; resolved with `resolveTimeout`. */
  timeout?: TimeoutInput;
  /** Further signals that abort the attempt, e.g. a `totalTimeout` deadline. */
  extraSignals?: AbortSignal[];
}

export interface AttemptSignal {
  /** Aborts when the caller's signal, any extra signal, or the timeout fires. */
  readonly signal: AbortSignal;
  /** Stops the timeout timer while keeping the caller's signal linked. */
  clearTimeout(): void;
  /** Stops the timer and detaches any listeners; call once the attempt has settled. */
  dispose(): void;
}

/**
 * Builds one signal for a request attempt out of the caller's signal, optional extra
 * signals and a timeout. Uses `AbortSignal.any` where available and falls back to manual
 * listener forwarding (honouring already-aborted sources) elsewhere.
 */
export function createAttemptSignal(options: AttemptSignalOptions = {}): AttemptSignal {
  const timeout = resolveTimeout(options.timeout);
  const sources: AbortSignal[] = [];
  if (options.signal) sources.push(options.signal);
  if (options.extraSignals) sources.push(...options.extraSignals);

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout !== false) {
    const timeoutController = new AbortController();
    timer = setTimeout(() => timeoutController.abort(new TimeoutError(timeout)), timeout);
    sources.push(timeoutController.signal);
  }
  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const detach: Array<() => void> = [];
  let signal: AbortSignal;
  if (typeof AbortSignal.any === 'function') {
    signal = AbortSignal.any(sources);
  } else {
    const controller = new AbortController();
    for (const source of sources) {
      if (source.aborted) {
        controller.abort(source.reason);
        break;
      }
      const onAbort = () => controller.abort(source.reason);
      source.addEventListener('abort', onAbort, { once: true });
      detach.push(() => source.removeEventListener('abort', onAbort));
    }
    signal = controller.signal;
  }

  return {
    signal,
    clearTimeout: clear,
    dispose() {
      clear();
      for (const off of detach) off();
      detach.length = 0;
    },
  };
}

/**
 * `fetch` with a timeout that covers the wait for response headers. The caller's `signal`
 * stays linked to the returned response, so aborting it still cancels the body.
 */
export async function fetchWithTimeout(
  url: string,
  config: RequestInit & { timeout?: TimeoutInput },
): Promise<Response> {
  const { timeout, signal, ...init } = config;
  const attempt = createAttemptSignal({ signal, timeout });
  try {
    return await fetch(url, { ...init, signal: attempt.signal });
  } finally {
    attempt.dispose();
  }
}
