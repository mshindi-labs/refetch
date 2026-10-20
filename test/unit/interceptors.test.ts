import { describe, expect, it } from 'vitest';
import { createInterceptorManager } from '../../src/interceptors';

describe('createInterceptorManager', () => {
  it('returns incrementing ids starting at 0', () => {
    const manager = createInterceptorManager<number>();
    expect(manager.use((value) => value)).toBe(0);
    expect(manager.use((value) => value)).toBe(1);
  });

  it('keeps handlers in insertion order', () => {
    const manager = createInterceptorManager<number>();
    const first = (value: number) => value + 1;
    const last = (value: number) => value * 2;
    manager.use(first);
    manager.use(undefined, async () => 0);
    manager.use(last);
    expect(manager.getAll().map((handler) => handler.onFulfilled)).toEqual([
      first,
      undefined,
      last,
    ]);
  });

  it('ejects a single handler by id and ignores unknown ids', () => {
    const manager = createInterceptorManager<number>();
    const id = manager.use((value) => value);
    manager.use((value) => value);
    manager.eject(id);
    manager.eject(999);
    expect(manager.getAll()).toHaveLength(1);
  });

  it('clears all handlers', () => {
    const manager = createInterceptorManager<number>();
    manager.use((value) => value);
    manager.clear();
    expect(manager.getAll()).toEqual([]);
  });

  it('never reuses an id after ejection', () => {
    const manager = createInterceptorManager<number>();
    const first = manager.use((value) => value);
    manager.eject(first);
    expect(manager.use((value) => value)).toBe(first + 1);
  });
});
