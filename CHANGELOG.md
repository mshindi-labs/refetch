# Changelog

All notable changes to `@mshindi-labs/refetch` are documented here.

## [Unreleased]

### Added

- `TimeoutError` (`timeout`, `scope: 'request' | 'total'`) and `NetworkError` (extends `TypeError`, exposes `code`) exported from the root entry (#2, #10)
- `totalTimeout` option (instance and per request) capping the whole call including retries and back-off (#4)
- `timeout: false` to disable the per-attempt timeout; invalid timeout values reject up front with `TypeError` / `RangeError` (#4)
- `sleep(ms, signal)` accepts an `AbortSignal` and rejects with its reason (#3)
- Vitest test suite: unit tests per module, integration tests against a real `node:http` server, and type-level tests. Known bugs #2–#10 are tracked as `it.fails` regression tests that flip to `it` when fixed (#15)
- CI workflow: Biome lint, typecheck, build, tests on Node 22/24/26 (plus Windows), Bun and Deno smoke runs, arethetypeswrong + publint, size-limit budgets. Publishing now runs the full verification before `npm publish` (#16)

### Fixed

- The built-in timeout is now reported as `TIMEOUT_ERROR` / `kind: 'timeout'` with a `TimeoutError` cause instead of `UNKNOWN_ERROR` (#2)
- Cancellation is honoured: an already-aborted `signal` rejects before any network call, cancelled attempts are never retried, and a cancel during retry back-off returns immediately (#3)
- The per-attempt timeout now covers reading the body, not only the wait for headers; aborting the caller's signal after headers cancels the body stream, including for `stream()` (#4)
- Error classification works by origin: Safari's `TypeError: Load failed` is a network error, refused/unreachable connections map to `CONNECTION_ERROR` via the platform error code, and any non-2xx status (3xx under `redirect: 'manual'`, opaque 0) is `kind: 'http'` with its status (#10)
- CommonJS consumers under `moduleResolution: node16` now resolve the `.d.cts` declarations: `exports` carries separate `types` for the `import` and `require` conditions, and `typesVersions` maps the `/retry`, `/middleware` and `/pipe` sub-paths for legacy `moduleResolution: node` consumers. `arethetypeswrong` and `publint --strict` are both clean (#14)

### Changed

- `timeout: 0` now disables the per-attempt timeout instead of silently falling back to the instance default (#4)
- Transport failures thrown by `fetch()` are wrapped in `NetworkError`; it still satisfies `instanceof TypeError` and keeps the original message, with the original error as `cause` (#10)
- Root bundle budget raised from 5 KB to 5.5 KB gzip (now 5.1 KB) to pay for typed errors, signal combination and the total deadline; `/retry` stays under 0.5 KB
- `sideEffects: false` so bundlers can tree-shake unused modules; `repository`, `homepage`, `bugs` and `publishConfig` (public access, provenance) added to `package.json` (#14)
- `engines.node` raised from `>=18.0.0` to `>=20.19.0`: Node 18 reached end of life on 2025-04-30 and 20.19 is the first line with stable `require(esm)`. CI runs the test suite on Node 22, 24 and 26 and the runtime smoke script on Node 20. Node 22 becomes the minimum in v4.0.0 (#14)

---

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
