import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * 桌面端后台任务宿主。
 *
 * 这里刻意不实现 PTY：面板用于运行开发服务器、构建、测试、Git 等非交互命令，
 * 每条命令独占一个子进程，支持查看输出、退出码和终止进程树。
 * 交互式程序（需要 stdin）不在当前范围内，避免把半成品终端伪装成完整 shell。
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

/** 去掉常见 ANSI 颜色/光标控制序列，避免 `<pre>` 里出现乱码。 */
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

  start(cwd: string, command: string): TerminalTaskInfo {
    if (this.disposed) throw new Error("终端宿主已经关闭");
    const text = String(command ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("请输入要运行的命令");
    if (text.length > MAX_COMMAND_LENGTH) throw new Error("命令过长（最多 32000 个字符）");

    const running = [...this.tasks.values()].filter(
      (task) => task.status === "running" || task.status === "stopping",
    ).length;
    if (running >= this.maxTasks) {
      throw new Error(`同时运行的后台任务不能超过 ${this.maxTasks} 个，请先停止一个任务`);
    }

    const resolved = resolveTerminalShell(text);
    const id = `term-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(resolved.file, resolved.args, {
        cwd,
        env: {
          ...process.env,
          // 让脚本/命令行工具尽量输出 UTF-8；不设置 FORCE_COLOR，是否着色由程序自己决定。
          PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
        },
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: any) {
      throw new Error(`无法启动命令：${error?.message || String(error)}`);
    }

    const task: TerminalTask = {
      id,
      command: text,
      cwd,
      pid: child.pid,
      shell: resolved.label,
      startedAt,
      status: "running",
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

  private append(task: TerminalTask, stream: "stdout" | "stderr", chunk: string): void {
    if (task.finished || !chunk) return;
    const text = stripTerminalAnsi(chunk);
    if (!text) return;
    task.output += text;
    if (task.output.length > this.maxOutput) {
      task.output = task.output.slice(-this.maxOutput);
      task.truncated = true;
    }
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
