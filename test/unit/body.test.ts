import { describe, expect, it } from 'vitest';
import {
  getBodyContentType,
  JSON_LIKE_RE,
  prepareRequestBody,
  shouldHaveBody,
} from '../../src/body';

describe('shouldHaveBody', () => {
  it.each(['GET', 'HEAD', 'DELETE', 'get', 'delete'])('is false for %s', (method) => {
    expect(shouldHaveBody(method)).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'OPTIONS', 'QUERY', 'PROPFIND', 'post'])(
    'is true for %s',
    (method) => {
      expect(shouldHaveBody(method)).toBe(true);
    },
  );

  it.todo('allows DELETE bodies when data is provided (#27)');
});

describe('prepareRequestBody', () => {
  it('returns undefined for undefined and null', () => {
    expect(prepareRequestBody(undefined)).toBeUndefined();
    expect(prepareRequestBody(null)).toBeUndefined();
  });

  it('passes native body types through untouched', () => {
    const buffer = new ArrayBuffer(2);
    const values = [
      'text',
      new FormData(),
      new URLSearchParams('a=1'),
      new Blob(['x']),
      buffer,
      new Uint8Array(buffer),
      new ReadableStream(),
    ];
    for (const value of values) {
      expect(prepareRequestBody(value)).toBe(value);
    }
  });

  it('JSON-stringifies plain objects and arrays', () => {
    expect(prepareRequestBody({ a: 1 })).toBe('{"a":1}');
    expect(prepareRequestBody([1, 2])).toBe('[1,2]');
  });

  it('JSON-stringifies primitives other than strings', () => {
    expect(prepareRequestBody(42)).toBe('42');
    expect(prepareRequestBody(true)).toBe('true');
  });
});

describe('getBodyContentType', () => {
  it('is undefined when there is no body', () => {
    expect(getBodyContentType(undefined)).toBeUndefined();
  });

  it('is null for FormData so the runtime can set the multipart boundary', () => {
    expect(getBodyContentType(new FormData())).toBeNull();
  });

  it('labels URLSearchParams as form-urlencoded', () => {
    expect(getBodyContentType(new URLSearchParams())).toBe(
      'application/x-www-form-urlencoded;charset=UTF-8',
    );
  });

  it('uses the Blob type, falling back to octet-stream', () => {
    expect(getBodyContentType(new Blob(['x'], { type: 'text/csv' }))).toBe('text/csv');
    expect(getBodyContentType(new Blob(['x']))).toBe('application/octet-stream');
  });

  it('labels binary buffers and streams as octet-stream', () => {
    expect(getBodyContentType(new ArrayBuffer(1))).toBe('application/octet-stream');
    expect(getBodyContentType(new Uint8Array(1))).toBe('application/octet-stream');
    expect(getBodyContentType(new ReadableStream())).toBe('application/octet-stream');
  });

  it('labels every string as JSON (documented gotcha, see #19)', () => {
    expect(getBodyContentType('{"a":1}')).toBe('application/json');
    expect(getBodyContentType('plain text')).toBe('application/json');
  });
});

describe('JSON_LIKE_RE', () => {
  it.each([
    'application/vnd.api+json',
    'application/ld+json',
    'application/problem+json',
    'text/foo+json',
    'APPLICATION/VND.API+JSON',
  ])('matches %s', (type) => {
    expect(JSON_LIKE_RE.test(type)).toBe(true);
  });

  it.each(['application/json', 'application/jsonx', 'text/plain', 'application/+json'])(
    'does not match %s',
    (type) => {
      expect(JSON_LIKE_RE.test(type)).toBe(false);
    },
  );
});
