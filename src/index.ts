/**
 * Refetch - A native fetch API wrapper inspired by apisauce
 *
 * @example
 * ```typescript
 * import { create } from '@/lib/refetch';
 *
 * const api = create({
 *   baseURL: 'https://api.example.com',
 *   headers: {
 *     'Content-Type': 'application/json',
 *   },
 *   timeout: 10000,
 * });
 *
 * // Add request transforms
 * api.addRequestTransform((request) => {
 *   request.headers = {
 *     ...request.headers,
 *     Authorization: `Bearer ${token}`,
 *   };
 * });
 *
 * // Add response transforms
 * api.addResponseTransform((response) => {
 *   if (response.data) {
 *     response.data = transformData(response.data);
 *   }
 * });
 *
 * // Add monitors
 * api.addMonitor((response) => {
 *   console.log('API Response:', response);
 * });
 *
 * // Make requests
 * const response = await api.get<User>('/users/1');
 * if (response.ok) {
 *   console.log('User:', response.data);
 * } else {
 *   console.error('Error:', response.problem);
 * }
 * ```
 */

// Main factory function
export { create } from './refetch';

// Type exports
export type {
  ApiResponse,
  ApiOkResponse,
  ApiErrorResponse,
  RefetchConfig,
  RefetchInstance,
  RequestConfig,
  RequestTransform,
  AsyncRequestTransform,
  ResponseTransform,
  AsyncResponseTransform,
  Monitor,
} from './types';

// Enum exports
export { PROBLEM_CODE } from './types';

// Type guard exports
export { isOkResponse, isErrorResponse } from './types';

// Constant exports
export { STATUS_RANGES, DEFAULT_TIMEOUT } from './constants';
