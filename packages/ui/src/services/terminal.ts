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
const OUTPUT_MAX = 500_000;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 640;

export interface TerminalTask extends TerminalTaskInfo {
  output: string;
  truncated: boolean;
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

const ANSI = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-_]/g;

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

function loadHeight(): number {
  const value = Number(storageGet(HEIGHT_KEY));
  if (!Number.isFinite(value) || value <= 0) return 280;
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(value)));
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
    const clean = String(text).replace(ANSI, "");
    if (!clean) return;
    const next = task.output + clean;
    if (next.length > OUTPUT_MAX) {
      task.output = next.slice(-OUTPUT_MAX);
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
    const next = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(Number(value) || 0)));
    state.height = next;
    storageSet(HEIGHT_KEY, String(next));
  }

  function remember(command: string): void {
    state.history = [command, ...state.history.filter((item) => item !== command)].slice(0, HISTORY_MAX);
    state.historyIndex = -1;
    storageSet(HISTORY_KEY, JSON.stringify(state.history));
  }

  function historyUp(): void {
    if (!state.history.length) return;
    const next = Math.min(state.history.length - 1, state.historyIndex + 1);
    state.historyIndex = next;
    state.input = state.history[next] || "";
  }

  function historyDown(): void {
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
    if (state.tasks.some((task) => task.id === id)) state.activeId = id;
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
    state,
    runningCount,
    activeTask,
    sortedTasks,
    setHeight,
    historyUp,
    historyDown,
    run,
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
