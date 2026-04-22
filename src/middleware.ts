import type { RefetchInstance, RequestConfig } from './types';

type InstanceMiddleware = (instance: RefetchInstance) => RefetchInstance;

/**
 * Injects an Authorization header before every request.
 * `getToken` is called per-request so tokens are always fresh.
 */
export function withAuth(
  getToken: () => string | Promise<string>,
): InstanceMiddleware {
  return (instance) => {
    instance.interceptors.request.use(async (config: RequestConfig) => {
      const token = await getToken();
      return {
        ...config,
        headers: {
          ...(config.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${token}`,
        },
      };
    });
    return instance;
  };
}

/**
 * Overrides the timeout for all requests on this instance.
 */
export function withTimeout(ms: number): InstanceMiddleware {
  return (instance) => {
    instance.interceptors.request.use((config: RequestConfig) => ({
      ...config,
      timeout: ms,
    }));
    return instance;
  };
}

/**
 * Merges additional headers into every outgoing request.
 */
export function withHeaders(headers: HeadersInit): InstanceMiddleware {
  return (instance) => {
    const entries =
      headers instanceof Headers
        ? Object.fromEntries(headers.entries())
        : Array.isArray(headers)
          ? Object.fromEntries(headers)
          : (headers as Record<string, string>);

    instance.interceptors.request.use((config: RequestConfig) => ({
      ...config,
      headers: {
        ...(config.headers as Record<string, string> | undefined),
        ...entries,
      },
    }));
    return instance;
  };
}

/**
 * Overrides the base URL for all requests on this instance.
 */
export function withBaseURL(url: string): InstanceMiddleware {
  return (instance) => {
    instance.setBaseURL(url);
    return instance;
  };
}

/**
 * Logs every request and response via the supplied logger (defaults to `console`).
 */
export function withLogging(
  logger: Pick<Console, 'log' | 'warn' | 'error'> = console,
): InstanceMiddleware {
  return (instance) => {
    instance.interceptors.request.use((config: RequestConfig) => {
      logger.log(`[refetch] → ${config.method?.toUpperCase() ?? 'GET'} ${config.url}`);
      return config;
    });

    instance.interceptors.response.use((response) => {
      if (response.ok) {
        logger.log(
          `[refetch] ← ${response.status} (${response.duration}ms)`,
        );
      } else {
        logger.warn(
          `[refetch] ← ${response.status ?? 'ERR'} ${response.problem} (${response.duration}ms)`,
        );
      }
      return response;
    });

    return instance;
  };
}
