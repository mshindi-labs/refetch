# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@mshindi-labs/refetch` (v3.0.0) is a production-grade HTTP client built on native `fetch`. It is a pure functional TypeScript redesign — 14 single-responsibility modules, return-based interceptors, discriminated error union (`RefetchError`), built-in retry, streaming, and tree-shakeable sub-path exports. It is a modern alternative to axios and apisauce with zero runtime dependencies.

## Development Commands

```bash
npm run build         # tsup — produces dist/ (ESM + CJS + .d.ts for 4 entry points)
npm run typecheck     # tsc --noEmit for src/ and for the test suite
npm test              # Vitest: unit + integration (real node:http server) + type tests
npm run test:coverage # same, with V8 coverage thresholds (80 % lines)
npm run lint          # Biome formatting + lint (npm run lint:fix applies)
npm run check:package # arethetypeswrong + publint on the packed tarball
npm run size          # size-limit budgets for dist/*.js
npm run smoke         # scripts/smoke.mjs against dist/ (CI also runs it under Bun and Deno)
npm run ci            # all of the above in CI order
```

Tests live in `test/` (layout and conventions in CONTRIBUTING.md "Testing Guidelines"). Known bugs are tracked as `it.fails('… (known bug #N)')` tests that assert the correct behaviour: flip them to `it` when fixing the bug.

## Architecture

### Module Layout (`src/`)

| File | Responsibility |
|------|---------------|
| `types.ts` | All public types: `PROBLEM_CODE`, `RefetchError`, `RetryConfig`, `ApiResponse`, `RefetchInstance`, interceptor types, transform types |
| `constants.ts` | `STATUS_RANGES`, `DEFAULT_TIMEOUT`, `DEFAULT_HEADERS` (Accept only — no Content-Type) |
| `errors.ts` | `CancelError`, `TimeoutError`, `NetworkError`, `createCancelToken`, `classifyProblem`, `buildRefetchError` |
| `url.ts` | `buildUrl`, `buildQueryString` |
| `headers.ts` | `mergeHeaders`, `headersToObject` |
| `body.ts` | `prepareRequestBody`, `shouldHaveBody`, `getBodyContentType`, `JSON_LIKE_RE` |
| `response.ts` | `parseResponseBody`, `normalizeSuccessResponse`, `normalizeErrorResponse` |
| `fetch.ts` | `resolveTimeout`, `createAttemptSignal` (caller signal + extra signals + timeout via `AbortSignal.any`, listener fallback), `fetchWithTimeout` |
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
   - `fetch` with the attempt signal (caller signal + `totalTimeout` deadline + per-attempt timeout); the same signal bounds the body read, so timeouts and cancels during parsing surface as such
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
  if (attempt > 0) await sleep(delay, callSignal); onRetry?.(attempt, lastResponse)   // abortable: cancel/total timeout ends the call
  lastResponse = await executeSingleRequest(config, startTime)
  attempt++
} while (retryConfig && attempt < retryConfig.attempts && shouldRetry(lastResponse, retryConfig))
```

Default non-retryable status codes: `{400, 401, 403, 404, 422}`.

### Error Classification (`errors.ts`)

`classifyProblem(status?, error?)` → `PROBLEM_CODE`. `buildRefetchError` returns the matching `RefetchError` variant:

- `TimeoutError` (ours; `scope: 'request' | 'total'`), `AbortSignal.timeout()`'s DOMException, or any `*TimeoutError` name → `{ kind: 'timeout', duration }` / `TIMEOUT_ERROR`
- `CancelError` / `AbortError` → `{ kind: 'cancel', reason }` / `CANCEL_ERROR`
- `NetworkError` (wraps the `TypeError` thrown by `fetch()`; extends `TypeError`; `code` read from the cause chain) → `{ kind: 'network' }`; `CONNECTION_ERROR` when `code` is a connection code (`ECONNREFUSED`, `ENOTFOUND`, …), else `NETWORK_ERROR`
- Any non-2xx status (4xx, 5xx, and 1xx/3xx/0 under `redirect: 'manual'`) → `{ kind: 'http', status, statusText }`
- `ParseError`-named errors → `{ kind: 'parse', contentType, cause }` (see #5)
- Everything else → `{ kind: 'unknown', cause }`

Classification is by origin first (abort reason, `fetch()` throwing) and by message only as a fallback for foreign errors.

`CancelError` and `createCancelToken` live in `errors.ts`, not `interceptors.ts`.

### Middleware HOFs (`middleware.ts`)

Each HOF has type `(instance: RefetchInstance) => RefetchInstance`. They register interceptors and return the same instance. `pipe(value, ...fns)` reduces them left-to-right — the standard composition pattern.

## Key Invariants

- `utils.ts` does not exist
- `DEFAULT_HEADERS` has **only** `Accept` — never `Content-Type`
- `RefetchError` is defined in `types.ts`; `buildRefetchError` is in `errors.ts`
- `stream()` returns `ApiResponse<ReadableStream<T>>` — no body parsing, no retry
- Request interceptors run **once** before the retry loop; response interceptors run **per attempt**
- Cancelled requests and `totalTimeout` expiries are never retried; `timeout: 0` / `false` disables the per-attempt timeout
- `src/retry.ts` has no runtime imports (keeps the `/retry` sub-path tiny)
- FormData `Content-Type` must always be deleted — browser manages the boundary
- `npm run lint`, `npm run typecheck` and `npm test` must pass before any commit
