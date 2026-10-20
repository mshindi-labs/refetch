import { describe, expect, it } from 'vitest';
import { headersToObject, mergeHeaders } from '../../src/headers';

describe('mergeHeaders', () => {
  it('accepts plain objects, Headers instances and tuple arrays', () => {
    const merged = mergeHeaders({ a: '1' }, new Headers({ b: '2' }), [['c', '3']]);
    expect(headersToObject(merged)).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('skips undefined sources', () => {
    expect(headersToObject(mergeHeaders(undefined, { a: '1' }, undefined))).toEqual({ a: '1' });
  });

  it('lets later sources override earlier ones, case-insensitively', () => {
    const merged = mergeHeaders(
      { 'Content-Type': 'text/plain' },
      { 'content-type': 'application/json' },
    );
    expect(merged.get('content-type')).toBe('application/json');
    expect([...merged.keys()]).toEqual(['content-type']);
  });

  it('returns a fresh Headers instance that does not alias its sources', () => {
    const source = new Headers({ a: '1' });
    const merged = mergeHeaders(source);
    merged.set('a', '2');
    expect(source.get('a')).toBe('1');
    expect(merged).toBeInstanceOf(Headers);
  });
});

describe('headersToObject', () => {
  it('produces a plain object with lower-cased keys', () => {
    expect(headersToObject(new Headers({ 'X-Foo': 'bar', Accept: 'a' }))).toEqual({
      'x-foo': 'bar',
      accept: 'a',
    });
  });

  it('returns an empty object for empty headers', () => {
    expect(headersToObject(new Headers())).toEqual({});
  });
});
