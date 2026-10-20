import { describe, expect, it } from 'vitest';
import { headersToObject, mergeHeaders, setRequestHeader } from '../../src/headers';

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

describe('setRequestHeader', () => {
  it('returns a new config with the header set, whatever shape the headers had', () => {
    const shapes: (HeadersInit | undefined)[] = [
      { 'X-A': '1' },
      new Headers({ 'X-A': '1' }),
      [['X-A', '1']],
      undefined,
    ];
    for (const headers of shapes) {
      const config = { url: '/x', headers };
      const next = setRequestHeader(config, 'Authorization', 'Bearer t');
      expect(next).not.toBe(config);
      expect(config.headers).toBe(headers);
      expect(mergeHeaders(next.headers).get('authorization')).toBe('Bearer t');
      if (headers) expect(mergeHeaders(next.headers).get('x-a')).toBe('1');
    }
  });

  it('overrides an existing header case-insensitively', () => {
    const next = setRequestHeader({ headers: { authorization: 'old' } }, 'Authorization', 'new');
    expect(next.headers).toEqual({ authorization: 'new' });
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
