import { describe, expectTypeOf, it } from 'vitest';
import {
  type ApiErrorResponse,
  type ApiOkResponse,
  type ApiResponse,
  create,
  isErrorResponse,
  isOkResponse,
  type RefetchError,
  type RefetchInstance,
} from '../../src/index';

interface User {
  id: number;
}

interface CreateUserDto {
  name: string;
}

describe('public API types', () => {
  const api: RefetchInstance = create();

  it('types GET, DELETE and HEAD responses by their single generic', () => {
    expectTypeOf(api.get<User>('/users/1')).resolves.toEqualTypeOf<ApiResponse<User>>();
    expectTypeOf(api.delete<User>('/users/1')).resolves.toEqualTypeOf<ApiResponse<User>>();
    expectTypeOf(api.head('/health')).resolves.toEqualTypeOf<ApiResponse<unknown>>();
  });

  it('types POST, PUT and PATCH bodies with the second generic', () => {
    expectTypeOf(api.post<User, CreateUserDto>)
      .parameter(1)
      .toEqualTypeOf<CreateUserDto | undefined>();
    expectTypeOf(api.put<User, CreateUserDto>('/u', { name: 'x' })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
    expectTypeOf(api.patch<User, Partial<User>>('/u', { id: 1 })).resolves.toEqualTypeOf<
      ApiResponse<User>
    >();
  });

  it('types stream() as a ReadableStream of bytes by default', () => {
    expectTypeOf(api.stream('/file')).resolves.toEqualTypeOf<
      ApiResponse<ReadableStream<Uint8Array>>
    >();
  });

  it('narrows with the type guards', async () => {
    const result = await api.get<User>('/users/1');
    if (isOkResponse(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiOkResponse<User>>();
      expectTypeOf(result.data).toEqualTypeOf<User>();
      expectTypeOf(result.problem).toEqualTypeOf<null>();
    }
    if (isErrorResponse(result)) {
      expectTypeOf(result).toEqualTypeOf<ApiErrorResponse<User>>();
      expectTypeOf(result.error).toEqualTypeOf<RefetchError>();
    }
  });

  it('does not yet narrow on `ok` alone (known gap #12)', async () => {
    const result = await api.get<User>('/users/1');
    if (result.ok) {
      expectTypeOf(result.data).toEqualTypeOf<User | undefined>();
    }
    if (!result.ok) {
      // @ts-expect-error — `error` only exists on ApiErrorResponse until #12 lands
      result.error;
    }
  });

  it('exposes RefetchError as a discriminated union on kind', () => {
    expectTypeOf<RefetchError['kind']>().toEqualTypeOf<
      'network' | 'timeout' | 'cancel' | 'http' | 'parse' | 'unknown'
    >();
    expectTypeOf<Extract<RefetchError, { kind: 'http' }>>().toEqualTypeOf<{
      kind: 'http';
      status: number;
      statusText: string;
    }>();
  });
});
