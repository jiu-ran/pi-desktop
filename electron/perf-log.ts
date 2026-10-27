/**
 * 卡顿日志（`<项目>/.pi-desktop/logs/perf.log`）。
 *
 * 保留这个薄封装：PiHost 也要写（会话文件坏了、启动慢），
 * 但 PiHost 不能反过来 import main.ts，路径由主进程 activateLogs 统一设置。
 */
import { log } from "./logger.ts";

export function logPerfLine(line: string): void {
  log.perf(line);
}

/**
 * 「当前正在做的事」：卡顿日志能写清是哪个 IPC / 哪个后台任务把主线程占住了。
 *
 * 只保留最内层的一层（嵌套时恢复上一层），开销就是一次赋值，适合包在所有 IPC 外面。
 */
let currentActivity = "";

export function activity(): string {
  return currentActivity;
}

/** 跑一段可能很慢的同步/异步逻辑，并在卡顿日志里标出它的名字。 */
export async function withActivity<T>(label: string, run: () => Promise<T> | T): Promise<T> {
  const previous = currentActivity;
  currentActivity = label;
  try {
    return await run();
  } finally {
    currentActivity = previous;
  }
}
