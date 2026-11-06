import type { InterceptorHandler, InterceptorManager } from './types';

export interface InternalInterceptorManager<T, R = T> extends InterceptorManager<T, R> {
  getAll(): Array<InterceptorHandler<T, R>>;
}

export function createInterceptorManager<T, R = T>(): InternalInterceptorManager<T, R> {
  const handlers = new Map<number, InterceptorHandler<T, R>>();
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
