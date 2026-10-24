/**
 * 日志持久化。
 *
 * 目标：出问题（卡死、会话读不出来、更新失败、渲染进程报错）时能翻到证据，
 * 但日志本身绝不能变成负担——总量硬上限 100MB，超出后按时间删旧文件。
 *
 * 设计：
 * - 按来源分文件：app（主进程生命周期 / 未捕获异常 / IPC 错误）、
 *   renderer（前端 console.warn/error、Vue 错误）、pi（Pi worker 关键事件）、
 *   perf（卡顿 / 慢 IPC / 长任务）。
 * - 单文件到 8MB 就轮转成 `<stream>-<时间戳>.log`，最多留 12 个（96MB < 100MB），
 *   并且总量超限时从最旧的开始删；正在写的文件永远不删。
 * - 写入走内存缓冲 + 定时 flush，不当场 await：慢磁盘不能拖慢界面。
 * - 所有内容先脱敏（密钥 / Bearer / 密码 / 长 base64），避免把秘密写进文件。
 */
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogStream = "app" | "renderer" | "pi" | "perf";

/** 日志总量上限：100MB（用户要求）。 */
export const LOG_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** 单个文件上限：8MB，轮转一次就换新文件，方便翻最近的记录。 */
export const LOG_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** 最多保留多少个历史文件：12 × 8MB = 96MB，留一点余量给正在写的文件。 */
export const LOG_KEEP_FILES = 12;
/** flush 间隔与单次缓冲上限 */
const FLUSH_MS = 400;
const MAX_BUFFER_BYTES = 256 * 1024;

export interface LogFileEntry {
  name: string;
  size: number;
  mtimeMs: number;
}

/** 文件到上限了吗 */
export function shouldRotate(size: number, maxFileBytes = LOG_MAX_FILE_BYTES): boolean {
  return size >= maxFileBytes;
}

/**
 * 需要清理哪些文件。
 * 规则：先按「超出保留个数」删最旧的，再按「总量超上限」删最旧的；
 * 正在写的文件（没有时间戳的那个）永远不删。
 */
export function pickExpiredLogs(
  files: LogFileEntry[],
  activeNames: string[] = [],
  maxTotalBytes = LOG_MAX_TOTAL_BYTES,
  keepFiles = LOG_KEEP_FILES,
): string[] {
  const active = new Set(activeNames);
  const candidates = files
    .filter((file) => !active.has(file.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  const expired: string[] = [];
  // 1) 文件数超限：删最旧的（正在写的文件也算占用名额）
  const allowed = Math.max(0, keepFiles - active.size);
  while (candidates.length > allowed) {
    const oldest = candidates.shift();
    if (oldest) expired.push(oldest.name);
  }
  // 2) 总量超限：继续删最旧的，直到放得下
  let total = files
    .filter((file) => !expired.includes(file.name))
    .reduce((sum, file) => sum + file.size, 0);
  while (total > maxTotalBytes && candidates.length > 0) {
    const oldest = candidates.shift();
    if (!oldest) break;
    expired.push(oldest.name);
    total -= oldest.size;
  }
  return expired;
}

/** 密钥类内容脱敏；宁可比实际更严一点，也不要把 key 写进日志。 */
export function redactLog(input: string): string {
  return String(input ?? "")
    // sk-xxx / ghp_xxx / xoxb-xxx / AIza... 这类常见 token
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "$1-***")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_***")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox*-***")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza***")
    // Authorization: Bearer xxx / api-key: xxx / password=xxx
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    // 注意排除 Bearer：那种写法交给下面的规则，否则会被替换成「Authorization: *** ***」
    .replace(/((?:api[-_]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)(?!Bearer\b)[^\s"',;}]{6,}/gi, "$1***")
    // 太长的 base64 / data URL（图片、附件内容）只留长度
    .replace(/data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]{64,}/gi, (_m, mime: string) => `data:${mime};base64,<省略>`)
    .replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, (m: string) => `<省略 ${m.length} 字符 base64>`);
}

/** 一行日志：`2026-10-25T02:10:11.123Z [app] WARN 消息` */
export function formatLogLine(level: LogLevel, scope: string, message: string, at: Date = new Date()): string {
  const label = level.toUpperCase().padEnd(5, " ");
  const tag = scope ? `(${scope})` : "";
  const text = redactLog(String(message ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "")
    // 多行内容压成一行，避免一条日志占几十行
    .replace(/\n/g, " ⏎ ");
  return `${at.toISOString()} [${label.trim()}]${tag ? ` ${tag}` : ""} ${text}\n`;
}

interface StreamState {
  file: string;
  buffer: string[];
  bufferedBytes: number;
  size: number;
  writing: Promise<void>;
}

/** 日志落盘器：由主进程 configure 之后使用，模块内单例。 */
class LogStore {
  private dir = "";
  private streams = new Map<LogStream, StreamState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private rotating = false;

  configure(dir: string): void {
    this.dir = dir;
    this.streams.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.flushAll();
    }, FLUSH_MS);
    (this.timer as any).unref?.();
  }

  get directory(): string {
    return this.dir;
  }

  enabled(): boolean {
    return Boolean(this.dir);
  }

  private activeName(stream: LogStream): string {
    return `${stream}.log`;
  }

  private state(stream: LogStream): StreamState {
    let state = this.streams.get(stream);
    if (!state) {
      state = {
        file: path.join(this.dir, this.activeName(stream)),
        buffer: [],
        bufferedBytes: 0,
        size: 0,
        writing: Promise.resolve(),
      };
      this.streams.set(stream, state);
    }
    return state;
  }

  write(stream: LogStream, level: LogLevel, scope: string, message: string): void {
    if (!this.dir) return;
    const state = this.state(stream);
    const line = formatLogLine(level, scope, message);
    state.buffer.push(line);
    state.bufferedBytes += line.length;
    if (state.bufferedBytes >= MAX_BUFFER_BYTES) void this.flush(stream);
  }

  private async flush(stream: LogStream): Promise<void> {
    const state = this.state(stream);
    if (!state.buffer.length) return;
    const text = state.buffer.join("");
    state.buffer = [];
    state.bufferedBytes = 0;
    // 串行写，避免并发 append 互相插队
    state.writing = state.writing.then(async () => {
      try {
        await mkdir(this.dir, { recursive: true });
        // 每次 flush 前看真实大小：外部追加、日志被手动清空都能正确处理。
        // 一次 stat 的成本远低于写完发现文件已经 8MB。
        state.size = await stat(state.file).then((info) => info.size).catch(() => 0);
        if (shouldRotate(state.size)) await this.rotate(stream, state);
        await appendFile(state.file, text, "utf8");
        state.size += Buffer.byteLength(text, "utf8");
      } catch {
        // 日志写失败不影响应用
      }
    });
    await state.writing;
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.streams.keys()].map((stream) => this.flush(stream)));
  }

  private async rotate(stream: LogStream, state: StreamState): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.dir, `${stream}-${stamp}.log`);
    try {
      await rename(state.file, target);
    } catch {
      // 文件不存在时忽略
    }
    state.size = 0;
    await this.prune();
  }

  /** 清掉超量的旧文件（含总量 100MB 上限）。 */
  async prune(): Promise<string[]> {
    if (!this.dir) return [];
    try {
      const names = await readdir(this.dir);
      const entries: LogFileEntry[] = [];
      for (const name of names) {
        if (!name.endsWith(".log")) continue;
        const info = await stat(path.join(this.dir, name)).catch(() => null);
        if (info?.isFile()) entries.push({ name, size: info.size, mtimeMs: info.mtimeMs });
      }
      const active = [...this.streams.keys()].map((stream) => this.activeName(stream));
      const expired = pickExpiredLogs(entries, active);
      await Promise.all(expired.map((name) => rm(path.join(this.dir, name), { force: true }).catch(() => {})));
      return expired;
    } catch {
      return [];
    }
  }

  /** 统计总量（上限检查 / 设置页展示用）。 */
  async summary(): Promise<{ dir: string; totalBytes: number; files: LogFileEntry[] }> {
    if (!this.dir) return { dir: "", totalBytes: 0, files: [] };
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const files: LogFileEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".log")) continue;
      const info = await stat(path.join(this.dir, name)).catch(() => null);
      if (info?.isFile()) files.push({ name, size: info.size, mtimeMs: info.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { dir: this.dir, totalBytes: files.reduce((sum, file) => sum + file.size, 0), files };
  }

  async clear(): Promise<void> {
    if (!this.dir) return;
    const names = await readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => name.endsWith(".log")).map((name) => rm(path.join(this.dir, name), { force: true }).catch(() => {})));
    for (const state of this.streams.values()) {
      state.size = 0;
      state.buffer = [];
      state.bufferedBytes = 0;
    }
  }
}

export const logStore = new LogStore();

/** 主进程启动时调一次（目录来自 userData）。 */
export function configureLogs(dir: string): void {
  logStore.configure(dir);
}

/** 写一条日志（不 await：慢磁盘不应拖住调用方）。 */
export function logEvent(stream: LogStream, level: LogLevel, scope: string, message: string): void {
  logStore.write(stream, level, scope, message);
}

export const log = {
  debug: (scope: string, message: string) => logEvent("app", "debug", scope, message),
  info: (scope: string, message: string) => logEvent("app", "info", scope, message),
  warn: (scope: string, message: string) => logEvent("app", "warn", scope, message),
  error: (scope: string, message: string) => logEvent("app", "error", scope, message),
  renderer: (level: LogLevel, scope: string, message: string) => logEvent("renderer", level, scope, message),
  pi: (level: LogLevel, scope: string, message: string) => logEvent("pi", level, scope, message),
  perf: (message: string) => logEvent("perf", "info", "perf", message),
};
