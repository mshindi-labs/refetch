# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@mshindi-labs/refetch` (v3.0.0) is a production-grade HTTP client built on native `fetch`. It is a pure functional TypeScript redesign — 14 single-responsibility modules, return-based interceptors, discriminated error union (`RefetchError`), built-in retry, streaming, and tree-shakeable sub-path exports. It is a modern alternative to axios and apisauce with zero runtime dependencies.

## Development Commands

```bash
npm run build       # tsup — produces dist/ (ESM + CJS + .d.ts for 4 entry points)
npx tsc --noEmit    # type check only, no output
```

No test runner is configured. Use `npx tsx <file>` for ad-hoc smoke tests.

## Architecture

### Module Layout (`src/`)

| File | Responsibility |
|------|---------------|
| `types.ts` | All public types: `PROBLEM_CODE`, `RefetchError`, `RetryConfig`, `ApiResponse`, `RefetchInstance`, interceptor types, transform types |
| `constants.ts` | `STATUS_RANGES`, `DEFAULT_TIMEOUT`, `DEFAULT_HEADERS` (Accept only — no Content-Type) |
| `errors.ts` | `CancelError`, `createCancelToken`, `classifyProblem`, `buildRefetchError` |
| `url.ts` | `buildUrl`, `buildQueryString` |
| `headers.ts` | `mergeHeaders`, `headersToObject` |
| `body.ts` | `prepareRequestBody`, `shouldHaveBody`, `getBodyContentType`, `JSON_LIKE_RE` |
| `response.ts` | `parseResponseBody`, `normalizeSuccessResponse`, `normalizeErrorResponse` |
| `fetch.ts` | `fetchWithTimeout` — AbortController + signal merging + finally cleanup |
| `interceptors.ts` | `createInterceptorManager` — Map-based, auto-increment IDs, `getAll()` |
| `retry.ts` | `normalizeRetryConfig`, `getRetryDelay`, `shouldRetry`, `sleep` |
| `middleware.ts` | `withAuth`, `withTimeout`, `withHeaders`, `withBaseURL`, `withLogging` |
| `pipe.ts` | `pipe()` HOF |
| `refetch.ts` | `create()` factory — pipeline, retry loop, stream(), transform aliases |
| `index.ts` | All public exports |

`utils.ts` does not exist — it was dissolved into the six utility modules above.

### Build Entry Points (`tsup.config.ts`)

| Entry | Sub-path |
|-------|----------|
| `src/index.ts` | `@mshindi-labs/refetch` |
| `src/retry.ts` | `@mshindi-labs/refetch/retry` |
| `src/middleware.ts` | `@mshindi-labs/refetch/middleware` |
| `src/pipe.ts` | `@mshindi-labs/refetch/pipe` |

### Request/Response Pipeline (`refetch.ts`)

1. HTTP method called (e.g., `api.get(url, params, config)`)
2. Config merged: `{ ...state.config, ...requestConfig, url, method }`
3. `shouldHaveBody` → assign `config.data` (body methods) or `config.params` (GET/HEAD/DELETE)
4. **Request interceptors applied (LIFO)** — return-based, run **once before any retry**
5. `normalizeRetryConfig` determines retry settings
6. **Retry loop** (`do/while`):
   - `prepareRequestBody(config.data)` → `BodyInit | undefined`
   - `mergeHeaders(DEFAULT_HEADERS, instance, request)` → then `getBodyContentType` sets `Content-Type`
   - FormData: `headers.delete('Content-Type')` — browser manages multipart boundary
   - `buildUrl(baseURL, url, params)`
   - `fetchWithTimeout` with AbortController
   - `parseResponseBody` — content-type-aware (see below)
   - `normalizeSuccessResponse` or `normalizeErrorResponse` + `buildRefetchError`
   - **Response interceptors applied (FIFO)** — per attempt
   - Monitors notified (fire-and-forget)
   - `shouldRetry` check — repeat if configured

### Content-Type Handling

`DEFAULT_HEADERS` contains **only** `Accept: application/json`. `Content-Type` is never in defaults — it is set per-request by `getBodyContentType(body)` in `body.ts`:

| Return value | Meaning |
|---|---|
| `null` | FormData — delete Content-Type so browser can set boundary |
| `undefined` | No body — no Content-Type needed |
| `string` | Set this value, only if caller hasn't already set Content-Type |

### Response Body Parsing (`response.ts`)

`parseResponseBody` routes by MIME type (stripped of parameters) from `Content-Type`:

- 204 / 304 / `content-length: 0` → `null` immediately (no read)
- `application/json` or `/+json` suffix (via `JSON_LIKE_RE`) → `response.json()`
- `application/x-www-form-urlencoded` → `URLSearchParams` → `Record<string, string>`
- `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/zip`, Office docs, fonts → `response.blob()`
- `text/*`, `application/xml`, `application/xhtml+xml` → `response.text()`
- Fallback → `response.text()`

### Interceptor System (`interceptors.ts`)

`createInterceptorManager<T>()` uses `Map<number, InterceptorHandler<T>>` + auto-increment ID counter:

- `use(onFulfilled?, onRejected?) → id` — registers and returns the ejection ID
- `eject(id)` — deletes from Map (no null-placeholder array like axios)
- `clear()` — clears all
- `getAll()` — returns array of handlers in insertion order

Request interceptors are **reversed** before execution (LIFO). Response interceptors execute in order (FIFO). If the response interceptor chain rejects, the error is wrapped in `normalizeErrorResponse` — it never propagates as an unhandled exception.

### Transform Aliases (Deprecated)

`addRequestTransform` / `addResponseTransform` wrap the transform as an interceptor internally. The original function → interceptor ID mapping is stored in `requestTransformIds` / `responseTransformIds` (`Map<Function, number>`) for reference-based removal via `removeRequestTransform(fn)`. Transforms mutate the config/response then return it — backward compatible with v2 mutation-based usage.

### Retry Loop

```
request interceptors → once
do {
  if (attempt > 0) await sleep(delay); onRetry?.(attempt, lastResponse)
  lastResponse = await executeSingleRequest(config, startTime)
  attempt++
} while (retryConfig && attempt < retryConfig.attempts && shouldRetry(lastResponse, retryConfig))
```

Default non-retryable status codes: `{400, 401, 403, 404, 422}`.

### Error Classification (`errors.ts`)

`classifyProblem(status?, error?)` → `PROBLEM_CODE`. `buildRefetchError` returns the matching `RefetchError` variant:

- `error.name === 'AbortError'` with `CancelError` cause → `{ kind: 'cancel' }`
- `error.name === 'AbortError'` (timeout path) → `{ kind: 'timeout', duration }`
- `error instanceof TypeError` → `{ kind: 'network' }`
- HTTP 400–599 → `{ kind: 'http', status, statusText }`
- Parse failure → `{ kind: 'parse', contentType, cause }`
- Everything else → `{ kind: 'unknown', cause }`

`CancelError` and `createCancelToken` live in `errors.ts`, not `interceptors.ts`.

### Middleware HOFs (`middleware.ts`)

Each HOF has type `(instance: RefetchInstance) => RefetchInstance`. They register interceptors and return the same instance. `pipe(value, ...fns)` reduces them left-to-right — the standard composition pattern.

## Key Invariants

- `utils.ts` does not exist
- `DEFAULT_HEADERS` has **only** `Accept` — never `Content-Type`
- `RefetchError` is defined in `types.ts`; `buildRefetchError` is in `errors.ts`
- `stream()` returns `ApiResponse<ReadableStream<T>>` — no body parsing, no retry
- Request interceptors run **once** before the retry loop; response interceptors run **per attempt**
- FormData `Content-Type` must always be deleted — browser manages the boundary
- `tsc --noEmit` must pass before any commit
