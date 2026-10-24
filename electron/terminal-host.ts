import { execFile, spawn, type ChildProcess } from "node:child_process";
import { log } from "./logger.ts";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { IDisposable, IPty } from "node-pty";
import { closeWindowsPty } from "./terminal-pty-cleanup.ts";
import { commandForTerminalProfile, resolveTerminalProfile, systemShellCandidate, type TerminalPtyOptions, type TerminalShellProfile } from "./terminal-profiles.ts";

/**
 * 桌面端后台任务宿主。
 *
 * 一次性命令每条独占一个子进程；交互式终端使用真实 PTY，
 * 因而可以运行 Claude Code、Codex、Pi、vim、top 等需要全屏/光标控制
 * 和 Ctrl+C 的程序。旧的管道式 shell API 保留兼容旧界面，一次性任务不依赖原生模块。
 */

export type TerminalTaskStatus = "running" | "stopping" | "exited" | "failed" | "stopped";

export interface TerminalTaskInfo {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  shell: string;
  startedAt: number;
  endedAt?: number;
  status: TerminalTaskStatus;
  exitCode?: number | null;
  signal?: string | null;
  /** 交互式会话会保持 stdin 打开，支持逐行发送输入。 */
  interactive?: boolean;
  /** 使用真实伪终端（PTY）承载全屏 TUI 与终端级信号。 */
  pty?: boolean;
  /** PTY 当前列数/行数。 */
  cols?: number;
  rows?: number;
  profileId?: string;
  shellPath?: string;
}

export interface TerminalTaskSnapshot extends TerminalTaskInfo {
  output: string;
  truncated: boolean;
}

export type TerminalEvent =
  | { type: "start"; task: TerminalTaskInfo }
  | { type: "data"; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "status"; task: TerminalTaskInfo }
  | { type: "exit"; id: string; status: TerminalTaskStatus; exitCode?: number | null; signal?: string | null; endedAt: number };

interface TerminalTask extends TerminalTaskInfo {
  output: string;
  pending: string;
  pendingStream: "stdout" | "stderr";
  truncated: boolean;
  child?: ChildProcess;
  ptyProcess?: IPty;
  ptySubscriptions?: IDisposable[];
  flushTimer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  stopRequested: boolean;
  finished: boolean;
  spawnError?: string;
}

export interface TerminalHostOptions {
  emit: (event: TerminalEvent) => void;
  maxTasks?: number;
  maxOutput?: number;
}

const DEFAULT_MAX_TASKS = 8;
const DEFAULT_MAX_OUTPUT = 1024 * 1024;
const MAX_COMMAND_LENGTH = 32_000;
const MAX_PTY_INPUT = 256_000;
const OUTPUT_BATCH_CHARS = 32 * 1024;
const DEFAULT_PTY_COLS = 100;
const DEFAULT_PTY_ROWS = 30;

let ptyModulePromise: Promise<{ spawn: typeof import("node-pty").spawn }> | null = null;

/** 延迟加载原生模块：加载失败时应用仍能启动，并在创建终端时给出明确错误。 */
function loadPtyModule(): Promise<{ spawn: typeof import("node-pty").spawn }> {
  if (!ptyModulePromise) {
    ptyModulePromise = import("node-pty")
      .then((module: any) => {
        const spawnPty = module?.spawn ?? module?.default?.spawn;
        if (typeof spawnPty !== "function") throw new Error("node-pty 未导出 spawn");
        return { spawn: spawnPty };
      })
      .catch((error: any) => {
        ptyModulePromise = null;
        throw new Error(`无法加载本地终端组件（node-pty）：${error?.message || String(error)}`);
      });
  }
  return ptyModulePromise;
}

/** 从尾部保留输出，并尽量从完整行开始，避免把 ANSI 序列或半行截断。 */
function trimOutput(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let next = text.slice(-limit);
  const newline = next.indexOf("\n");
  if (newline >= 0 && newline < 8192) next = next.slice(newline + 1);
  return next;
}

/** 去掉常见 ANSI 颜色/光标控制序列，用于复制和对外展示的纯文本。 */
export function stripTerminalAnsi(value: string): string {
  return String(value)
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[@-_]/g, "");
}

export interface ResolvedTerminalShell {
  file: string;
  args: string[];
  label: string;
  windowsVerbatimArguments?: boolean;
}

/** 平台对应的命令壳；Windows 使用 PowerShell 以尽量保持 UTF-8 中文输出。 */
export function resolveTerminalShell(command: string, platform: NodeJS.Platform = process.platform): ResolvedTerminalShell {
  if (platform === "win32") {
    // PowerShell 把以引号开头的字符串当作表达式；补一个调用运算符，
    // 这样 `"C:\\Program Files\\..." --flag` 这类命令也能执行。
    const trimmed = command.trimStart();
    const body = /^["']/.test(trimmed) ? `& ${trimmed}` : trimmed;
    const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ${body}; exit $LASTEXITCODE`;
    return {
      file: process.env.PI_DESKTOP_POWERSHELL || "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped],
      label: "PowerShell",
    };
  }
  const shell = process.env.SHELL || "/bin/bash";
  return {
    file: shell,
    args: ["-lc", command],
    label: path.basename(shell) || "shell",
  };
}

/**
 * 长驻交互式 shell。
 *
 * Windows 用 cmd 先把代码页切到 UTF-8，再启动 PowerShell 从管道读取命令：
 * 这样中文、全角标点和 SQL 都不会被系统 ANSI 代码页截断，同时 PowerShell
 * 保持一个会话，mysql / python 等行式程序可以直接继承 stdin。
 * Unix 使用登录 shell，非交互模式下不打印提示符和命令回显。
 */
export function resolveInteractiveShell(platform: NodeJS.Platform = process.platform): ResolvedTerminalShell {
  if (platform === "win32") {
    const powershell = process.env.PI_DESKTOP_POWERSHELL || "powershell.exe";
    // 只拼接静态启动参数，用户输入永远走 stdin，不进入命令行。
    const command = `chcp 65001 >nul & "${powershell}" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command -`;
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/D", "/Q", "/C", command],
      label: "PowerShell",
    };
  }
  const shell = process.env.SHELL || "/bin/bash";
  return {
    file: shell,
    args: ["-l"],
    label: path.basename(shell) || "shell",
  };
}

/** 系统默认命令解释器；真实启动时还会验证可执行路径。 */
export function resolvePtyShell(platform: NodeJS.Platform = process.platform): ResolvedTerminalShell {
  return systemShellCandidate({ platform });
}

function normalizePtySize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const c = Math.round(Number(cols));
  const r = Math.round(Number(rows));
  return {
    cols: Number.isFinite(c) ? Math.min(500, Math.max(2, c)) : DEFAULT_PTY_COLS,
    rows: Number.isFinite(r) ? Math.min(200, Math.max(1, r)) : DEFAULT_PTY_ROWS,
  };
}

/** PTY 下终端程序会自行判断颜色能力，因此不再强制 FORCE_COLOR。 */
function ptyEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  // 前端确实是 xterm，不能继承启动应用的外部终端类型（例如 dumb / vt100）。
  env.TERM = "xterm-256color";
  env.COLORTERM = process.env.COLORTERM || "truecolor";
  env.TERM_PROGRAM = "Pi Desktop";
  env.PYTHONIOENCODING = process.env.PYTHONIOENCODING || "utf-8";
  return env;
}

export class TerminalHost {
  private readonly emitEvent: (event: TerminalEvent) => void;
  private readonly maxTasks: number;
  private readonly maxOutput: number;
  private readonly tasks = new Map<string, TerminalTask>();
  private pendingStarts = 0;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(options: TerminalHostOptions) {
    this.emitEvent = options.emit;
    this.maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
    this.maxOutput = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
  }

  private info(task: TerminalTask): TerminalTaskInfo {
    return {
      id: task.id,
      command: task.command,
      cwd: task.cwd,
      pid: task.pid,
      shell: task.shell,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      status: task.status,
      exitCode: task.exitCode,
      signal: task.signal,
      interactive: task.interactive,
      pty: task.pty,
      cols: task.cols,
      rows: task.rows,
      profileId: task.profileId,
      shellPath: task.shellPath,
    };
  }

  private emit(event: TerminalEvent): void {
    if (this.disposed) return;
    try {
      this.emitEvent(event);
    } catch {
      // 窗口正在销毁时忽略发送失败，不能因为上报事件影响子进程回收。
    }
  }

  private prune(): void {
    // 只清理已完成的最旧记录，运行中的任务永远保留。
    if (this.tasks.size <= 20) return;
    const finished = [...this.tasks.values()]
      .filter((task) => task.finished)
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const task of finished) {
      if (this.tasks.size <= 20) break;
      this.tasks.delete(task.id);
    }
  }

  private assertCanStart(): void {
    if (this.disposed) throw new Error("终端宿主已经关闭");
    const running = [...this.tasks.values()].filter(
      (task) => task.status === "running" || task.status === "stopping",
    ).length;
    if (running + this.pendingStarts >= this.maxTasks) {
      throw new Error(`同时运行的后台任务不能超过 ${this.maxTasks} 个，请先停止一个任务`);
    }
  }

  private spawnTask(
    cwd: string,
    resolved: ResolvedTerminalShell,
    command: string,
    interactive: boolean,
    profile?: TerminalShellProfile,
  ): TerminalTaskInfo {
    const id = `term-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const startedAt = Date.now();
    // 子进程的 stdio 是管道，很多工具会因此关闭颜色。显式打开颜色后，
    // 渲染层可以按 ANSI 还原终端效果；用户设置 NO_COLOR 时仍然尊重。
    const colorEnv = process.env.NO_COLOR
      ? {}
      : {
          FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
          CLICOLOR_FORCE: process.env.CLICOLOR_FORCE ?? "1",
          COLORTERM: process.env.COLORTERM ?? "truecolor",
          TERM: process.env.TERM && process.env.TERM !== "dumb" ? process.env.TERM : "xterm-256color",
        };
    let child: ChildProcess;
    try {
      child = spawn(resolved.file, resolved.args, {
        cwd,
        env: {
          ...process.env,
          ...colorEnv,
          // 让脚本/命令行工具尽量输出 UTF-8。
          PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
        },
        detached: process.platform !== "win32",
        windowsHide: true,
        // 交互式会话使用 cmd 包装 PowerShell，命令串内部带引号；
        // 交给 cmd 原样解析，避免 Node 把引号转义成 \"。
        windowsVerbatimArguments: resolved.windowsVerbatimArguments || (interactive && process.platform === "win32"),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error: any) {
      throw new Error(`无法启动命令：${error?.message || String(error)}`);
    }

    const task: TerminalTask = {
      id,
      command,
      cwd,
      pid: child.pid,
      shell: resolved.label,
      profileId: profile?.id,
      shellPath: profile?.file,
      startedAt,
      status: "running",
      interactive,
      output: "",
      pending: "",
      pendingStream: "stdout",
      truncated: false,
      child,
      stopRequested: false,
      finished: false,
    };
    this.tasks.set(id, task);
    this.prune();
    this.emit({ type: "start", task: this.info(task) });

    // 一次性任务不读取 stdin，立即关闭以便依赖 EOF 的命令正常结束；
    // 交互式会话则保持管道打开。错误事件在进程退出时很常见，静默忽略。
    child.stdin?.on("error", () => {});
    if (!interactive) child.stdin?.end();
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.append(task, "stdout", chunk));
    child.stderr?.on("data", (chunk: string) => this.append(task, "stderr", chunk));
    child.on("error", (error: Error) => {
      task.spawnError = error.message;
      log.error("terminal", `进程错误：${error.message}`);
      this.append(task, "stderr", `\n[进程错误] ${error.message}\n`);
      this.finish(task, null, null);
    });
    child.on("close", (code, signal) => {
      // 只记退出码与信号，不记命令内容（可能带 token）
      if (!task.pty) log.info("terminal", `任务结束 code=${code ?? "-"} signal=${signal ?? "-"}`);
      this.finish(task, code, signal);
    });
    return this.info(task);
  }

  start(cwd: string, command: string): TerminalTaskInfo {
    this.assertCanStart();
    const text = String(command ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("请输入要运行的命令");
    if (text.length > MAX_COMMAND_LENGTH) throw new Error("命令过长（最多 32000 个字符）");
    return this.spawnTask(cwd, resolveTerminalShell(text), text, false);
  }

  /** 一次性后台任务使用与新建终端一致的 shell 配置。 */
  async startWithProfile(cwd: string, command: string, options: TerminalPtyOptions = {}): Promise<TerminalTaskInfo> {
    this.assertCanStart();
    const text = String(command ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("请输入要运行的命令");
    if (text.length > MAX_COMMAND_LENGTH) throw new Error("命令过长（最多 32000 个字符）");
    this.pendingStarts += 1;
    try {
      const profile = await resolveTerminalProfile(options);
      if (this.disposed) throw new Error("终端宿主已经关闭");
      return this.spawnTask(cwd, commandForTerminalProfile(profile, text), text, false, profile);
    } finally {
      this.pendingStarts -= 1;
    }
  }

  /** 启动一个长驻 shell；后续通过 write() 逐行发送命令或 SQL。 */
  startShell(cwd: string): TerminalTaskInfo {
    this.assertCanStart();
    const resolved = resolveInteractiveShell();
    return this.spawnTask(cwd, resolved, `交互式 ${resolved.label}`, true);
  }

  /**
   * 启动真实 PTY 终端。
   *
   * node-pty 是可选加载的：原生模块缺失时只让新建终端失败，
   * 不影响应用启动和一次性命令。
   */
  async startPty(cwd: string, cols?: number, rows?: number, options: TerminalPtyOptions = {}): Promise<TerminalTaskInfo> {
    this.assertCanStart();
    // 加载原生模块期间也占一个名额，避免并行 IPC 绕过并发上限。
    this.pendingStarts += 1;
    try {
      const [module, profile] = await Promise.all([loadPtyModule(), resolveTerminalProfile(options)]);
      if (this.disposed) throw new Error("终端宿主已经关闭");
      return this.spawnPtyTask(module.spawn, cwd, normalizePtySize(cols, rows), profile);
    } finally {
      this.pendingStarts -= 1;
    }
  }

  private spawnPtyTask(
    spawnPty: typeof import("node-pty").spawn,
    cwd: string,
    size: { cols: number; rows: number },
    resolved: TerminalShellProfile,
  ): TerminalTaskInfo {
    const id = `term-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const startedAt = Date.now();
    const options: any = {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: ptyEnvironment(),
      useConpty: process.platform === "win32" ? true : undefined,
      useConptyDll: false,
    };
    let ptyProcess: IPty;
    try {
      // node-pty 会按 Windows 构建号自行选择 ConPTY / winpty；启动参数错误
      // 不能再尝试启动一次，以免失败的原生句柄或进程重复残留。
      ptyProcess = spawnPty(resolved.file, resolved.args, options);
    } catch (error: any) {
      throw new Error(`无法启动终端：${error?.message || String(error)}`);
    }

    const task: TerminalTask = {
      id,
      command: resolved.label,
      cwd,
      pid: ptyProcess.pid,
      shell: resolved.label,
      startedAt,
      status: "running",
      interactive: true,
      pty: true,
      profileId: resolved.id,
      shellPath: resolved.file,
      ptyProcess,
      cols: size.cols,
      rows: size.rows,
      output: "",
      pending: "",
      pendingStream: "stdout",
      truncated: false,
      stopRequested: false,
      finished: false,
    };
    this.tasks.set(id, task);
    this.prune();
    this.emit({ type: "start", task: this.info(task) });

    task.ptySubscriptions = [
      ptyProcess.onData((data: string) => this.append(task, "stdout", data)),
      ptyProcess.onExit(({ exitCode, signal }) => {
        this.finish(task, exitCode, signal == null ? null : String(signal));
      }),
    ];
    // node-pty 的 EventEmitter 错误不属于 IPty 稳定接口；有该接口时接住
    // 原生管道错误，避免启动失败把整个 Electron 主进程带崩。
    const emitter = ptyProcess as IPty & { on?: (name: string, listener: (error: Error) => void) => void };
    emitter.on?.("error", (error) => {
      if (task.finished) return;
      // POSIX PTY 的 read EIO 表示 slave 已关闭，是正常退出信号；
      // 等 node-pty 的 onExit 提供真实退出码，不要抢先标为启动失败。
      if (process.platform !== "win32" && (error as NodeJS.ErrnoException).code === "EIO") return;
      task.spawnError = error.message;
      this.append(task, "stderr", `\n[终端错误] ${error.message}\n`);
      try { if (!closeWindowsPty(ptyProcess)) ptyProcess.kill(); } catch { /* PTY 已关闭 */ }
      this.finish(task, null, null);
    });
    return this.info(task);
  }

  /** 向运行中的交互式会话写入一行输入；返回是否成功写入。 */
  write(id: string, input: string): boolean {
    const task = this.tasks.get(id);
    if (!task) throw new Error("终端任务不存在");
    if (!task.interactive) throw new Error("当前任务不是交互式会话");
    if (task.finished || task.status !== "running" || !task.child?.stdin?.writable) {
      throw new Error("交互式会话已经结束");
    }
    const text = String(input ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n");
    if (!text) return false;
    if (text.length > MAX_COMMAND_LENGTH) throw new Error("输入过长（最多 32000 个字符）");
    try {
      task.child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
      return true;
    } catch (error: any) {
      throw new Error(`写入交互式会话失败：${error?.message || String(error)}`);
    }
  }

  /** 向 PTY 原样写入键盘/粘贴数据；回车使用 \r。 */
  writePty(id: string, data: string, binary = false): boolean {
    const task = this.tasks.get(id);
    if (!task) throw new Error("终端任务不存在");
    if (!task.ptyProcess) throw new Error("当前任务不是 PTY 终端");
    if (task.finished || task.status !== "running") throw new Error("终端已经结束");
    const text = String(data ?? "");
    if (!text) return false;
    if (text.length > MAX_PTY_INPUT) throw new Error("终端输入过长（最多 256000 个字符）");
    try {
      // 保留 NUL、Ctrl+C 等控制字符；旧式鼠标报告使用字节而不是 UTF-8 编码。
      task.ptyProcess.write(binary ? Buffer.from(text, "latin1") : text);
      return true;
    } catch (error: any) {
      throw new Error(`写入终端失败：${error?.message || String(error)}`);
    }
  }

  /** 同步前端 xterm 的列/行数，保证全屏 TUI 排版和鼠标坐标正确。 */
  resizePty(id: string, cols: number, rows: number): boolean {
    const task = this.tasks.get(id);
    if (!task || !task.ptyProcess || task.finished) return false;
    const size = normalizePtySize(cols, rows);
    try {
      task.ptyProcess.resize(size.cols, size.rows);
      task.cols = size.cols;
      task.rows = size.rows;
      return true;
    } catch {
      return false;
    }
  }

  private append(task: TerminalTask, stream: "stdout" | "stderr", chunk: string): void {
    if (task.finished || !chunk) return;
    // 保留 ANSI，由渲染层安全解析颜色；这里只限制输出体积。
    const text = chunk;
    const next = task.output + text;
    if (next.length > this.maxOutput) task.truncated = true;
    task.output = trimOutput(next, this.maxOutput);
    if (task.pending && task.pendingStream !== stream) {
      // stdout/stderr 交替时先结算上一段，保证事件里的 stream 标记准确。
      this.flush(task, task.pendingStream);
    }
    task.pending += text;
    task.pendingStream = stream;
    if (!task.flushTimer) {
      task.flushTimer = setTimeout(() => {
        task.flushTimer = undefined;
        this.flush(task, task.pendingStream);
      }, 24);
      task.flushTimer.unref?.();
    }
  }

  private flush(task: TerminalTask, stream: "stdout" | "stderr" = "stdout"): void {
    if (!task.pending) return;
    let remaining = task.pending;
    task.pending = "";
    while (remaining) {
      const slice = remaining.slice(0, OUTPUT_BATCH_CHARS);
      remaining = remaining.slice(OUTPUT_BATCH_CHARS);
      this.emit({ type: "data", id: task.id, stream, text: slice });
    }
  }

  private clearTimers(task: TerminalTask): void {
    if (task.flushTimer) {
      clearTimeout(task.flushTimer);
      task.flushTimer = undefined;
    }
    if (task.killTimer) {
      clearTimeout(task.killTimer);
      task.killTimer = undefined;
    }
  }

  private finish(task: TerminalTask, code: number | null, signal: string | null): void {
    if (task.finished) return;
    task.finished = true;
    task.endedAt = Date.now();
    try { task.child?.stdin?.end(); } catch { /* 子进程可能已经关闭管道 */ }
    if (task.flushTimer) {
      clearTimeout(task.flushTimer);
      task.flushTimer = undefined;
    }
    this.flush(task, task.pendingStream);
    for (const subscription of task.ptySubscriptions ?? []) subscription.dispose();
    task.ptySubscriptions = undefined;
    if (task.ptyProcess) closeWindowsPty(task.ptyProcess);
    task.ptyProcess = undefined;
    const status: TerminalTaskStatus = task.stopRequested
      ? "stopped"
      : code === 0 && !task.spawnError
        ? "exited"
        : "failed";
    task.status = status;
    task.exitCode = code;
    task.signal = signal;
    if (task.killTimer) {
      clearTimeout(task.killTimer);
      task.killTimer = undefined;
    }
    this.emit({
      type: "exit",
      id: task.id,
      status,
      exitCode: code,
      signal,
      endedAt: task.endedAt,
    });
  }

  private async terminateTree(task: TerminalTask, force = false): Promise<void> {
    const child = task.child;
    const ptyProcess = task.ptyProcess;
    if ((!child && !ptyProcess) || !task.pid) return;
    const fallbackKill = (signal: NodeJS.Signals = "SIGTERM") => {
      if (ptyProcess) {
        try {
          if (!closeWindowsPty(ptyProcess)) ptyProcess.kill(process.platform === "win32" ? undefined : signal);
        } catch { /* PTY 可能已经退出 */ }
      }
      if (child) {
        try { child.kill(signal); } catch { /* 进程可能已经退出 */ }
      }
    };
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          fallbackKill();
          resolve();
        };
        try {
          const killer = spawn("taskkill.exe", ["/pid", String(task.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.once("error", finish);
          killer.once("close", finish);
          timer = setTimeout(finish, 3000);
          killer.unref?.();
        } catch {
          finish();
        }
      });
      return;
    }
    // PTY 的前台作业可能处于另一个进程组；仅 kill(-shellPid) 会留下
    // vim/Agent 的孙进程。先读取 PID/PPID 树，再一起清理（不用 shell）。
    const descendants = await new Promise<number[]>((resolve) => {
      execFile("ps", ["-ax", "-o", "pid=", "-o", "ppid="], { timeout: 1500, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) { resolve([]); return; }
        const records = String(stdout).split("\n").map((line) => line.trim().split(/\s+/).map(Number));
        const known = new Set<number>([task.pid]);
        const pending = [task.pid];
        const children: number[] = [];
        while (pending.length) {
          const parent = pending.shift();
          for (const [pid, ppid] of records) {
            if (ppid !== parent || !Number.isInteger(pid) || pid <= 1 || known.has(pid)) continue;
            known.add(pid);
            children.push(pid);
            pending.push(pid);
          }
        }
        resolve(children.reverse());
      });
    });
    if (task.finished) return;
    const signalTree = (signal: NodeJS.Signals) => {
      for (const pid of descendants) {
        try { process.kill(pid, signal); } catch { /* 子进程已退出 */ }
      }
      try { process.kill(-task.pid, signal); } catch { fallbackKill(signal); }
    };
    if (force) {
      signalTree("SIGKILL");
      return;
    }
    signalTree("SIGTERM");
    if (task.finished || this.disposed) return;
    task.killTimer = setTimeout(() => {
      task.killTimer = undefined;
      if (!task.finished) signalTree("SIGKILL");
    }, 2500);
    task.killTimer.unref?.();
  }

  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.finished || (!task.child && !task.ptyProcess)) return false;
    if (task.status === "stopping") return true;
    task.stopRequested = true;
    task.status = "stopping";
    this.emit({ type: "status", task: this.info(task) });
    void this.terminateTree(task, Boolean(task.pty));
    return true;
  }

  list(): TerminalTaskSnapshot[] {
    return [...this.tasks.values()].map((task) => ({
      ...this.info(task),
      output: task.output,
      truncated: task.truncated,
    }));
  }

  /** 窗口关闭/应用退出时清理全部子进程，避免留下后台开发服务器。 */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    const stopping: Promise<void>[] = [];
    for (const task of this.tasks.values()) {
      if (!task.finished && (task.child || task.ptyProcess)) {
        task.stopRequested = true;
        stopping.push(this.terminateTree(task, true));
      }
      this.clearTimers(task);
    }
    // 退出应用前等 taskkill / ps 真正完成，不能先 app.exit 留下子进程。
    this.disposePromise = Promise.allSettled(stopping).then(() => {});
    return this.disposePromise;
  }
}
