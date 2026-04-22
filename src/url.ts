export function buildQueryString(params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return '';
  }

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });

  return searchParams.toString();
}

export function buildUrl(
  baseURL: string | undefined,
  url: string,
  params?: Record<string, unknown>,
): string {
  if (typeof url !== 'string') {
    throw new TypeError('URL must be a string');
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const queryString = buildQueryString(params || {});
    if (queryString) {
      return url + (url.includes('?') ? '&' : '?') + queryString;
    }
    return url;
  }

  let fullUrl: string;
  if (baseURL) {
    const normalizedBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const normalizedUrl = url.startsWith('/') ? url : '/' + url;
    fullUrl = normalizedBase + normalizedUrl;
  } else {
    fullUrl = url;
  }

  const queryString = buildQueryString(params || {});
  if (queryString) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
  }

  return fullUrl;
}
