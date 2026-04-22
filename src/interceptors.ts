import type { InterceptorHandler, InterceptorManager } from './types';

export interface InternalInterceptorManager<T> extends InterceptorManager<T> {
  getAll(): Array<InterceptorHandler<T>>;
}

export function createInterceptorManager<T>(): InternalInterceptorManager<T> {
  const handlers = new Map<number, InterceptorHandler<T>>();
  let nextId = 0;

  return {
    use(onFulfilled?, onRejected?) {
      const id = nextId++;
      handlers.set(id, { onFulfilled, onRejected });
      return id;
    },
    eject(id) {
      handlers.delete(id);
    },
    clear() {
      handlers.clear();
    },
    getAll() {
      return Array.from(handlers.values());
    },
  };
}
