/**
 * 渲染进程长任务上报。
 *
 * 「界面卡死」可能是主进程被同步阻塞，也可能是渲染进程在憋一个巨长的任务。
 * 主进程有自己的卡顿日志（main-lag.log），这里补上渲染侧：超过 1 秒的任务
 * 通过 IPC 记到同一份日志里，出问题时能直接看出是哪一侧、卡了多久。
 *
 * 只上报不修复，纯观测代码：不能影响正常渲染，所以默认节流并且失败就静默。
 */

export const LONG_TASK_THRESHOLD_MS = 1000;
/** 同一批长任务最多每秒记一条，避免一次卡顿刷出几十行 */
export const LONG_TASK_MIN_INTERVAL_MS = 1000;

/** 该不该上报：低于阈值不报，和上一条太近也不报。 */
export function shouldReportLongTask(
  duration: number,
  lastReportAt: number,
  now: number,
  threshold = LONG_TASK_THRESHOLD_MS,
  minInterval = LONG_TASK_MIN_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(duration) || duration < threshold) return false;
  return now - lastReportAt >= minInterval;
}

/** 长任务的 name 基本没用（都是自链接脚本），能给出的只有来源类型。 */
export function longTaskLabel(entry: { name?: string }): string {
  const name = String(entry?.name ?? "").trim();
  return name === "" || name === "self" || name === "unknown" ? "" : name.slice(0, 60);
}

export interface LongTaskReporterOptions {
  report: (ms: number, label: string) => void;
  threshold?: number;
  minInterval?: number;
}

/**
 * 安装上报器，返回卸载函数。
 * 环境不支持 PerformanceObserver 时直接返回空函数（不抛错）。
 */
export function installLongTaskReporter(options: LongTaskReporterOptions): () => void {
  const threshold = options.threshold ?? LONG_TASK_THRESHOLD_MS;
  const minInterval = options.minInterval ?? LONG_TASK_MIN_INTERVAL_MS;
  if (typeof PerformanceObserver === "undefined") return () => {};
  let lastReportAt = 0;
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const now = Date.now();
        if (!shouldReportLongTask(entry.duration, lastReportAt, now, threshold, minInterval)) continue;
        lastReportAt = now;
        try {
          options.report(entry.duration, longTaskLabel(entry));
        } catch {
          // 上报本身不能把界面搞坏
        }
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    return () => {};
  }
  return () => observer.disconnect();
}
