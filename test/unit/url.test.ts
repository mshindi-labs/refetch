import { describe, expect, it } from 'vitest';
import { buildQueryString, buildUrl } from '../../src/url';

describe('buildQueryString', () => {
  it('returns an empty string when there are no params', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('skips undefined and null values', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: null })).toBe('a=1');
  });

  it('repeats the key for array values', () => {
    expect(buildQueryString({ tag: ['x', 'y'] })).toBe('tag=x&tag=y');
  });

  it('percent-encodes reserved characters', () => {
    expect(buildQueryString({ q: 'a b&c=d' })).toBe('q=a+b%26c%3Dd');
  });

  it('coerces numbers and booleans to strings', () => {
    expect(buildQueryString({ n: 0, f: false })).toBe('n=0&f=false');
  });

  // Known bug #9 — flip `it.fails` to `it` when fixed.
  it.fails('serialises Date values as ISO 8601 (known bug #9)', () => {
    expect(buildQueryString({ d: new Date(0) })).toBe('d=1970-01-01T00%3A00%3A00.000Z');
  });

  it.fails('never emits "[object Object]" for nested objects (known bug #9)', () => {
    expect(buildQueryString({ o: { a: 1 } })).not.toContain('object+Object');
  });
});

describe('buildUrl', () => {
  it.each([
    ['https://a.test/', '/x', 'https://a.test/x'],
    ['https://a.test', 'x', 'https://a.test/x'],
    ['https://a.test/api/', 'v1/users', 'https://a.test/api/v1/users'],
    ['https://a.test/api', '/v1/users', 'https://a.test/api/v1/users'],
  ])('joins %s and %s into %s', (base, path, expected) => {
    expect(buildUrl(base, path)).toBe(expected);
  });

  it('ignores baseURL for absolute URLs', () => {
    expect(buildUrl('https://a.test', 'https://b.test/x')).toBe('https://b.test/x');
    expect(buildUrl('https://a.test', 'http://b.test/x', { q: 1 })).toBe('http://b.test/x?q=1');
  });

  it('appends params with ? or & depending on the existing query', () => {
    expect(buildUrl('https://a.test', '/x', { a: 1 })).toBe('https://a.test/x?a=1');
    expect(buildUrl('https://a.test', '/x?y=2', { a: 1 })).toBe('https://a.test/x?y=2&a=1');
  });

  it('returns the path unchanged when there is no baseURL', () => {
    expect(buildUrl(undefined, '/x')).toBe('/x');
    expect(buildUrl('', '/x', { a: 1 })).toBe('/x?a=1');
  });

  it('throws a TypeError for a non-string url', () => {
    expect(() => buildUrl(undefined, 123 as unknown as string)).toThrow(TypeError);
  });
});
