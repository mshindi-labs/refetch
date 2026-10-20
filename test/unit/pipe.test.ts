import { describe, expect, it } from 'vitest';
import { pipe } from '../../src/pipe';

describe('pipe', () => {
  it('applies functions left to right', () => {
    expect(
      pipe(
        1,
        (n) => n + 1,
        (n) => n * 10,
      ),
    ).toBe(20);
  });

  it('returns the value untouched when there are no functions', () => {
    const value = {};
    expect(pipe(value)).toBe(value);
  });
});
