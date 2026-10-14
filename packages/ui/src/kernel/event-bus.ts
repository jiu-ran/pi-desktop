export type EventHandler<T = any> = (payload: T) => void;

export interface EventBus {
  on: (type: string, handler: EventHandler) => () => void;
  emit: (type: string, payload?: any) => void;
}

/**
 * 极简事件总线。内核、各服务与插件之间只通过事件通信，互不引用。
 */
export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();

  function on(type: string, handler: EventHandler): () => void {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
    return () => { handlers.get(type)?.delete(handler); };
  }

  function emit(type: string, payload?: any): void {
    for (const handler of [...(handlers.get(type) ?? [])]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[bus] ${type} handler failed`, error);
      }
    }
    if (type !== "*") {
      for (const handler of [...(handlers.get("*") ?? [])]) {
        try {
          handler({ type, payload });
        } catch (error) {
          console.error("[bus] wildcard handler failed", error);
        }
      }
    }
  }

  return { on, emit };
}
