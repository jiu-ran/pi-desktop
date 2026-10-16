export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

export interface EventBus {
  on: (type: string, handler: EventHandler) => () => void;
  emit: (type: string, payload?: any) => void;
  dispose: () => void;
}

/**
 * 极简事件总线。内核、各服务与插件之间只通过事件通信，互不引用。
 */
export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  let disposed = false;

  function on(type: string, handler: EventHandler): () => void {
    if (disposed) return () => {};
    let bucket = handlers.get(type);
    if (!bucket) {
      bucket = new Set();
      handlers.set(type, bucket);
    }
    bucket.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      bucket!.delete(handler);
      if (!bucket!.size) handlers.delete(type);
    };
  }

  function invoke(type: string, handler: EventHandler, payload: any): void {
    try {
      const result = handler(payload);
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch((error) => {
          console.error(`[bus] ${type} handler failed`, error);
        });
      }
    } catch (error) {
      console.error(`[bus] ${type} handler failed`, error);
    }
  }

  function emit(type: string, payload?: any): void {
    if (disposed) return;
    for (const handler of [...(handlers.get(type) ?? [])]) invoke(type, handler, payload);
    if (type !== "*") {
      for (const handler of [...(handlers.get("*") ?? [])]) {
        invoke("*", handler, { type, payload });
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    handlers.clear();
  }

  return { on, emit, dispose };
}
