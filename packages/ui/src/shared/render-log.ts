/**
 * 渲染进程日志上报。
 *
 * 前端出了问题（Vue 报错、未捕获异常、console.error）在主进程看来常常「什么都没发生」，
 * 所以要主动送到主进程落盘。这里只接管 warn / error，debug 一律不写，避免噪音。
 *
 * 纯观测代码：任何上报失败都必须被吞掉，不能影响界面。
 */

export type RenderLogLevel = "debug" | "info" | "warn" | "error";

export interface ConsoleLike {
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export const MAX_LOG_MESSAGE = 4000;

/** 把任意参数压成一行可读文本（Error 带上栈，对象走 JSON）。 */
export function formatLogMessage(args: any[]): string {
  const parts: string[] = [];
  for (const arg of args ?? []) {
    if (typeof arg === "string") parts.push(arg);
    else if (arg instanceof Error) parts.push(`${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`);
    else {
      try {
        parts.push(JSON.stringify(arg));
      } catch {
        parts.push(String(arg));
      }
    }
  }
  const text = parts.join(" ").trim();
  return text.length > MAX_LOG_MESSAGE ? `${text.slice(0, MAX_LOG_MESSAGE)}…（截断）` : text;
}

export interface LogBridge {
  logEvent?: (level: RenderLogLevel, scope: string, message: string) => void;
}

/** 安装 console / 全局错误的上报，返回卸载函数。 */
export function installRenderLogReporter(bridge: LogBridge, options: { console?: ConsoleLike } = {}): () => void {
  const report = (level: RenderLogLevel, scope: string, args: any[]) => {
    try {
      const message = formatLogMessage(args);
      if (message) bridge.logEvent?.(level, scope, message);
    } catch {
      // 上报失败不影响界面
    }
  };
  const consoleLike: ConsoleLike = options.console ?? (typeof console !== "undefined" ? console : {});
  const originalWarn = consoleLike.warn;
  const originalError = consoleLike.error;
  consoleLike.warn = (...args: any[]) => {
    report("warn", "console", args);
    originalWarn?.apply(consoleLike, args);
  };
  consoleLike.error = (...args: any[]) => {
    report("error", "console", args);
    originalError?.apply(consoleLike, args);
  };

  const onError = (event: any) => {
    report("error", "window.onerror", [
      `${event?.message ?? "脚本错误"} @ ${String(event?.filename ?? "")}:${event?.lineno ?? 0}:${event?.colno ?? 0}`,
      event?.error,
    ]);
  };
  const onRejection = (event: any) => {
    report("error", "unhandledrejection", [event?.reason]);
  };
  const target = typeof window !== "undefined" ? window : null;
  target?.addEventListener?.("error", onError);
  target?.addEventListener?.("unhandledrejection", onRejection);
  return () => {
    consoleLike.warn = originalWarn;
    consoleLike.error = originalError;
    target?.removeEventListener?.("error", onError);
    target?.removeEventListener?.("unhandledrejection", onRejection);
  };
}
