# Refetch

A lightweight, apisauce-inspired HTTP client built on native `fetch` API with TypeScript support.

## Features

- Built on native `fetch` API (no axios dependency)
- Standardized response format with error classification
- Request/Response transforms (sync & async)
- Response monitors for logging/analytics
- Timeout support using AbortController
- Full TypeScript support with generics
- Similar API to apisauce for easy migration

## Installation

Install via npm:

```bash
npm install @mshindi-labs/refetch
```

Or with yarn:

```bash
yarn add @mshindi-labs/refetch
```

Or with pnpm:

```bash
pnpm add @mshindi-labs/refetch
```

## Quick Start

### Basic Usage

```typescript
import { create, PROBLEM_CODE } from '@mshindi-labs/refetch';

// Create an API instance
const api = create({
  baseURL: 'https://api.example.com',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds
});

// Make a GET request
const response = await api.get<User>('/users/1');

if (response.ok) {
  console.log('User:', response.data);
} else {
  console.error('Error:', response.problem);
  // response.problem will be one of:
  // - PROBLEM_CODE.CLIENT_ERROR (400-499)
  // - PROBLEM_CODE.SERVER_ERROR (500-599)
  // - PROBLEM_CODE.TIMEOUT_ERROR
  // - PROBLEM_CODE.NETWORK_ERROR
  // - PROBLEM_CODE.CONNECTION_ERROR
  // - PROBLEM_CODE.CANCEL_ERROR
  // - PROBLEM_CODE.UNKNOWN_ERROR
}
```

### POST Request

```typescript
interface CreateUserData {
  name: string;
  email: string;
}

const response = await api.post<User>('/users', {
  name: 'John Doe',
  email: 'john@example.com',
});

if (response.ok) {
  console.log('Created user:', response.data);
} else {
  console.error('Failed to create user:', response.problem);
}
```

### All HTTP Methods

```typescript
// GET with query params
const users = await api.get('/users', { page: 1, limit: 10 });

// POST with data
const created = await api.post('/users', userData);

// PUT with data
const updated = await api.put('/users/1', userData);

// PATCH with partial data
const patched = await api.patch('/users/1', { name: 'New Name' });

// DELETE with params
const deleted = await api.delete('/users/1');

// HEAD request
const head = await api.head('/users/1');

// LINK request (for linking resources)
const linked = await api.link('/images/avatar.jpg', {}, {
  headers: { Link: '<http://example.com/profiles/user>; rel="tag"' }
});

// UNLINK request
const unlinked = await api.unlink('/images/avatar.jpg', {}, {
  headers: { Link: '<http://example.com/profiles/user>; rel="tag"' }
});

// Generic method for any HTTP verb (including custom methods)
const response = await api.any({
  method: 'PROPFIND',
  url: '/webdav/folder',
  headers: { Depth: '1' }
});
```

## Advanced Features

### Request Transforms

Add authorization headers or modify requests before sending:

```typescript
// Synchronous transform
api.addRequestTransform((request) => {
  const token = localStorage.getItem('token');
  if (token) {
    request.headers = {
      ...request.headers,
      Authorization: `Bearer ${token}`,
    };
  }
});

// Async transform
api.addRequestTransform(async (request) => {
  const token = await getAuthToken();
  request.headers = {
    ...request.headers,
    Authorization: `Bearer ${token}`,
  };
});
```

### Response Transforms

Modify responses after receiving:

```typescript
api.addResponseTransform((response) => {
  // Transform data format
  if (response.ok && response.data) {
    response.data = transformData(response.data);
  }
});

// Async response transform
api.addResponseTransform(async (response) => {
  if (response.data) {
    response.data = await processData(response.data);
  }
});
```

### Monitors

Observe all API responses for logging, analytics, or debugging:

```typescript
// Simple logging monitor
api.addMonitor((response) => {
  console.log('API Response:', {
    url: response.response?.url,
    status: response.status,
    duration: response.duration,
    problem: response.problem,
  });
});

// Error tracking monitor
api.addMonitor((response) => {
  if (!response.ok) {
    trackError({
      type: response.problem,
      error: response.originalError,
      status: response.status,
    });
  }
});

// Performance monitoring
api.addMonitor((response) => {
  if (response.duration && response.duration > 3000) {
    console.warn('Slow API call:', response.response?.url, response.duration);
  }
});
```

### Dynamic Headers and Base URL

```typescript
// Set a single header
api.setHeader('X-Custom-Header', 'value');

// Set multiple headers
api.setHeaders({
  'X-API-Key': 'your-api-key',
  'X-Client-Version': '1.0.0',
});

// Delete a header
api.deleteHeader('X-Custom-Header');

// Update base URL
api.setBaseURL('https://api-v2.example.com');

// Get current base URL
const currentBaseURL = api.getBaseURL();
console.log('Current API base:', currentBaseURL);
```

### Per-Request Configuration

Override instance configuration for specific requests:

```typescript
const response = await api.get<User>('/users/1', undefined, {
  timeout: 5000, // Override timeout for this request
  headers: {
    'X-Request-Id': crypto.randomUUID(),
  },
});
```

## Response Format

All responses follow a consistent format:

```typescript
interface ApiResponse<T> {
  ok: boolean; // true if 200-299
  problem: PROBLEM_CODE | null; // Error classification
  originalError: Error | null; // Original error if any
  data?: T; // Response data
  status?: number; // HTTP status code
  headers?: Record<string, string>; // Response headers
  duration?: number; // Request duration in ms
  response?: Response; // Original fetch Response
}
```

## Error Handling

### Problem Codes

```typescript
export enum PROBLEM_CODE {
  NONE = 'NONE', // 200-299
  CLIENT_ERROR = 'CLIENT_ERROR', // 400-499
  SERVER_ERROR = 'SERVER_ERROR', // 500-599
  TIMEOUT_ERROR = 'TIMEOUT_ERROR', // Request timeout
  CONNECTION_ERROR = 'CONNECTION_ERROR', // Cannot connect
  NETWORK_ERROR = 'NETWORK_ERROR', // Network unavailable
  CANCEL_ERROR = 'CANCEL_ERROR', // Request cancelled
  UNKNOWN_ERROR = 'UNKNOWN_ERROR', // Unknown error
}
```

### Error Handling Patterns

```typescript
// Simple check
if (!response.ok) {
  console.error('Request failed:', response.problem);
}

// Specific error handling
switch (response.problem) {
  case PROBLEM_CODE.CLIENT_ERROR:
    console.error('Client error (400-499):', response.status);
    break;
  case PROBLEM_CODE.SERVER_ERROR:
    console.error('Server error (500-599):', response.status);
    break;
  case PROBLEM_CODE.TIMEOUT_ERROR:
    console.error('Request timed out');
    break;
  case PROBLEM_CODE.NETWORK_ERROR:
    console.error('Network unavailable');
    break;
  default:
    console.error('Unknown error');
}

// Type guards
if (response.ok) {
  // TypeScript knows response.data is defined here
  console.log(response.data.id);
}
```

## Integration with TanStack Query

Perfect integration with TanStack Query:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api'; // Your refetch instance

// Query
function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: async () => {
      const response = await api.get<User>(`/users/${id}`);
      if (!response.ok) {
        throw new Error(response.problem || 'Failed to fetch user');
      }
      return response.data;
    },
  });
}

// Mutation
function useCreateUser() {
  return useMutation({
    mutationFn: async (data: CreateUserData) => {
      const response = await api.post<User>('/users', data);
      if (!response.ok) {
        throw new Error(response.problem || 'Failed to create user');
      }
      return response.data;
    },
  });
}
```

## Why Refetch?

- **Tiny Bundle Size**: Only ~2.3 KB gzipped (no axios dependency)
- **Modern Standards**: Built on native `fetch` API with AbortController
- **Zero Runtime Dependencies**: No external dependencies in production
- **Full TypeScript Support**: Complete type safety with generics
- **Flexible Transforms**: Add/remove/clear request and response transforms
- **Error Classification**: Automatic categorization of errors (network, timeout, server, etc.)
- **Node.js 18+ Ready**: Works in modern Node.js environments
- **Browser Compatible**: Works in all modern browsers with native fetch support

## TypeScript Types

```typescript
import type {
  ApiResponse,
  ApiOkResponse,
  ApiErrorResponse,
  RefetchInstance,
  RefetchConfig,
  RequestConfig,
  RequestTransform,
  AsyncRequestTransform,
  ResponseTransform,
  AsyncResponseTransform,
  Monitor,
} from '@mshindi-labs/refetch';
```

## Best Practices

1. **Create a single instance** per API and reuse it:

```typescript
// lib/api.ts
import { create } from '@mshindi-labs/refetch';

export const api = create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
});
```

2. **Use transforms for common logic**:

```typescript
// Add auth token to all requests
api.addRequestTransform((request) => {
  const token = getToken();
  if (token) {
    request.headers = { ...request.headers, Authorization: `Bearer ${token}` };
  }
});
```

3. **Handle errors consistently**:

```typescript
api.addMonitor((response) => {
  if (!response.ok && response.problem === PROBLEM_CODE.CLIENT_ERROR) {
    if (response.status === 401) {
      // Handle unauthorized
      redirectToLogin();
    }
  }
});
```

4. **Type your responses**:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

const response = await api.get<User>('/users/1');
// response.data is typed as User when ok is true
```

## What's New in v2.0.3

### Latest Updates

**New HTTP Methods:**
```typescript
// LINK and UNLINK methods for resource linking
await api.link('/resources/image.jpg', {}, { headers: { Link: '...' }});
await api.unlink('/resources/image.jpg', {}, { headers: { Link: '...' }});

// Generic any() method for custom HTTP verbs
await api.any({ method: 'PROPFIND', url: '/webdav', headers: { Depth: '1' }});
```

**Base URL Getter:**
```typescript
// Get current base URL
const baseURL = api.getBaseURL();
```

**Optimizations:**
- Reduced bundle size to ~2.3 KB gzipped (40% smaller)
- Simplified header management with normalized Headers class
- Removed code duplication and unused constants
- Better tree-shaking support

**Bug Fixes:**
- Fixed DEFAULT_HEADERS being applied to FormData and URLSearchParams (file uploads now work correctly)
- Consistent error response handling across all error paths
- Improved error classification

## What's New in v2.0.0

### Breaking Changes

**Type Safety Improvements:**
- All `any` types replaced with `unknown` for better type safety
- You must now explicitly type your responses or provide type assertions

**Config Protection:**
- `api.config` is now readonly and returns a copy
- Use setter methods like `setBaseURL()` instead of direct mutation

### Features from v2.0.0

**Transform & Monitor Management:**
```typescript
// Remove specific transforms/monitors
const transform = (config) => { /* ... */ };
api.addRequestTransform(transform);
api.removeRequestTransform(transform);

// Clear all transforms/monitors
api.clearRequestTransforms();
api.clearResponseTransforms();
api.clearMonitors();
```

**Type Guards:**
```typescript
import { isOkResponse, isErrorResponse } from '@mshindi-labs/refetch';

const response = await api.get<User>('/users/1');

if (isOkResponse(response)) {
  // TypeScript knows response.data is User
  console.log(response.data.name);
}

if (isErrorResponse(response)) {
  // TypeScript knows this is an error
  console.log(response.problem);
}
```

**Better Error Messages:**
- Errors now include HTTP method and full URL
- Example: `HTTP GET https://api.example.com/users failed with status 404: Not Found`

**Improved URL Handling:**
- Properly handles absolute URLs
- Normalizes trailing/leading slashes
- Better baseURL concatenation

### Migration from v1.x

```typescript
// v1.x - implicit any types
const response = await api.get('/users');

// v2.x - explicit typing required
const response = await api.get<User[]>('/users');

// v1.x - direct config mutation
api.config.timeout = 5000;

// v2.x - use setter methods
// (config is now readonly)
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](https://github.com/mshindi-labs/refetch/blob/main/CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

MIT License - see [LICENSE](https://github.com/mshindi-labs/refetch/blob/main/LICENSE) file for details.
