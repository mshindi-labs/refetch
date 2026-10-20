# @mshindi-labs/refetch

[![CI](https://github.com/mshindi-labs/refetch/actions/workflows/ci.yml/badge.svg)](https://github.com/mshindi-labs/refetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40mshindi-labs%2Frefetch)](https://www.npmjs.com/package/@mshindi-labs/refetch)

A modern, production-grade HTTP client built on native `fetch` — pure functional TypeScript, interceptors, retry, streaming, and tree-shakeable exports.

## Features

- **Pure functional TypeScript** — no classes, no `this`, compose via `pipe()`
- **Interceptors** — axios-style request/response middleware with ID-based ejection
- **Discriminated error union** (`RefetchError`) for precise narrowing per error kind
- **Retry** — per-request and instance-wide, fully configurable with custom delay/condition
- **Streaming** — raw `ReadableStream` via `stream()`
- **Cancellation** — `createCancelToken()` wraps `AbortController`
- **Middleware HOFs** — `withAuth`, `withTimeout`, `withLogging`, `withHeaders`, `withBaseURL`
- **Full body support** — JSON, `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, `ReadableStream`
- **Full response parsing** — JSON, `+json` variants, form-encoded, binary, text, empty bodies
- **Tree-shakeable** — sub-path exports for retry, middleware, and pipe
- **Zero runtime dependencies**

## Installation

```bash
npm install @mshindi-labs/refetch
```

## Quick Start

```typescript
import { create } from '@mshindi-labs/refetch';

const api = create({
  baseURL: 'https://api.example.com',
  timeout: 10_000,
});

const response = await api.get<User>('/users/1');

if (response.ok) {
  console.log(response.data); // typed as User
} else {
  console.error(response.problem, response.error);
}
```

## HTTP Methods

`GET`, `HEAD`, and `DELETE` take a single response generic. `POST`, `PUT`, and `PATCH` take two — response type and body type:

```typescript
// Read
const user  = await api.get<User>('/users/1');
const users = await api.get<User[]>('/users', { page: 1, limit: 10 });

// Write — both generics explicit
const created = await api.post<User, CreateUserDto>('/users', dto);
const updated = await api.put<User, UpdateUserDto>('/users/1', data);
const patched = await api.patch<User, Partial<User>>('/users/1', { name: 'New' });

// Other
await api.delete('/users/1');
await api.head('/health');
await api.link('/images/1.jpg', {}, { headers: { Link: '<...>; rel="tag"' } });
await api.unlink('/images/1.jpg', {}, { headers: { Link: '<...>; rel="tag"' } });

// Any HTTP verb
await api.any({ method: 'PROPFIND', url: '/dav', headers: { Depth: '1' } });
```

## Response Format

Every request returns `ApiResponse<T>` — the shape is identical whether the request succeeded or failed:

```typescript
interface ApiResponse<T> {
  ok: boolean;              // true for 200–299
  problem: PROBLEM_CODE | null;
  originalError: Error | null;
  data?: T;
  status?: number;
  headers?: Record<string, string>;
  duration?: number;        // milliseconds
  response?: Response;      // raw fetch Response
}

// When ok === false, the error field is also present:
interface ApiErrorResponse<T> extends ApiResponse<T> {
  ok: false;
  problem: PROBLEM_CODE;
  error: RefetchError;      // discriminated union — see Error Handling
}
```

**Type guards:**

```typescript
import { isOkResponse, isErrorResponse } from '@mshindi-labs/refetch';

if (isOkResponse(response)) {
  response.data; // T — guaranteed present
}

if (isErrorResponse(response)) {
  response.error; // RefetchError — fully narrowable
}
```

## Error Handling

### PROBLEM_CODE

```typescript
import { PROBLEM_CODE } from '@mshindi-labs/refetch';

switch (response.problem) {
  case PROBLEM_CODE.CLIENT_ERROR:    // 400–499
  case PROBLEM_CODE.SERVER_ERROR:    // 500–599
  case PROBLEM_CODE.TIMEOUT_ERROR:
  case PROBLEM_CODE.NETWORK_ERROR:
  case PROBLEM_CODE.CONNECTION_ERROR:
  case PROBLEM_CODE.CANCEL_ERROR:
  case PROBLEM_CODE.PARSE_ERROR:     // 2xx whose body could not be decoded
  case PROBLEM_CODE.UNKNOWN_ERROR:
}
```

**Parse failures.** A 2xx whose body cannot be decoded as its declared media type (for example malformed JSON) is an error response: `problem: PARSE_ERROR`, `error.kind === 'parse'`, a `ParseError` cause, `response.data` holding the raw text, and `status`/`headers`/`response` intact. A malformed *error* body never masks the HTTP failure: it stays `kind: 'http'` with the raw text as `data`. Parse failures are not retried by default.

**Typed causes.** For transport-level failures `originalError` (and `error.cause`) is one of the exported classes: `TimeoutError` (with `timeout` and `scope: 'request' | 'total'`), `CancelError`, or `NetworkError` (wraps the `TypeError` thrown by `fetch`, still an `instanceof TypeError`, with `code` such as `ECONNREFUSED` when the platform provides one, which maps to `CONNECTION_ERROR`). Any non-2xx status, including 3xx under `redirect: 'manual'`, is reported as `kind: 'http'` with its status.

### RefetchError discriminated union

Use `response.error` when you need typed access to error-specific fields:

```typescript
if (!response.ok) {
  switch (response.error.kind) {
    case 'http':
      console.error(response.error.status, response.error.statusText);
      break;
    case 'timeout':
      console.error(`Timed out after ${response.error.duration}ms`);
      break;
    case 'cancel':
      console.info('Cancelled:', response.error.reason);
      break;
    case 'network':
      console.error('Network failure:', response.error.cause);
      break;
    case 'parse':
      // response.data holds the raw body text, response.status/headers are still set
      console.error('Parse error for', response.error.contentType, response.error.cause);
      break;
    case 'unknown':
      console.error(response.error.cause);
      break;
  }
}
```

## Interceptors

Return-based, ID-tracked, and removable. Request interceptors run **LIFO** (last registered, first to run); response interceptors run **FIFO**.

```typescript
// Add a request interceptor
const id = api.interceptors.request.use(
  async (config) => ({
    ...config,
    headers: {
      ...(config.headers as Record<string, string>),
      Authorization: `Bearer ${await getToken()}`,
    },
  }),
  // Optional onRejected handler
  (error) => { throw error; },
);

// Eject by ID
api.interceptors.request.eject(id);

// Response interceptor — normalize data, handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => { throw error; },
);

// Clear all interceptors
api.interceptors.request.clear();
api.interceptors.response.clear();
```

Interceptors never throw to the caller. If a request interceptor throws or rejects (a failing token fetch in `withAuth`, say), the request is not sent and the call resolves with an error response (`problem: UNKNOWN_ERROR`, `error.kind === 'unknown'`, `originalError` set) that still passes through the response interceptors and monitors. The same holds for `stream()`.

## Retry

```typescript
// Instance-wide default — 3 total attempts (1 original + 2 retries)
const api = create({ baseURL: 'https://api.example.com', retry: 3 });

// Full per-request config
const response = await api.get('/data', undefined, {
  retry: {
    attempts: 4,
    delay: (attempt) => attempt * 500,            // 500ms, 1s, 1.5s
    condition: (r) => !r.ok && r.status !== 404,  // skip retry on 404
    onRetry: (attempt, last) => console.warn('Retry', attempt, last.status),
  },
});
```

**Default condition:** retry on any non-ok response except status codes 400, 401, 403, 404, 422.

Request interceptors run **once** before the retry loop. Response interceptors run **per attempt**.

Cancelled requests and `totalTimeout` expiries are never retried, whatever `condition` returns, and a cancel during the back-off delay returns immediately with `kind: 'cancel'`.

## Timeouts

```typescript
const api = create({ baseURL: 'https://api.example.com', timeout: 10_000 });

// Per-attempt timeout: covers the wait for headers *and* reading the body
await api.get('/report', undefined, { timeout: 30_000 });

// 0 or false disables the per-attempt timeout for this request
await api.get('/export', undefined, { timeout: false });

// totalTimeout caps the whole call: every attempt, every retry back-off
await api.get('/flaky', undefined, { retry: 5, totalTimeout: 15_000 });
```

| Option | Default | Covers |
|---|---|---|
| `timeout` | 10 000 ms | one attempt: headers and body (`stream()`: headers only) |
| `totalTimeout` | disabled | the whole call including retries and back-off delays |

Both produce `problem: TIMEOUT_ERROR`, `error.kind === 'timeout'` and a `TimeoutError` whose `scope` tells them apart. Invalid values (negative, `NaN`, above 2³¹ − 1) reject with a `TypeError` / `RangeError` before any request is made. Signals are combined with `AbortSignal.any` where available (Node ≥ 20.3, browsers since early 2024) and with listeners elsewhere.

## Cancellation

```typescript
import { createCancelToken } from '@mshindi-labs/refetch';

const { token, cancel } = createCancelToken();

// Pass the AbortSignal in config
const req = api.get('/slow-resource', undefined, { signal: token });

// Cancel from outside
cancel('User navigated away');

const response = await req;
if (!response.ok && response.error.kind === 'cancel') {
  console.log('Reason:', response.error.reason);
}
```

## Streaming

`stream()` returns the raw `ReadableStream` without body parsing — useful for large downloads, SSE, or chunked responses:

```typescript
const response = await api.stream('/large-file.bin');

if (response.ok) {
  const reader = response.data.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    processChunk(value); // Uint8Array
  }
}
```

**SSE / text streams:**

```typescript
const response = await api.stream<string>('/events');
if (response.ok) {
  const text = response.data.pipeThrough(new TextDecoderStream());
  for await (const chunk of text) {
    console.log(chunk);
  }
}
```

## Middleware + pipe

`pipe` chains middleware HOFs onto an instance without mutation at the call site:

```typescript
import { create, pipe } from '@mshindi-labs/refetch';
import { withAuth, withTimeout, withLogging, withHeaders, withBaseURL } from '@mshindi-labs/refetch/middleware';

const api = pipe(
  create({ baseURL: 'https://api.example.com' }),
  withAuth(async () => await getAccessToken()),
  withTimeout(8_000),
  withLogging(),
);
```

| HOF | Effect |
|---|---|
| `withAuth(getToken)` | Injects `Authorization: Bearer <token>` per request — `getToken` called each time |
| `withTimeout(ms)` | Sets request timeout for all requests |
| `withHeaders(headers)` | Merges additional default headers |
| `withBaseURL(url)` | Overrides the base URL |
| `withLogging(logger?)` | Logs each request and response; defaults to `console` |

Sub-path import (tree-shaking):

```typescript
import { withAuth, withLogging } from '@mshindi-labs/refetch/middleware';
import { pipe }                  from '@mshindi-labs/refetch/pipe';
```

## Body Formats

All native `fetch` body types are passed through without transformation. `Content-Type` is set automatically based on body type:

| Body | Auto `Content-Type` |
|---|---|
| Plain object / array | `application/json` |
| `string` | `application/json` |
| `FormData` | *omitted* — browser sets `multipart/form-data; boundary=…` |
| `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `Blob` | Blob's own `.type`, or `application/octet-stream` |
| `ArrayBuffer` / `ArrayBufferView` | `application/octet-stream` |
| `ReadableStream` | `application/octet-stream`, sent with `duplex: 'half'` (override via `config.duplex`) |

If you explicitly set `Content-Type` in your request headers, it takes precedence (except FormData, where it is always removed to preserve the browser-managed boundary).

**Streaming request bodies** are one-shot: the stream is consumed by the first attempt, so such requests are never retried. In browsers they need HTTP/2 or HTTP/3 over HTTPS and are not supported by Safari; Node, Bun and Deno support them over HTTP/1.1 too.

**Form-encoded body:**

```typescript
await api.post('/login', new URLSearchParams({ username, password }));
```

**File upload:**

```typescript
const form = new FormData();
form.append('avatar', file);
await api.post('/profile/avatar', form);
```

## Response Parsing

`parseResponseBody` automatically picks the right parser based on `Content-Type`:

| Content-Type | Parsed to |
|---|---|
| `application/json` | `T` via `JSON.parse` |
| `application/*+json` (e.g. `vnd.api+json`, `ld+json`, `problem+json`) | `T` via `JSON.parse` |
| `application/x-www-form-urlencoded` | `Record<string, string>` via `URLSearchParams` |
| `text/*`, `application/xml`, `application/xhtml+xml` | `string` |
| `image/*`, `audio/*`, `video/*` | `Blob` |
| `application/pdf`, `application/zip`, `application/gzip`, Office formats, etc. | `Blob` |
| 204 / 304 / `content-length: 0` | `null` |
| Anything else | `string` (fallback) |

## Sub-path Exports

```typescript
import { pipe }                              from '@mshindi-labs/refetch/pipe';
import { withAuth, withLogging }             from '@mshindi-labs/refetch/middleware';
import { normalizeRetryConfig, shouldRetry } from '@mshindi-labs/refetch/retry';
```

## Dynamic Instance Configuration

```typescript
api.setHeader('X-Request-Id', crypto.randomUUID());
api.setHeaders({ 'X-API-Key': 'key', 'X-Client-Version': '3.0' });
api.deleteHeader('X-Temporary');

api.setBaseURL('https://api-v2.example.com');
api.getBaseURL();
```

## Monitors

Observe all responses after transforms — fire-and-forget (exceptions caught internally):

```typescript
api.addMonitor((response) => {
  if (!response.ok) errorTracker.capture(response.error);
});

// Remove or clear
api.removeMonitor(fn);
api.clearMonitors();
```

## TypeScript Types

```typescript
import type {
  ApiResponse,
  ApiOkResponse,
  ApiErrorResponse,
  RefetchError,
  RetryConfig,
  RefetchConfig,
  RefetchInstance,
  RequestConfig,
  InterceptorManager,
  InterceptorHandler,
  Monitor,
} from '@mshindi-labs/refetch';
```

## Deprecated: Transforms

Mutation-based transforms are still supported for backward compatibility. Prefer interceptors for new code:

```typescript
// Deprecated — still works
api.addRequestTransform((config) => {
  config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
});
api.addResponseTransform((response) => {
  if (response.ok) response.data = normalize(response.data);
});
api.removeRequestTransform(fn);
api.clearRequestTransforms();

// Preferred — return-based, removable by ID
const id = api.interceptors.request.use((config) => ({
  ...config,
  headers: { ...config.headers, Authorization: `Bearer ${token}` },
}));
api.interceptors.request.eject(id);
```

## Integration with TanStack Query

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async () => {
      const response = await api.get<User>(`/users/${id}`);
      if (!response.ok) throw new Error(response.problem ?? 'Failed');
      return response.data;
    },
  });
}

function useCreateUser() {
  return useMutation({
    mutationFn: async (dto: CreateUserDto) => {
      const response = await api.post<User, CreateUserDto>('/users', dto);
      if (!response.ok) throw new Error(response.problem ?? 'Failed');
      return response.data;
    },
  });
}
```

## Why Refetch?

| | refetch | axios | apisauce |
|---|---|---|---|
| Native `fetch` | ✅ | ❌ (XHR) | ❌ (wraps axios) |
| Pure functional TS | ✅ | ❌ (class-based) | ❌ |
| Tree-shakeable | ✅ | ❌ | ❌ (CJS only) |
| Discriminated error union | ✅ | ❌ | ❌ |
| Built-in retry | ✅ | ❌ | ❌ |
| Built-in streaming | ✅ | limited | ❌ |
| Bundle size | ~4 KB gzip (11.5 KB raw ESM) | ~60 KB | ~10 KB + axios |
| Runtime dependencies | 0 | 0 | axios |

## Migration from v2

**Interceptors replace transforms** (transforms still work, but are deprecated):

```typescript
// v2
api.addRequestTransform((config) => { config.headers = { ...config.headers, 'X-Key': 'v' }; });

// v3 — return-based, eject by ID
const id = api.interceptors.request.use((config) => ({
  ...config,
  headers: { ...config.headers, 'X-Key': 'v' },
}));
```

**Body generics on POST/PUT/PATCH:**

```typescript
// v2
const r = await api.post<User>('/users', data);

// v3 — body type explicit
const r = await api.post<User, CreateUserDto>('/users', dto);
```

**RetryConfig:**

```typescript
// v3 — per-request retry
const r = await api.get('/data', undefined, { retry: 3 });
```

**Content-Type is no longer in default headers.** It is now set automatically based on body type. Remove manual `Content-Type: application/json` from your instance headers — it will be set correctly for each body type automatically.

## License

MIT
