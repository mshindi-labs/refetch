# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Refetch is a lightweight, apisauce-inspired HTTP client built on the native `fetch` API with full TypeScript support. It provides standardized response formats, request/response transforms, and error classification without the axios dependency.

## Development Commands

Since this is a library package without build scripts configured, there are currently no build, test, or lint commands defined in package.json. The library is meant to be consumed directly as TypeScript source files.

## Architecture

### Core Components

**refetch.ts:77** - Main factory function `create()` that returns a `RefetchInstance`. This is the heart of the library where:
- Request/response transform pipelines are managed
- HTTP method wrappers (get, post, put, patch, delete, head) are defined
- Configuration state is maintained in closures
- Transform execution happens sequentially in the order they were added

**types.ts** - Complete type definitions including:
- `ApiResponse<T>` - Standardized response format with `ok`, `problem`, `data`, `status`, `headers`, `duration`
- `PROBLEM_CODE` enum - Error classification system (CLIENT_ERROR, SERVER_ERROR, TIMEOUT_ERROR, etc.)
- `RefetchInstance` - Public API interface
- Transform function types - Both sync and async variants for request/response transforms

**utils.ts** - Utility functions that handle the low-level mechanics:
- `fetchWithTimeout()` - Wraps native fetch with AbortController for timeout support
- `classifyProblem()` - Maps HTTP status codes and error types to PROBLEM_CODE enum
- `parseResponseBody()` - Content-type aware response parsing (JSON, text, blob)
- `buildUrl()` - URL construction with query parameter serialization
- `mergeHeaders()` - Combines headers from multiple sources (defaults, config, request-level)

**constants.ts** - Shared constants including status code ranges, default timeout (10s), and error messages

**index.ts** - Public API surface with exports

### Request/Response Flow

1. **Request Phase** (refetch.ts:77-185):
   - HTTP method called (e.g., `api.get()`)
   - Request config merged: instance config → request config
   - Request transforms applied sequentially (`applyRequestTransforms`)
   - URL built with baseURL and query params
   - Headers merged from defaults, instance, and request-level
   - Body prepared based on content type
   - Fetch executed with timeout via `fetchWithTimeout`

2. **Response Phase**:
   - Response body parsed based on Content-Type header
   - Response normalized to standard `ApiResponse<T>` format
   - Success (200-299): `ok: true`, `problem: null`, data populated
   - HTTP errors (400-599): `ok: false`, problem classified, error details included
   - Response transforms applied sequentially (`applyResponseTransforms`)
   - Monitors notified (fire-and-forget, errors caught and logged)

3. **Error Handling**:
   - Network errors, timeouts, and aborts caught in try-catch
   - Errors classified via `classifyProblem()` to appropriate PROBLEM_CODE
   - Error response normalized and passed through transform/monitor pipeline
   - Original error always preserved in `originalError` field

### Transform System

Transforms modify requests before sending or responses after receiving. They run **sequentially** in the order added:

- **Request Transforms** (refetch.ts:41-47): Mutate `RequestConfig` object. Common use: adding auth headers, logging
- **Response Transforms** (refetch.ts:52-58): Mutate `ApiResponse<T>` object. Common use: data transformation, error enrichment
- Both support sync and async variants
- Applied even on error responses to ensure consistent processing

### Monitor System

Monitors observe all responses (refetch.ts:63-72) without modifying them:
- Called after all transforms complete
- Fire-and-forget: errors caught and logged to prevent breaking request flow
- Common uses: logging, analytics, error tracking, performance monitoring
- Receive complete `ApiResponse<T>` including timing data

### Key Design Patterns

1. **Closure-based state management**: Instance config and transforms stored in closures, not properties
2. **Sequential transform execution**: Transforms execute in registration order, allowing layered modifications
3. **Standardized response format**: All requests return `ApiResponse<T>` regardless of success/failure
4. **Error classification**: HTTP status codes and JS errors mapped to semantic PROBLEM_CODE enum
5. **Mutation-based transforms**: Transforms mutate config/response objects directly for performance

## Important Implementation Details

- **Timeout mechanism** uses AbortController (utils.ts:134-164) with 10s default
- **Query parameters**: Arrays serialize with repeated keys; null/undefined values filtered out
- **Body methods**: POST, PUT, PATCH have bodies; GET, HEAD, DELETE use query params only (utils.ts:272-275)
- **Content-Type handling**: Automatic JSON stringify for objects; FormData/URLSearchParams passed through
- **Header management**: Headers class used internally; supports record/array/Headers formats
- **Per-request overrides**: Any config option can be overridden at request time

## TypeScript Usage

The library is fully typed with generics:

```typescript
interface User { id: string; name: string; }
const response = await api.get<User>('/users/1');
// response.data is typed as User when response.ok is true
```

Type guards work naturally: when `response.ok === true`, TypeScript narrows to `ApiOkResponse<T>` where `data` is guaranteed defined.
