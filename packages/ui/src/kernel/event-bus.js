/**
 * 极简事件总线。内核、各服务与插件之间只通过事件通信，互不引用。
 */
export function createEventBus() {
  const handlers = new Map();

  function on(type, handler) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(handler);
    return () => handlers.get(type)?.delete(handler);
  }

  function emit(type, payload) {
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
