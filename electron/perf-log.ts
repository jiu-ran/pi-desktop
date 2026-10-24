/**
 * 卡顿日志（`<项目>/.pi-desktop/logs/perf.log`）。
 *
 * 保留这个薄封装：PiHost 也要写（会话文件坏了、启动慢），
 * 但 PiHost 不能反过来 import main.ts，路径由主进程 useProjectLogs 统一设置。
 */
import { log } from "./logger.ts";

export function logPerfLine(line: string): void {
  log.perf(line);
}
