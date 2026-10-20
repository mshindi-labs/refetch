import { describe, expect, it } from 'vitest';
import {
  normalizeErrorResponse,
  normalizeSuccessResponse,
  parseResponseBody,
} from '../../src/response';
import { PROBLEM_CODE } from '../../src/types';
import { asError } from '../helpers/assert';

const typed = (body: BodyInit | null, type: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });

describe('parseResponseBody', () => {
  it('returns null for 204 and 304 without reading the body', async () => {
    expect(await parseResponseBody(new Response(null, { status: 204 }))).toBeNull();
    expect(await parseResponseBody(new Response(null, { status: 304 }))).toBeNull();
  });

  it('returns null when content-length is 0', async () => {
    const response = new Response(null, {
      headers: { 'content-length': '0', 'content-type': 'application/json' },
    });
    expect(await parseResponseBody(response)).toBeNull();
  });

  it('parses application/json', async () => {
    expect(await parseResponseBody(typed('{"a":1}', 'application/json'))).toEqual({ a: 1 });
  });

  it('ignores media type parameters such as charset', async () => {
    expect(await parseResponseBody(typed('{"a":1}', 'application/json; charset=utf-8'))).toEqual({
      a: 1,
    });
  });

  it.each(['application/vnd.api+json', 'application/ld+json', 'application/problem+json'])(
    'parses %s as JSON',
    async (type) => {
      expect(await parseResponseBody(typed('{"a":1}', type))).toEqual({ a: 1 });
    },
  );

  it('parses form-urlencoded bodies into a record', async () => {
    expect(
      await parseResponseBody(typed('a=1&b=two', 'application/x-www-form-urlencoded')),
    ).toEqual({ a: '1', b: 'two' });
  });

  it.each([
    'image/png',
    'audio/mpeg',
    'video/mp4',
    'application/pdf',
    'application/zip',
    'font/woff2',
    'application/octet-stream',
  ])('returns a Blob for %s', async (type) => {
    const data = await parseResponseBody(typed('bytes', type));
    expect(data).toBeInstanceOf(Blob);
    expect((data as Blob).type).toContain(type);
  });

  it.each(['text/plain', 'text/html', 'application/xml', 'application/xhtml+xml'])(
    'returns text for %s',
    async (type) => {
      expect(await parseResponseBody(typed('<x/>', type))).toBe('<x/>');
    },
  );

  it('falls back to text for unknown media types', async () => {
    expect(await parseResponseBody(typed('raw', 'application/x-unknown'))).toBe('raw');
  });

  it('returns text, or null when empty, without a content-type', async () => {
    // A Blob without a type produces a Response with no content-type header.
    expect(await parseResponseBody(new Response(new Blob(['raw'])))).toBe('raw');
    expect(await parseResponseBody(new Response(new Blob([])))).toBeNull();
  });

  // Known bug #5 — parse failures are swallowed as null today.
  it.fails('rejects with a parse error for malformed JSON (known bug #5)', async () => {
    await expect(parseResponseBody(typed('{not json', 'application/json'))).rejects.toThrow();
  });
});

describe('normalizeSuccessResponse', () => {
  it('builds an ok response with status, headers, duration and the raw Response', () => {
    const raw = typed('{}', 'application/json', 201);
    const result = normalizeSuccessResponse({ a: 1 }, raw, 12);
    expect(result).toMatchObject({
      ok: true,
      problem: null,
      originalError: null,
      data: { a: 1 },
      status: 201,
      duration: 12,
    });
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    expect(result.response).toBe(raw);
  });
});

describe('normalizeErrorResponse', () => {
  it('classifies HTTP failures and keeps the response metadata', () => {
    const raw = typed('{}', 'application/json', 404);
    const result = normalizeErrorResponse(new Error('HTTP 404'), raw, 5);
    expect(result).toMatchObject({
      ok: false,
      problem: PROBLEM_CODE.CLIENT_ERROR,
      status: 404,
      duration: 5,
      data: undefined,
    });
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    expect(asError(result).error).toEqual({ kind: 'http', status: 404, statusText: '' });
  });

  it('classifies transport failures that have no response', () => {
    const result = normalizeErrorResponse(new TypeError('fetch failed'));
    expect(result).toMatchObject({
      ok: false,
      problem: PROBLEM_CODE.NETWORK_ERROR,
      status: undefined,
      headers: undefined,
    });
    expect(asError(result).error.kind).toBe('network');
  });
});
