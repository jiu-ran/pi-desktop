import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * 桌面端后台任务宿主。
 *
 * 一次性命令每条独占一个子进程；交互式会话通过管道 stdin 保持一个 shell，
 * 可以连续执行命令并运行 mysql、python 等行式交互程序。
 * 这里仍未接入 PTY，因此不提供全屏 TUI（vim / top）和终端级 Ctrl+C。
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
const OUTPUT_BATCH_CHARS = 32 * 1024;

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

export class TerminalHost {
  private readonly emitEvent: (event: TerminalEvent) => void;
  private readonly maxTasks: number;
  private readonly maxOutput: number;
  private readonly tasks = new Map<string, TerminalTask>();
  private disposed = false;

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
    if (running >= this.maxTasks) {
      throw new Error(`同时运行的后台任务不能超过 ${this.maxTasks} 个，请先停止一个任务`);
    }
  }

  private spawnTask(
    cwd: string,
    resolved: ResolvedTerminalShell,
    command: string,
    interactive: boolean,
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
        windowsVerbatimArguments: interactive && process.platform === "win32",
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
      this.append(task, "stderr", `\n[进程错误] ${error.message}\n`);
      this.finish(task, null, null);
    });
    child.on("close", (code, signal) => this.finish(task, code, signal));
    return this.info(task);
  }

  start(cwd: string, command: string): TerminalTaskInfo {
    this.assertCanStart();
    const text = String(command ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("请输入要运行的命令");
    if (text.length > MAX_COMMAND_LENGTH) throw new Error("命令过长（最多 32000 个字符）");
    return this.spawnTask(cwd, resolveTerminalShell(text), text, false);
  }

  /** 启动一个长驻 shell；后续通过 write() 逐行发送命令或 SQL。 */
  startShell(cwd: string): TerminalTaskInfo {
    this.assertCanStart();
    const resolved = resolveInteractiveShell();
    return this.spawnTask(cwd, resolved, `交互式 ${resolved.label}`, true);
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

  private terminateTree(task: TerminalTask, force = false): void {
    const child = task.child;
    if (!child || !task.pid) return;
    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill.exe", ["/pid", String(task.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => {
          try { child.kill(); } catch { /* 进程可能已经退出 */ }
        });
        killer.unref?.();
      } catch {
        try { child.kill(); } catch { /* 进程可能已经退出 */ }
      }
      return;
    }
    if (force) {
      try {
        process.kill(-task.pid, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* 进程可能已经退出 */ }
      }
      return;
    }
    try {
      // detached 启动后子进程是进程组组长，负 PID 可以连带清理 npm/vite 等孙进程。
      process.kill(-task.pid, "SIGTERM");
    } catch {
      try { child.kill("SIGTERM"); } catch { /* 进程可能已经退出 */ }
    }
    task.killTimer = setTimeout(() => {
      task.killTimer = undefined;
      if (task.finished || !task.pid) return;
      try {
        process.kill(-task.pid, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* 进程可能已经退出 */ }
      }
    }, 2500);
    task.killTimer.unref?.();
  }

  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.finished || !task.child) return false;
    if (task.status === "stopping") return true;
    task.stopRequested = true;
    task.status = "stopping";
    this.emit({ type: "status", task: this.info(task) });
    this.terminateTree(task);
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
  dispose(): void {
    if (this.disposed) return;
    for (const task of this.tasks.values()) {
      if (!task.finished && task.child) {
        task.stopRequested = true;
        this.terminateTree(task, true);
      }
      this.clearTimers(task);
    }
    this.disposed = true;
  }
}
