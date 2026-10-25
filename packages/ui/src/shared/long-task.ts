/**
 * 渲染进程长任务上报。
 *
 * 「界面卡死」可能是主进程被同步阻塞，也可能是渲染进程在憋一个巨长的任务。
 * 主进程有自己的卡顿日志（项目下的 .pi-desktop/logs/perf.log），这里补上渲染侧：超过 1 秒的任务
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

/** 两次心跳间隔超过该值，说明渲染进程有一段时间根本没跑定时器（卡住或接近卡住）。 */
export const LAG_THRESHOLD_MS = 3000;
/** 同一次卡顿只记一条：恢复后补记，用来定位「什么时候开始卡的」。 */
export const LAG_MIN_INTERVAL_MS = 10_000;

/** 该不该记录这次停摆：低于阈值不报，和上一条太近也不报。 */
export function shouldReportLag(
  drift: number,
  lastReportAt: number,
  now: number,
  threshold = LAG_THRESHOLD_MS,
  minInterval = LAG_MIN_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(drift) || drift < threshold) return false;
  return now - lastReportAt >= minInterval;
}

/**
 * 心跳看门狗：每秒比对一次「应该过去多久」与「实际过去多久」。
 *
 * 用于死循环是没用的（定时器不会触发），但能抓到「卡了 3–30 秒又自己恢复」
 * 或者「主进程被阻塞」这类间歇卡顿，并在恢复后立刻留一条带时间戳的记录。
 */
export function installLagWatchdog(options: {
  report: (driftMs: number, at: string) => void;
  intervalMs?: number;
  threshold?: number;
  minInterval?: number;
}): () => void {
  const interval = options.intervalMs ?? 1000;
  const threshold = options.threshold ?? LAG_THRESHOLD_MS;
  const minInterval = options.minInterval ?? LAG_MIN_INTERVAL_MS;
  let expected = Date.now() + interval;
  let lastReportAt = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const drift = now - expected;
    expected = now + interval;
    if (!shouldReportLag(drift, lastReportAt, now, threshold, minInterval)) return;
    lastReportAt = now;
    try {
      options.report(drift, new Date(now - drift).toISOString());
    } catch {
      // 记录失败不能影响界面
    }
  }, interval);
  return () => clearInterval(timer);
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
