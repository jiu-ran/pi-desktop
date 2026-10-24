/**
 * 卡顿日志（userData/main-lag.log）。
 *
 * 为什么单独一个模块：PiHost 也要写（会话文件坏了、启动慢），
 * 但 PiHost 不能反过来 import main.ts。这里只负责「写一行」，路径由 main 设置。
 */
import { readFile, writeFile } from "node:fs/promises";

const MAX_LOG_BYTES = 256 * 1024;

let logFile = "";

/** 由主进程在 ready 之后设定（依赖 app.getPath，不能在模块顶层取）。 */
export function setPerfLogFile(file: string): void {
  logFile = file;
}

export function perfLogPath(): string {
  return logFile;
}

/** 追加一行带时间戳的日志；超过上限就从新开始，避免日志自己变成负担。 */
export function logPerfLine(line: string): void {
  if (!logFile) return;
  const text = `${new Date().toISOString()} ${line}\n`;
  void readFile(logFile, "utf8")
    .then((previous) => (previous.length > MAX_LOG_BYTES ? text : previous + text))
    .catch(() => text)
    .then((next) => writeFile(logFile, next))
    .catch(() => {});
}
