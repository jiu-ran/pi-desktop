import { computed, reactive } from "vue";
import type { TerminalEvent, TerminalTaskInfo, TerminalTaskSnapshot, TerminalTaskStatus } from "../env.d.ts";
import { pushToast } from "./extension-ui.ts";

/**
 * 终端/后台任务控制器。
 *
 * 任务由 Electron 主进程托管，渲染层只保留展示所需的尾部输出；
 * 这样切换项目、关闭面板或重载页面都不会影响已经启动的命令。
 */

const HEIGHT_KEY = "pi-desktop:terminal:height";
const HISTORY_KEY = "pi-desktop:terminal:history";
const HISTORY_MAX = 50;
const INPUT_MAX = 32_000;
const OUTPUT_MAX = 500_000;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 640;
/** 终端最多占窗口高度的一半多一点，给对话区保留可用空间 */
const HEIGHT_VIEWPORT_RATIO = 0.55;

export interface TerminalTask extends TerminalTaskInfo {
  output: string;
  truncated: boolean;
  /** 当前会话内发送过的输入，只保存在内存，不写入 localStorage。 */
  inputs: string[];
  inputIndex: number;
  interactive: boolean;
}

export interface TerminalState {
  open: boolean;
  height: number;
  tasks: TerminalTask[];
  activeId: string;
  input: string;
  history: string[];
  historyIndex: number;
  starting: boolean;
  now: number;
}

function storageGet(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式或存储配额不足时静默失败，不影响命令运行。
  }
}

function maxHeight(): number {
  const viewport = typeof window !== "undefined" ? window.innerHeight : 0;
  if (!viewport) return HEIGHT_MAX;
  return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.floor(viewport * HEIGHT_VIEWPORT_RATIO)));
}

function clampHeight(value: number): number {
  return Math.min(maxHeight(), Math.max(HEIGHT_MIN, Math.round(value)));
}

function loadHeight(): number {
  const value = Number(storageGet(HEIGHT_KEY));
  if (!Number.isFinite(value) || value <= 0) return clampHeight(280);
  return clampHeight(value);
}

function loadHistory(): string[] {
  try {
    const parsed = JSON.parse(storageGet(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export function formatTerminalDuration(ms: number): string {
  const safe = Math.max(0, Number(ms) || 0);
  if (safe < 1000) return "0s";
  const total = Math.floor(safe / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export const TERMINAL_STATUS_LABEL: Record<TerminalTaskStatus, string> = {
  running: "运行中",
  stopping: "停止中",
  exited: "已完成",
  failed: "失败",
  stopped: "已停止",
};

export function createTerminalService({
  host,
  getCwd,
}: {
  host?: any;
  getCwd: () => string;
}) {
  const available = Boolean(host?.startTerminal && host?.onTerminalEvent);
  const supportsShell = Boolean(host?.startTerminalShell && host?.writeTerminal);
  const state = reactive<TerminalState>({
    open: false,
    height: loadHeight(),
    tasks: [],
    activeId: "",
    input: "",
    history: loadHistory(),
    historyIndex: -1,
    starting: false,
    now: Date.now(),
  });

  const runningCount = computed(
    () => state.tasks.filter((task) => task.status === "running" || task.status === "stopping").length,
  );
  const activeTask = computed(
    () => state.tasks.find((task) => task.id === state.activeId) || state.tasks.at(-1) || null,
  );
  const sortedTasks = computed(() => [...state.tasks].sort((a, b) => b.startedAt - a.startedAt));

  let disposed = false;
  const timer = setInterval(() => {
    if (!disposed) state.now = Date.now();
  }, 1000);

  function notify(message: string, level: "info" | "warning" | "error" = "info"): void {
    pushToast(level, message);
  }

  function report(error: unknown): void {
    pushToast("error", (error as any)?.message || String(error));
  }

  function append(task: TerminalTask, text: string): void {
    if (!text) return;
    // 保留 ANSI，颜色由渲染层解析；复制时再转成纯文本。
    const next = task.output + String(text);
    if (next.length > OUTPUT_MAX) {
      let sliced = next.slice(-OUTPUT_MAX);
      const newline = sliced.indexOf("\n");
      if (newline >= 0 && newline < 8192) sliced = sliced.slice(newline + 1);
      task.output = sliced;
      task.truncated = true;
    } else {
      task.output = next;
    }
  }

  function taskFrom(info: TerminalTaskInfo, output = "", truncated = false): TerminalTask {
    return {
      id: info.id,
      command: info.command,
      cwd: info.cwd,
      pid: info.pid,
      shell: info.shell,
      startedAt: info.startedAt,
      endedAt: info.endedAt,
      status: info.status,
      exitCode: info.exitCode,
      signal: info.signal,
      interactive: Boolean(info.interactive),
      inputs: [],
      inputIndex: -1,
      output,
      truncated,
    };
  }

  function applyInfo(task: TerminalTask, info: TerminalTaskInfo): void {
    // `startTerminal` 的响应可能晚于极短命令的 exit 事件到达；
    // 不能让迟到的 running 快照把已经结束的任务改回运行中。
    if (
      (task.status === "exited" || task.status === "failed" || task.status === "stopped")
      && (info.status === "running" || info.status === "stopping")
    ) return;
    task.command = info.command;
    task.cwd = info.cwd;
    task.pid = info.pid;
    task.shell = info.shell;
    task.startedAt = info.startedAt;
    task.endedAt = info.endedAt;
    task.status = info.status;
    task.exitCode = info.exitCode;
    task.signal = info.signal;
    if (typeof info.interactive === "boolean") task.interactive = info.interactive;
  }

  function upsert(info: TerminalTaskInfo, snapshot?: TerminalTaskSnapshot): TerminalTask {
    let task = state.tasks.find((item) => item.id === info.id);
    if (!task) {
      task = taskFrom(info, snapshot?.output ?? "", snapshot?.truncated ?? false);
      state.tasks.push(task);
      if (state.tasks.length > 20) {
        const removable = state.tasks.find(
          (item) => item.status !== "running" && item.status !== "stopping",
        );
        if (removable) state.tasks.splice(state.tasks.indexOf(removable), 1);
      }
    } else {
      applyInfo(task, info);
      if (snapshot && !task.output) {
        task.output = snapshot.output;
        task.truncated = snapshot.truncated;
      }
    }
    return task;
  }

  function chooseActive(): void {
    if (state.activeId && state.tasks.some((task) => task.id === state.activeId)) return;
    const running = state.tasks.find((task) => task.status === "running" || task.status === "stopping");
    state.activeId = running?.id || state.tasks.at(-1)?.id || "";
  }

  async function syncSnapshot(id: string): Promise<void> {
    if (!available || typeof host.terminalTasks !== "function") return;
    try {
      const list = (await host.terminalTasks()) as TerminalTaskSnapshot[];
      const snapshot = Array.isArray(list) ? list.find((item) => item.id === id) : undefined;
      if (snapshot) upsert(snapshot, snapshot);
    } catch {
      // 主进程暂时不可用时保留当前状态，等 exit 事件或下次刷新。
    }
  }

  function onEvent(event: TerminalEvent): void {
    if (disposed || !event || typeof event !== "object") return;
    if (event.type === "start") {
      const task = upsert(event.task);
      if (!state.activeId || !state.tasks.some((item) => item.id === state.activeId)) {
        state.activeId = task.id;
      }
      return;
    }
    if (event.type === "data") {
      const task = state.tasks.find((item) => item.id === event.id);
      if (task) append(task, event.text);
      return;
    }
    if (event.type === "status") {
      const task = state.tasks.find((item) => item.id === event.task.id);
      if (task) applyInfo(task, event.task);
      return;
    }
    if (event.type === "exit") {
      const task = state.tasks.find((item) => item.id === event.id);
      if (!task) return;
      task.status = event.status;
      task.exitCode = event.exitCode;
      task.signal = event.signal;
      task.endedAt = event.endedAt;
      chooseActive();
    }
  }

  const offEvent = available ? host.onTerminalEvent(onEvent) : () => {};

  // 开发模式热重载 / 窗口刷新后接回主进程仍在运行的任务。
  void (async () => {
    if (!available || typeof host.terminalTasks !== "function") return;
    try {
      const list = (await host.terminalTasks()) as TerminalTaskSnapshot[];
      if (!Array.isArray(list) || disposed) return;
      for (const snapshot of list) upsert(snapshot, snapshot);
      chooseActive();
    } catch {
      // 主进程刚启动或窗口正在销毁时不显示错误。
    }
  })();

  function setHeight(value: number): void {
    const next = clampHeight(Number(value) || 0);
    state.height = next;
    storageSet(HEIGHT_KEY, String(next));
  }

  function remember(command: string): void {
    state.history = [command, ...state.history.filter((item) => item !== command)].slice(0, HISTORY_MAX);
    state.historyIndex = -1;
    storageSet(HISTORY_KEY, JSON.stringify(state.history));
  }

  /** 交互会话历史只保存在内存：密码等敏感输入不会被写进 localStorage。 */
  function runningShell(): TerminalTask | null {
    const task = activeTask.value;
    return task?.interactive && (task.status === "running" || task.status === "stopping") ? task : null;
  }

  function rememberInput(task: TerminalTask, input: string, secret: boolean): void {
    if (secret) return;
    task.inputs = [input, ...task.inputs.filter((item) => item !== input)].slice(0, HISTORY_MAX);
    task.inputIndex = -1;
  }

  /** 交互会话没有 PTY 回显，补一行淡色命令，避免输出里看不出执行过什么。 */
  function echoInput(task: TerminalTask, input: string): void {
    const nl = String.fromCharCode(10);
    const prefix = task.output && !task.output.endsWith(nl) ? nl : "";
    append(task, `${prefix}${String.fromCharCode(27)}[2m❯ ${input}${String.fromCharCode(27)}[0m${nl}`);
  }

  function historyUp(): void {
    const shell = runningShell();
    if (shell) {
      if (!shell.inputs.length) return;
      const next = Math.min(shell.inputs.length - 1, shell.inputIndex + 1);
      shell.inputIndex = next;
      state.input = shell.inputs[next] || "";
      return;
    }
    if (!state.history.length) return;
    const next = Math.min(state.history.length - 1, state.historyIndex + 1);
    state.historyIndex = next;
    state.input = state.history[next] || "";
  }

  function historyDown(): void {
    const shell = runningShell();
    if (shell) {
      const next = shell.inputIndex - 1;
      if (next < 0) {
        shell.inputIndex = -1;
        state.input = "";
        return;
      }
      shell.inputIndex = next;
      state.input = shell.inputs[next] || "";
      return;
    }
    if (!state.history.length) return;
    const next = state.historyIndex - 1;
    if (next < 0) {
      state.historyIndex = -1;
      state.input = "";
      return;
    }
    state.historyIndex = next;
    state.input = state.history[next] || "";
  }

  async function run(raw?: string): Promise<void> {
    const command = String(raw ?? state.input ?? "").trim();
    if (!command) return;
    if (!available) {
      report(new Error("终端功能仅在桌面端可用"));
      return;
    }
    const cwd = getCwd();
    if (!cwd) {
      notify("请先打开一个项目目录", "warning");
      return;
    }
    state.starting = true;
    try {
      const info = (await host.startTerminal(cwd, command)) as TerminalTaskInfo;
      const task = upsert(info);
      state.activeId = task.id;
      state.open = true;
      state.input = "";
      state.historyIndex = -1;
      remember(command);
    } catch (error) {
      report(error);
    } finally {
      state.starting = false;
    }
  }

  /** 新建一个长驻 shell；支持连续执行命令以及 mysql / python 等行式交互程序。 */
  async function startShell(): Promise<void> {
    if (state.starting) return;
    if (!supportsShell) {
      report(new Error("当前版本不支持交互式会话"));
      return;
    }
    const cwd = getCwd();
    if (!cwd) {
      notify("请先打开一个项目目录", "warning");
      return;
    }
    state.starting = true;
    try {
      const info = (await host.startTerminalShell(cwd)) as TerminalTaskInfo;
      const task = upsert(info);
      state.activeId = task.id;
      state.open = true;
      state.historyIndex = -1;
    } catch (error) {
      report(error);
    } finally {
      state.starting = false;
    }
  }

  /** 向当前交互会话发送一行输入；没有交互会话时回退为一次性命令。 */
  async function send(raw?: string, options?: { secret?: boolean }): Promise<void> {
    const task = activeTask.value;
    if (!task?.interactive) {
      await run(raw);
      return;
    }
    const text = String(raw ?? state.input ?? "");
    if (!text.trim()) return;
    if (text.length > INPUT_MAX) {
      notify("输入过长（最多 32000 个字符）", "warning");
      return;
    }
    if (!available || typeof host.writeTerminal !== "function") {
      report(new Error("当前版本不支持交互式会话"));
      return;
    }
    if (task.status !== "running") {
      notify("交互式会话已经结束，请新建会话", "warning");
      return;
    }
    state.starting = true;
    const hidden = Boolean(options?.secret);
    if (!hidden) echoInput(task, text);
    try {
      await host.writeTerminal(task.id, text);
      // 发送期间用户可能已经开始输入下一条，只在草稿未被改动时清空。
      if (state.input === text) state.input = "";
      state.historyIndex = -1;
      task.inputIndex = -1;
      rememberInput(task, text, Boolean(options?.secret));
    } catch (error) {
      report(error);
    } finally {
      state.starting = false;
    }
  }

  async function stop(id = state.activeId): Promise<void> {
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.status !== "running") return;
    if (!available) return;
    task.status = "stopping";
    try {
      const ok = await host.stopTerminal(id);
      if (!ok) {
        // 主进程返回 false 表示进程已经结束，等待 exit 事件即可；
        // 若事件丢失，用一次快照把状态纠正回来。
        await syncSnapshot(id);
        if (task.status === "stopping") task.status = "running";
      }
    } catch (error) {
      task.status = "running";
      report(error);
    }
  }

  function clearOutput(id = state.activeId): void {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    task.output = "";
    task.truncated = false;
  }

  function clearFinished(): void {
    state.tasks = state.tasks.filter(
      (task) => task.status === "running" || task.status === "stopping",
    );
    chooseActive();
  }

  function select(id: string): void {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    state.activeId = id;
    state.historyIndex = -1;
    task.inputIndex = -1;
  }

  function show(): void {
    state.open = true;
  }

  function hide(): void {
    state.open = false;
  }

  function toggle(): void {
    state.open = !state.open;
  }

  function dispose(): void {
    disposed = true;
    clearInterval(timer);
    offEvent?.();
  }

  return {
    available,
    supportsShell,
    state,
    runningCount,
    activeTask,
    sortedTasks,
    setHeight,
    historyUp,
    historyDown,
    run,
    startShell,
    send,
    stop,
    clearOutput,
    clearFinished,
    select,
    show,
    hide,
    toggle,
    dispose,
  };
}

export type TerminalController = ReturnType<typeof createTerminalService>;
