import { DEFAULT_TIMEOUT } from './constants';

export async function fetchWithTimeout(
  url: string,
  config: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, signal, ...fetchConfig } = config;

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signalHandler: (() => void) | undefined;

  try {
    if (timeout) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error('Request timeout'));
      }, timeout);
    }

    if (signal) {
      signalHandler = () => {
        controller.abort(signal.reason);
      };
      signal.addEventListener('abort', signalHandler);
    }

    const response = await fetch(url, {
      ...fetchConfig,
      signal: controller.signal,
    });

    return response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && signalHandler) {
      signal.removeEventListener('abort', signalHandler);
    }
  }
}
