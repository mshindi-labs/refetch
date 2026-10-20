export function mergeHeaders(...headersList: (HeadersInit | undefined)[]): Headers {
  const merged = new Headers();

  for (const headers of headersList) {
    if (!headers) continue;

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        merged.set(key, value);
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        merged.set(key, value);
      });
    } else {
      Object.entries(headers).forEach(([key, value]) => {
        merged.set(key, value);
      });
    }
  }

  return merged;
}

export function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * Returns a copy of `config` with `name` set to `value`, whatever `HeadersInit` shape
 * `config.headers` has. The returned headers are a plain object with lower-cased keys.
 */
export function setRequestHeader<T extends { headers?: HeadersInit }>(
  config: T,
  name: string,
  value: string,
): T {
  const headers = mergeHeaders(config.headers);
  headers.set(name, value);
  return { ...config, headers: headersToObject(headers) };
}
