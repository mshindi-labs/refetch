import type { ApiResponse } from './types';
import { headersToObject } from './headers';
import { classifyProblem, buildRefetchError } from './errors';
import { JSON_LIKE_RE } from './body';

// Matches binary MIME prefixes and known binary application subtypes
const BINARY_PREFIX_RE = /^(image|audio|video)\//i;
const BINARY_APP_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-zip-compressed',
  'application/x-bzip2',
  'application/wasm',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'font/woff',
  'font/woff2',
  'font/ttf',
  'font/otf',
]);

export async function parseResponseBody<T>(
  response: Response,
): Promise<T | string | Blob | Record<string, string> | null> {
  // No-body status codes — never attempt to read
  if (response.status === 204 || response.status === 304) return null;
  if (response.headers.get('content-length') === '0') return null;

  const contentType = response.headers.get('content-type');
  const mimeType = contentType ? contentType.split(';')[0].trim().toLowerCase() : '';

  try {
    if (!mimeType) {
      const text = await response.text();
      return text || null;
    }

    // JSON: exact match or +json suffix (application/vnd.api+json, application/ld+json, etc.)
    if (mimeType === 'application/json' || JSON_LIKE_RE.test(mimeType)) {
      return (await response.json()) as T;
    }

    // URL-encoded form data → plain object
    if (mimeType === 'application/x-www-form-urlencoded') {
      const text = await response.text();
      return Object.fromEntries(new URLSearchParams(text).entries()) as unknown as T;
    }

    // Binary types → Blob
    if (BINARY_PREFIX_RE.test(mimeType) || BINARY_APP_TYPES.has(mimeType)) {
      return await response.blob();
    }

    // Text types: text/*, application/xml, application/xhtml+xml
    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/xml' ||
      mimeType === 'application/xhtml+xml'
    ) {
      return await response.text();
    }

    // multipart/* and everything else: return as text
    return await response.text();
  } catch {
    return null;
  }
}

export function normalizeSuccessResponse<T>(
  data: T,
  response: Response,
  duration: number,
): ApiResponse<T> {
  return {
    ok: true,
    problem: null,
    originalError: null,
    data,
    status: response.status,
    headers: headersToObject(response.headers),
    duration,
    response,
  };
}

export function normalizeErrorResponse<T>(
  error: Error,
  response?: Response,
  duration?: number,
): ApiResponse<T> {
  const status = response?.status;
  const statusText = response?.statusText;
  const contentType = response?.headers.get('content-type') ?? undefined;
  const problem = classifyProblem(status, error);
  const refetchError = buildRefetchError(error, status, duration, statusText, contentType);

  return {
    ok: false,
    problem,
    error: refetchError,
    originalError: error,
    data: undefined,
    status,
    headers: response ? headersToObject(response.headers) : undefined,
    duration,
    response,
  } as ApiResponse<T>;
}
