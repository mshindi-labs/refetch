# Changelog

All notable changes to `@mshindi-labs/refetch` are documented here.

## [3.0.0] — 2026-04-22

Full architectural redesign. Pure functional TypeScript, 14 single-responsibility modules, zero runtime dependencies.

### Breaking Changes

- `Content-Type` removed from `DEFAULT_HEADERS` — set per-request via `getBodyContentType()` instead
- `post`/`put`/`patch` body type is now the **second** generic parameter: `post<TResponse, TBody>`
- `addRequestTransform` / `addResponseTransform` deprecated in favour of the interceptor API
- `utils.ts` dissolved — its exports moved into six focused modules (`url.ts`, `headers.ts`, `body.ts`, `response.ts`, `fetch.ts`, `errors.ts`)

### Added

- **Interceptor system** — axios-style request/response middleware with Map-based storage, auto-increment IDs, and `eject(id)` / `clear()`. Request interceptors run LIFO; response interceptors run FIFO per retry attempt.
- **`RefetchError` discriminated union** — per-kind fields (`http`, `timeout`, `cancel`, `network`, `parse`, `unknown`) alongside `PROBLEM_CODE`
- **Retry** — `RetryConfig` per-request or instance-wide; shorthand number form; request interceptors run once before the retry loop
- **`stream()`** — returns `ApiResponse<ReadableStream<T>>` with no body parsing and no retry
- **`pipe()` + middleware HOFs** — `withAuth`, `withTimeout`, `withHeaders`, `withBaseURL`, `withLogging` compose onto instances without mutation
- **Sub-path exports** — `@mshindi-labs/refetch/retry`, `/middleware`, `/pipe` (tree-shakeable)
- **Richer response body parsing** — `+json` suffix MIME variants, `application/x-www-form-urlencoded` → `Record<string,string>`, binary MIME types → `Blob`, empty-body guard for 204/304/`content-length: 0`
- `CancelError` and `createCancelToken` for explicit request cancellation

### Changed

- `buildRefetchError` moved to `errors.ts`; `RefetchError` type defined in `types.ts`
- FormData `Content-Type` is always deleted so the browser can set the multipart boundary
- README, CLAUDE.md, and CONTRIBUTING.md fully rewritten for v3

---

## [2.0.10] — 2025-11-02

Patch release — internal version bump, no API changes.

---

## [2.0.9] — 2025-11-02

Patch release — internal version bump, no API changes.

---

## [2.0.8] — 2025-11-02

### Added

- GitHub Actions publishing workflow

---

## [2.0.7] — 2025-11-01

### Fixed

- Config spread overriding merged headers — moved `...config` spread to the start of `fetchConfig` so explicitly merged headers always take precedence. Fixes JSON `POST` requests losing `Content-Type: application/json`.

---

## [2.0.6] — 2025-11-01

### Added

- Exported `headersToObject`, `classifyProblem`, and `buildQueryString` utility functions

---

## [2.0.5] — 2025-11-01

### Added

- Exported internal utilities: `buildUrl`, `mergeHeaders`, `fetchWithTimeout`, `parseResponseBody`, `normalizeSuccessResponse`, `normalizeErrorResponse`, `prepareRequestBody`, `shouldHaveBody`

---

## [2.0.4] — 2025-11-01

Patch release — internal version bump, no API changes.

---

## [2.0.3] — 2025-10-30

### Breaking Changes

- Removed `PROBLEM_CODES` constant — use the `PROBLEM_CODE` enum directly

### Fixed

- `DEFAULT_HEADERS` no longer applied to `FormData` and `URLSearchParams` — fixes multipart/form-data being overridden
- Inconsistent error response handling — all error paths now use `normalizeErrorResponse()` uniformly

### Added

- `LINK` and `UNLINK` HTTP methods
- `any(method, url, data?, config?)` for custom HTTP verbs (e.g. `PROPFIND`, `MKCOL`)
- `getBaseURL()` for base URL introspection

### Changed

- Extracted duplicate query parameter logic into `buildQueryString()` helper (~30 lines removed)
- Simplified header management by normalising to the `Headers` class — `setHeader` and `deleteHeader` each reduced from ~12–19 lines to 3
- Removed unused `ERROR_MESSAGES` constants
- Enabled minification in tsup — bundle size ~2.3 KB gzipped (40% smaller than v2.0.2)

---

## [2.0.2] — 2025-10-30

### Fixed

- README import paths corrected to match published package structure

---

## [2.0.0] — 2025-10-30

### Breaking Changes

- All `any` types replaced with `unknown` — consumers must provide explicit type parameters or assertions
- `api.config` is now readonly — use instance methods (`setBaseURL`, etc.) instead of direct mutation

### Fixed

- Memory leak in `fetchWithTimeout` — `AbortController` event listeners now cleaned up in `finally` block

### Added

- `removeRequestTransform(fn)` / `removeResponseTransform(fn)` / `removeMonitor(fn)`
- `clearRequestTransforms()` / `clearResponseTransforms()` / `clearMonitors()`
- `isOkResponse<T>()` and `isErrorResponse<T>()` type guard exports
- Input validation: transforms and monitors must be functions; URLs validated in `buildUrl`
- Absolute URL support (bypasses `baseURL` prepending)
- Improved error messages include HTTP method and full URL for easier debugging
- `CONTRIBUTING.md`

### Changed

- `RefetchConfig` now extends `Omit<RequestInit, 'method' | 'body'>` instead of `[key: string]: any`
- URL builder normalises trailing/leading slashes and prevents double slashes

---

## [1.0.0] — 2025-10-30

Initial release. Lightweight, apisauce-inspired HTTP client built on the native `fetch` API.

### Features

- Native `fetch` wrapper with standardised `ApiResponse<T>` format
- Request/response transforms (sync and async)
- Response monitors for logging and analytics
- Timeout support via `AbortController`
- `PROBLEM_CODE` enum for error classification
- Full TypeScript support with generics
- Dual package output (ESM + CommonJS)
