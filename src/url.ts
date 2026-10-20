import type { ParamsSerializer, QueryParams } from './types';

function appendValue(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (value instanceof Date) {
    search.append(key, value.toISOString());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendValue(search, key, item);
    return;
  }
  if (typeof value === 'object') {
    throw new TypeError(
      `Query parameter "${key}" is an object; serialise it yourself or pass a paramsSerializer`,
    );
  }
  search.append(key, String(value));
}

/**
 * Serialises query parameters with `URLSearchParams` semantics: arrays repeat the key, Dates
 * become ISO 8601 strings, `null` and `undefined` are omitted, and nested objects throw.
 */
export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) return '';
  if (params instanceof URLSearchParams) return params.toString();
  const search = new URLSearchParams();
  const entries = Array.isArray(params) ? params : Object.entries(params);
  for (const [key, value] of entries) appendValue(search, key, value);
  return search.toString();
}

export function buildUrl(
  baseURL: string | undefined,
  url: string,
  params?: QueryParams,
  serializer?: ParamsSerializer,
): string {
  if (typeof url !== 'string') {
    throw new TypeError('URL must be a string');
  }

  const queryString = params ? (serializer ? serializer(params) : buildQueryString(params)) : '';

  let fullUrl: string;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    fullUrl = url;
  } else if (baseURL) {
    const normalizedBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
    fullUrl = normalizedBase + normalizedUrl;
  } else {
    fullUrl = url;
  }

  if (queryString) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
  }

  return fullUrl;
}
