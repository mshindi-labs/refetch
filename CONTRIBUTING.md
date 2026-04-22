# Contributing to Refetch

Thank you for your interest in contributing to `@mshindi-labs/refetch`! This document covers setup, conventions, and the PR process.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm (comes with Node.js)
- Git

### Finding Issues

- Check the [Issues](../../issues) page for open issues
- `good first issue` — good entry points for new contributors
- `help wanted` — items we especially want help with
- Open an issue before working on a significant feature or breaking change

## Development Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/refetch.git
   cd refetch
   ```

2. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/mshindi-labs/refetch.git
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Build**
   ```bash
   npm run build
   # Produces dist/ — index, retry, middleware, pipe (ESM + CJS + .d.ts)
   ```

5. **Type check**
   ```bash
   npx tsc --noEmit
   ```

## Project Structure

```
refetch/
├── src/
│   ├── index.ts         # All public exports
│   ├── refetch.ts       # create() factory — pipeline, retry loop, stream(), transform aliases
│   ├── types.ts         # All types: ApiResponse, RefetchError, RetryConfig, RefetchInstance, ...
│   ├── errors.ts        # CancelError, createCancelToken, classifyProblem, buildRefetchError
│   ├── interceptors.ts  # createInterceptorManager — Map-based, auto-increment IDs
│   ├── retry.ts         # normalizeRetryConfig, getRetryDelay, shouldRetry, sleep
│   ├── middleware.ts    # withAuth, withTimeout, withHeaders, withBaseURL, withLogging
│   ├── pipe.ts          # pipe() HOF
│   ├── body.ts          # prepareRequestBody, getBodyContentType, shouldHaveBody, JSON_LIKE_RE
│   ├── response.ts      # parseResponseBody, normalizeSuccessResponse, normalizeErrorResponse
│   ├── headers.ts       # mergeHeaders, headersToObject
│   ├── url.ts           # buildUrl, buildQueryString
│   ├── fetch.ts         # fetchWithTimeout
│   └── constants.ts     # STATUS_RANGES, DEFAULT_TIMEOUT, DEFAULT_HEADERS
├── dist/                # Build output (generated — do not edit)
├── README.md
├── CLAUDE.md            # Claude Code guidance (architecture reference)
├── CONTRIBUTING.md      # This file
├── LICENSE
├── package.json
├── tsconfig.json
└── tsup.config.ts       # 4 entry points: index, retry, middleware, pipe
```

### Key Files

- **`src/refetch.ts`** — The `create()` factory. All HTTP method wrappers, the interceptor pipeline, retry loop, `stream()`, and deprecated transform aliases live here. State is closure-based (no `this`).
- **`src/types.ts`** — Single source of truth for all types. `RefetchError` discriminated union and `RetryConfig` are here. Do not define shared types elsewhere.
- **`src/errors.ts`** — Error construction. `buildRefetchError` maps a raw `Error` + HTTP status to the correct `RefetchError` variant. `CancelError` and `createCancelToken` are here, not in `interceptors.ts`.
- **`src/body.ts`** — Body preparation and `Content-Type` detection. `DEFAULT_HEADERS` intentionally has no `Content-Type` — it is set here per body type.
- **`src/response.ts`** — Response parsing. Uses `JSON_LIKE_RE` from `body.ts` for `+json` suffix detection. Handles empty bodies, binary types, form-encoded, and JSON.

## Development Workflow

### Creating a Branch

```bash
git checkout main
git pull upstream main
git checkout -b feature/your-feature   # or fix/, docs/, refactor/
```

### Making Changes

1. Edit the appropriate module — keep single responsibility per file
2. **Type check** after every significant change:
   ```bash
   npx tsc --noEmit
   ```
3. **Build** to verify the dist output:
   ```bash
   npm run build
   ```

### Keeping Your Branch Updated

```bash
git fetch upstream
git rebase upstream/main
```

## Coding Standards

### TypeScript

1. **Pure functional** — no classes with `this`. Error subclasses (`CancelError`) are the only exception.
2. **No `any`** — use `unknown` with type guards, or generics.
3. **Single responsibility** — each module owns exactly one concern. Do not add utilities to `refetch.ts` or `types.ts` that belong in a lower-level module.
4. **Return-based over mutation** — interceptors must return the modified value. Mutation is only permitted in the deprecated transform aliases (for backward compat).
5. **No circular imports** — `types.ts` has no imports from other `src/` files. `errors.ts` imports only from `types.ts`.

### Code Style

- 2-space indentation, single quotes, trailing commas
- Lines under 100 characters
- `camelCase` for functions/variables, `PascalCase` for types/interfaces, `UPPER_CASE` for constants
- No comments unless the *why* is non-obvious (not the what)
- No multi-line docblocks on internal functions

### Architecture Constraints

- `DEFAULT_HEADERS` must never include `Content-Type` — it is set per-request by `getBodyContentType`
- FormData requests must always have `Content-Type` deleted after header merge — the browser sets the boundary
- Request interceptors run **once** before the retry loop; do not move them inside `executeSingleRequest`
- `stream()` must not parse the response body and must not retry

## Testing Guidelines

No automated test suite is configured yet. Until one is added:

1. **Type check passes** — `npx tsc --noEmit` with zero errors
2. **Build passes** — `npm run build` produces all 8 files (4 ESM + 4 CJS) plus type declarations

### Ad-hoc Smoke Testing

```typescript
// test-local.ts (not committed)
import { create, PROBLEM_CODE, createCancelToken } from './src/index.ts';
import { pipe } from './src/pipe.ts';
import { withAuth, withLogging } from './src/middleware.ts';

const api = pipe(
  create({ baseURL: 'https://jsonplaceholder.typicode.com', timeout: 5000 }),
  withLogging(),
);

const response = await api.get('/posts/1');
console.log(response.ok, response.data);
```

```bash
npx tsx test-local.ts
```

### Manual Checklist

- Basic HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD
- Interceptor add / eject / clear
- Retry with a mock server (3 failures then success)
- Cancellation via `createCancelToken`
- `stream()` on a binary or text endpoint
- `pipe()` with `withAuth` + `withLogging`
- FormData upload (confirm no `Content-Type` is sent)
- TypeScript generics infer correctly: `post<User, CreateDto>`
- Both `response.problem` and `response.error.kind` are correct on error paths

### Adding a Test Suite

We welcome contributions to add automated testing:

- Vitest is the preferred runner (ESM-native, fast)
- Unit test each utility module (`url.ts`, `body.ts`, `response.ts`, `retry.ts`) independently
- Integration tests for the `create()` pipeline using `vi.spyOn(globalThis, 'fetch')`
- Include error paths: network failure, timeout, cancel, parse error
- Test both `PROBLEM_CODE` and `RefetchError.kind` for each error scenario

## Submitting Changes

### Commit Messages

```
<type>: <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`

Example:
```
feat: add exponential backoff to retry delay

Support a function form for `RetryConfig.delay` so callers can implement
exponential backoff or jitter. Fixed delay (number) is unchanged.

Closes #42
```

### Pull Request Process

1. Push your branch and open a PR against `main`
2. PR title: same format as commit messages
3. PR description should include:
   - What changed and why
   - How you tested it
   - Any breaking changes (requires major version bump)
   - Related issue(s)
4. Ensure `npx tsc --noEmit` and `npm run build` both pass
5. Address review feedback and iterate

## Release Process

Releases follow [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking API changes
- **MINOR** — new backward-compatible features
- **PATCH** — bug fixes

Release steps (maintainers):

```bash
npm version patch   # or minor / major — updates package.json and creates a git tag
npm run build       # verify dist/
npm publish --access public
# Create a GitHub release with changelog notes
```

## Questions?

Open an issue or start a GitHub discussion. All contributions — code, documentation, bug reports — are appreciated.

## License

By contributing, you agree your changes will be licensed under the MIT License.
