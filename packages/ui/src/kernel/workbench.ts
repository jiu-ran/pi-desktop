import { computed, reactive, shallowReactive, toRaw } from "vue";
import { createTranscript, type TranscriptBlock } from "./transcript.ts";
import type { EventBus } from "./event-bus.ts";
import type {
  GitInspectResult,
  GitOverview,
  McpExposureMode,
  McpOverview,
  PiPackagesOverview,
  PiSkillsOverview,
  WorkspaceEntry,
  WorkspaceFileData,
} from "../env.d.ts";

const THEME_KEY = "pi-desktop.theme";
/** 每页加载的历史消息条数 */
const PAGE_SIZE = 8;
/** 首屏消息条数：8 条在长工具链会话中可能只够 1～2 条气泡，首屏多给一些上下文 */
const INITIAL_PAGE_SIZE = 40;
/** 首屏至少凑够多少轮用户对话 */
const INITIAL_MIN_TURNS = 3;
const SIDEBAR_WIDTH_KEY = "pi-desktop.sidebar-width";
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const PANEL_WIDTH_KEY = "pi-desktop.panel-width";
const PANEL_MIN_WIDTH = 290;
const PANEL_MAX_WIDTH = 640;
const EDITOR_WIDTH_KEY = "pi-desktop.editor-width";
const EDITOR_MIN_WIDTH = 240;
const EDITOR_MAX_WIDTH = 1000;

export interface SessionThreadState {
  sessionFile: string;
  sessionName: string;
  model: any;
  levels: string[];
  thinking: string;
  streaming: boolean;
  compacting: boolean;
  queue: { steering: string[]; followUp: string[] };
  usage: any;
  blocks: TranscriptBlock[];
  transcript: ReturnType<typeof createTranscript>;
  draft: string;
  attachments: any[];
  loaded: boolean;
  /** 当前已渲染的最早一条消息在会话历史中的下标；-1 表示未知（流式中或未就绪） */
  historyStart: number;
  /** 会话历史总条数（不含 system） */
  messageTotal: number;
  loadingMore: boolean;
}

export interface WorkspaceState {
  cwd: string;
  name: string;
  status: "idle" | "starting" | "ready" | "error";
  loading?: boolean;
  error: string;
  models: any[];
  branch: string;
  sessions: any[];
  commands: any[];
  sessionFile: string;
  threads: Record<string, SessionThreadState>;
  activeThread: SessionThreadState;
  model: any;
  levels: string[];
  thinking: string;
  streaming: boolean;
  compacting: boolean;
  sessionName: string;
  queue: { steering: string[]; followUp: string[] };
  usage: any;
  blocks: TranscriptBlock[];
  transcript: ReturnType<typeof createTranscript>;
  draft: string;
  attachments: any[];
  hasAnyRunning: boolean;
  runningSessionCount: number;
  getThread: (sessionFile?: string) => SessionThreadState | null;
  isSessionStreaming: (sessionFile: string) => boolean;
  isSessionCompacting: (sessionFile: string) => boolean;
}

function normalizeThreadKey(file = ""): string {
  return (file || "__default__").replace(/\\/g, "/").toLowerCase();
}

function savedWidth(key: string, min: number, max: number, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function savedSidebarWidth(): number {
  return savedWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, 272);
}

/** 传给 IPC 的参数必须是纯数据，Vue 响应式 Proxy 无法被结构化克隆。 */
function plainArgs(args: any[]): any[] {
  return JSON.parse(JSON.stringify(args.map((arg) => (arg && typeof arg === "object" ? toRaw(arg) : arg)) ?? []));
}

export function createWorkbench({ host, bus }: { host: any; bus: EventBus }) {
  const state = reactive({
    pi: {
      found: false,
      version: "",
      checked: false,
      path: "",
      latest: "",
      updateAvailable: false,
      checking: false,
      updating: false,
      lastUpdate: null as null | { from: string; to: string; at: number; log: string },
    },
    appUpdate: {
      current: "",
      latest: "",
      updateAvailable: false,
      url: "",
      assetName: "",
      phase: "idle" as "idle" | "checking" | "available" | "downloading" | "ready" | "installing",
      checking: false,
      checkedAt: 0,
    },
    recent: [] as string[],
    activeCwd: "",
    theme: localStorage.getItem(THEME_KEY) || "dark",
    sidebarOpen: true,
    sidebarWidth: savedSidebarWidth(),
    panelWidth: savedWidth(PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 320),
    stageWidth: savedWidth(EDITOR_WIDTH_KEY, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH, 520),
    activePanelId: "files",
    paletteOpen: false,
  });

  const workspaces = shallowReactive(new Map<string, WorkspaceState>());
  const sessionRefreshes = new WeakMap<WorkspaceState, { timer: number | null; running: Promise<void> | null; dirty: boolean; generation: number }>();
  const opens = new Map<string, Promise<WorkspaceState>>();
  let stopHostEvents: (() => void) | null = null;
  let initPromise: Promise<void> | null = null;
  let disposed = false;

  function makeThread(sessionFile = ""): SessionThreadState {
    const transcript = createTranscript(reactive as any);
    return reactive<SessionThreadState>({
      sessionFile,
      sessionName: "",
      model: null,
      levels: [],
      thinking: "off",
      streaming: false,
      compacting: false,
      queue: { steering: [], followUp: [] },
      usage: null,
      blocks: transcript.blocks,
      transcript,
      draft: "",
      attachments: [],
      loaded: false,
      historyStart: -1,
      messageTotal: 0,
      loadingMore: false,
    });
  }

  function ensureThread(ws: WorkspaceState, sessionFile = ""): SessionThreadState {
    const key = normalizeThreadKey(sessionFile);
    let thread = ws.threads[key];
    if (!thread) {
      thread = makeThread(sessionFile);
      ws.threads[key] = thread;
    } else if (sessionFile && !thread.sessionFile) {
      thread.sessionFile = sessionFile;
    }
    return thread;
  }

  function makeWorkspace(cwd: string): WorkspaceState {
    const defaultThread = makeThread("");
    const threads = reactive<Record<string, SessionThreadState>>({
      [normalizeThreadKey("")]: defaultThread,
    });

    const raw: any = {
      cwd,
      name: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
      status: "idle" as const,
      error: "",
      models: [] as any[],
      branch: "",
      sessions: [] as any[],
      commands: [] as any[],
      sessionFile: "",
      threads,
      get activeThread(): SessionThreadState {
        return ensureThread(this, this.sessionFile);
      },
      get model() {
        return this.activeThread.model;
      },
      set model(value: any) {
        this.activeThread.model = value;
      },
      get levels(): string[] {
        return this.activeThread.levels;
      },
      set levels(value: string[]) {
        this.activeThread.levels = value;
      },
      get thinking(): string {
        return this.activeThread.thinking;
      },
      set thinking(value: string) {
        this.activeThread.thinking = value;
      },
      get streaming(): boolean {
        return this.activeThread.streaming;
      },
      set streaming(value: boolean) {
        this.activeThread.streaming = value;
      },
      get compacting(): boolean {
        return this.activeThread.compacting;
      },
      set compacting(value: boolean) {
        this.activeThread.compacting = value;
      },
      get sessionName(): string {
        return this.activeThread.sessionName;
      },
      set sessionName(value: string) {
        this.activeThread.sessionName = value;
      },
      get queue() {
        return this.activeThread.queue;
      },
      set queue(value: { steering: string[]; followUp: string[] }) {
        this.activeThread.queue = value;
      },
      get usage() {
        return this.activeThread.usage;
      },
      set usage(value: any) {
        this.activeThread.usage = value;
      },
      get blocks(): TranscriptBlock[] {
        return this.activeThread.blocks;
      },
      get transcript() {
        return this.activeThread.transcript;
      },
      get draft(): string {
        return this.activeThread.draft;
      },
      set draft(value: string) {
        this.activeThread.draft = value;
      },
      get attachments(): any[] {
        return this.activeThread.attachments;
      },
      set attachments(value: any[]) {
        this.activeThread.attachments = value;
      },
      get runningSessionCount(): number {
        return Object.values(this.threads as Record<string, SessionThreadState>).filter(
          (t) => t.streaming || t.compacting,
        ).length;
      },
      get hasAnyRunning(): boolean {
        return this.runningSessionCount > 0;
      },
      getThread(sessionFile?: string): SessionThreadState | null {
        const key = normalizeThreadKey(sessionFile ?? this.sessionFile);
        return this.threads[key] ?? null;
      },
      isSessionStreaming(sessionFile: string): boolean {
        if (!sessionFile) return false;
        return Boolean(this.threads[normalizeThreadKey(sessionFile)]?.streaming);
      },
      isSessionCompacting(sessionFile: string): boolean {
        if (!sessionFile) return false;
        return Boolean(this.threads[normalizeThreadKey(sessionFile)]?.compacting);
      },
    };

    return reactive<WorkspaceState>(raw);
  }

  const active = computed<WorkspaceState | null>(() => workspaces.get(state.activeCwd) ?? null);

  function rpc(cwd: string, method: string, args: any[] = [], sessionFile?: string): Promise<any> {
    return host.call(cwd, method, plainArgs(args), sessionFile);
  }

  function applySnapshot(ws: WorkspaceState, snap: any): void {
    if (disposed || workspaces.get(ws.cwd) !== ws) return;
    const file = snap.state?.sessionFile ?? "";
    ws.models = snap.models ?? [];
    ws.sessions = snap.sessions ?? [];
    ws.commands = snap.commands ?? [];
    ws.branch = snap.branch ?? "";

    const workerFiles = new Set<string>();
    if (Array.isArray(snap.workerStates)) {
      for (const worker of snap.workerStates) {
        if (!worker?.sessionFile) continue;
        const wThread = ensureThread(ws, worker.sessionFile);
        wThread.streaming = Boolean(worker.streaming);
        wThread.compacting = Boolean(worker.compacting);
        workerFiles.add(normalizeThreadKey(worker.sessionFile));
      }
    }
    for (const [key, thread] of Object.entries(ws.threads as Record<string, SessionThreadState>)) {
      if (key !== normalizeThreadKey(file) && !workerFiles.has(key)) {
        thread.streaming = false;
        thread.compacting = false;
      }
    }

    const thread = ensureThread(ws, file);
    thread.sessionFile = file;
    thread.sessionName = snap.state?.sessionName ?? thread.sessionName ?? "";
    thread.model = snap.state?.model ?? thread.model ?? null;
    thread.thinking = snap.state?.thinkingLevel ?? thread.thinking ?? "off";
    thread.levels = snap.levels ?? thread.levels ?? [];
    thread.streaming = Boolean(snap.state?.isStreaming);
    thread.compacting = Boolean(snap.state?.isCompacting);

    const initial = !thread.loaded;
    if (initial) {
      thread.transcript.loadMessages(snap.messages ?? []);
      thread.loaded = true;
    }
    // 仅在空闲时从会话文件补齐；流式中的内容由事件增量维护
    if (!thread.streaming && !snap.state?.isStreaming) void hydrateHistory(ws, thread, initial);

    ws.sessionFile = file;
  }

  /**
   * 用会话文件补齐历史：首屏至少加载 40 条消息且覆盖 3 轮对话，
   * 已向上翻过页的会话则重新加载「已渲染窗口」，保持滚动与分页进度不变。
   */
  async function hydrateHistory(ws: WorkspaceState, thread: SessionThreadState, initial = false): Promise<void> {
    const file = thread.sessionFile;
    if (!file) {
      thread.historyStart = 0;
      thread.messageTotal = thread.blocks.length;
      return;
    }
    if (thread.streaming) return;
    const loaded = thread.historyStart >= 0 && thread.messageTotal > thread.historyStart
      ? thread.messageTotal - thread.historyStart
      : 0;
    // 首屏多加载一些：8 条消息在长工具链会话里可能只够一轮对话；
    // 之后再向上翻页时仍按 8 条一页。
    const limit = initial ? INITIAL_PAGE_SIZE : Math.max(PAGE_SIZE, loaded + PAGE_SIZE);
    try {
      const page = await host.messagePage(ws.cwd, file, 0, limit, initial ? INITIAL_MIN_TURNS : 0);
      if (disposed || workspaces.get(ws.cwd) !== ws) return;
      if (thread.sessionFile !== file || thread.streaming) return;
      if (page.total === 0) {
        // 文件里还没有落盘消息（刚新建的会话），保留内存里的消息
        thread.historyStart = 0;
        thread.messageTotal = thread.blocks.length;
        return;
      }
      // 非首次加载且内容没变：不重绘，避免用户上翻阅读时被拉回底部
      if (!initial && thread.historyStart >= 0 && page.total === thread.messageTotal) return;
      thread.transcript.loadMessages(page.messages);
      thread.historyStart = page.startIndex;
      thread.messageTotal = page.total;
      thread.loaded = true;
    } catch {
      // 会话文件读不到时保留 getMessages() 的结果，不阻断会话打开
      if (thread.historyStart < 0) {
        thread.historyStart = 0;
        thread.messageTotal = thread.blocks.length;
      }
    }
  }

  async function init(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!host || disposed) {
        state.pi = { ...state.pi, found: false, version: "", path: "", checked: true };
        bus.emit("pi:located", { ...state.pi });
        return;
      }
      stopHostEvents?.();
      stopHostEvents = host.onEvent(({ cwd, sessionFile, event }: { cwd: string; sessionFile?: string; event: any }) => {
        if (disposed) return;
        const ws = workspaces.get(cwd);
        if (!ws) return;
        const targetFile = sessionFile || ws.sessionFile;
        const thread = ensureThread(ws, targetFile);
        routeEvent(ws, thread, event);
        bus.emit("pi:event", { cwd, sessionFile: targetFile, event, workspace: ws, thread });
      });
      const [pi, recent] = await Promise.all([
        host.locate().catch(() => ({ found: false, version: "", path: "" })),
        host.recent().catch(() => [] as string[]),
      ]);
      if (disposed) return;
      state.pi = {
        ...state.pi,
        found: Boolean(pi.found),
        version: pi.version ?? "",
        path: pi.path ?? "",
        checked: true,
      };
      bus.emit("pi:located", { ...state.pi });
      state.recent = recent;
      if (pi.found && recent[0]) await open(recent[0]);
    })();
    try {
      await initPromise;
    } finally {
      initPromise = null;
    }
  }

  function formatUsage(usage: any): string {
  const input = Number(usage?.input ?? 0);
  const output = Number(usage?.output ?? 0);
  const cacheRead = Number(usage?.cacheRead ?? usage?.cache_read ?? 0);
  const cacheWrite = Number(usage?.cacheWrite ?? usage?.cache_write ?? 0);
  const total = Number(usage?.totalTokens ?? usage?.total ?? input + output + cacheRead + cacheWrite);
  return `Token：总计 ${total} · 输入 ${input} · 输出 ${output} · 缓存读取 ${cacheRead} · 缓存写入 ${cacheWrite}`;
}

function appendUsage(thread: SessionThreadState): void {
  if (!thread.usage) return;
  thread.transcript.attachUsage(formatUsage(thread.usage));
  thread.usage = null;
}

function routeEvent(ws: WorkspaceState, thread: SessionThreadState, event: any): void {
    thread.transcript.applyEvent(event);
    thread.loaded = true;
    switch (event.type) {
      case "agent_start":
        thread.streaming = true;
        scheduleSessionsRefresh(ws);
        break;
      case "agent_settled":
        thread.streaming = false;
        thread.queue = { steering: [], followUp: [] };
        appendUsage(thread);
        scheduleSessionsRefresh(ws);
        break;
      case "queue_update":
        thread.queue = { steering: event.steering ?? [], followUp: event.followUp ?? [] };
        break;
      case "message_update":
        if (event.usage) thread.usage = event.usage;
        break;
      case "compaction_start":
        thread.compacting = true;
        break;
      case "compaction_end":
        thread.compacting = false;
        break;
      case "thinking_level_changed":
        thread.thinking = event.level;
        break;
      case "session_info_changed":
        thread.sessionName = event.name ?? "";
        scheduleSessionsRefresh(ws);
        break;
      default:
        break;
    }
  }

  async function open(cwd: string): Promise<WorkspaceState> {
    let ws = workspaces.get(cwd);
    const switched = state.activeCwd !== cwd;
    state.activeCwd = cwd;
    if (switched) bus.emit("workspace:switched", { cwd });
    if (ws?.status === "ready") return ws;
    const pending = opens.get(cwd);
    if (pending) return pending;
    if (!ws) {
      ws = makeWorkspace(cwd);
      workspaces.set(cwd, ws);
    }
    ws.status = "starting";
    ws.error = "";
    const task = (async () => {
      try {
        const snap = await host.open(cwd);
        if (disposed) return ws!;
        applySnapshot(ws!, snap);
        ws!.status = "ready";
        state.recent = await host.recent();
        bus.emit("workspace:opened", ws);
      } catch (error: any) {
        ws!.status = "error";
        ws!.error = error?.message ?? String(error);
      } finally {
        opens.delete(cwd);
      }
      return ws!;
    })();
    opens.set(cwd, task);
    return task;
  }

  async function chooseAndOpen(): Promise<void> {
    const cwd = await host.chooseDirectory();
    if (cwd) await open(cwd);
  }

  async function listDirectory(relative = ""): Promise<WorkspaceEntry[]> {
    const ws = active.value;
    if (!ws) return [];
    return host.listDirectory(ws.cwd, relative);
  }

  async function readWorkspaceFile(relative: string): Promise<WorkspaceFileData> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    return host.readWorkspaceFile(ws.cwd, relative);
  }

  async function writeWorkspaceFile(relative: string, content: string): Promise<WorkspaceFileData> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    return host.writeWorkspaceFile(ws.cwd, relative, content);
  }

  async function openWorkspacePath(relative: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    const error = await host.openWorkspacePath(ws.cwd, relative);
    if (error) throw new Error(error);
  }

  async function createEntry(parent: string, name: string, kind: "file" | "folder"): Promise<WorkspaceEntry> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    return host.createWorkspaceEntry(ws.cwd, parent, name, kind);
  }

  async function renameEntry(relative: string, name: string): Promise<WorkspaceEntry> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    return host.renameWorkspaceEntry(ws.cwd, relative, name);
  }

  async function deleteEntry(relative: string): Promise<void> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    await host.deleteWorkspaceEntry(ws.cwd, relative);
  }

  async function gitOverview(): Promise<GitOverview> {
    const ws = active.value;
    if (!ws || !host?.gitOverview) return { isRepo: false, branch: "", status: [], commits: [] };
    return host.gitOverview(ws.cwd);
  }

  async function gitInspect(kind: "commit" | "working", target: string): Promise<GitInspectResult> {
    const ws = active.value;
    if (!ws || !host?.gitInspect) throw new Error("没有打开的工作区");
    return host.gitInspect(ws.cwd, kind, target);
  }

  async function completePaths(query = ""): Promise<WorkspaceEntry[]> {
    const ws = active.value;
    if (!ws) return [];
    return host.completePaths(ws.cwd, query);
  }

  async function addFiles(paths: string[] = []): Promise<void> {
    const ws = active.value;
    if (!ws || !paths.length) return;
    const prepared = await host.prepareAttachments(ws.cwd, paths, paths);
    const known = new Set(ws.attachments.map((item: any) => item.path));
    ws.attachments.push(...prepared.items.filter((item: any) => !known.has(item.path)));
  }

  /** 粘贴剪贴板图片：主进程落盘到临时目录后作为普通附件加入 */
  async function addPastedImage(payload: { name?: string; mimeType?: string; data: string }): Promise<void> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    if (!host?.savePastedImage) throw new Error("当前环境不支持粘贴图片");
    const file = await host.savePastedImage(payload);
    if (!file) throw new Error("剪贴板图片保存失败");
    await addFiles([file]);
  }

  function extractDroppedPaths(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) return [];
    const collected: string[] = [];

    // 1. 支持从工作台内部（如 4 区域项目文件树）拖拽文件或文件夹节点
    const internalRaw = dataTransfer.getData("application/x-pi-paths");
    if (internalRaw) {
      try {
        const parsed = JSON.parse(internalRaw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string" && item.trim()) collected.push(item.trim());
          }
        }
      } catch {
        // ignore invalid payload
      }
    }

    // 2. 支持从操作系统文件管理器（Explorer / Finder）拖拽文件或文件夹
    if (dataTransfer.files?.length) {
      const external: string[] = [];
      for (const file of Array.from(dataTransfer.files)) {
        const resolved = host?.getPathForFile?.(file) || (file as any)?.path || "";
        if (typeof resolved === "string" && resolved.trim()) external.push(resolved.trim());
      }
      collected.push(...external);
    }

    return [...new Set(collected)];
  }

  async function chooseFiles(): Promise<void> {
    await addFiles((await host.chooseFiles()) ?? []);
  }

  async function chooseFolder(): Promise<void> {
    const folder = await host.chooseFolder();
    if (folder) await addFiles([folder]);
  }

  function removeAttachment(file: string): void {
    const ws = active.value;
    if (ws) ws.attachments = ws.attachments.filter((item: any) => item.path !== file);
  }

  async function forget(cwd: string): Promise<void> {
    state.recent = await host.forget(cwd);
  }

  async function removeProject(cwd: string, { deleteSessions = false }: { deleteSessions?: boolean } = {}): Promise<any> {
    const ws = workspaces.get(cwd);
    if (ws?.hasAnyRunning) throw new Error("该项目有任务正在运行，请先停止");
    const result = await host.removeProject(cwd, { deleteSessions });
    workspaces.delete(cwd);
    state.recent = result.recent;
    if (state.activeCwd === cwd) {
      const next = [...workspaces.keys()][0] ?? "";
      state.activeCwd = next;
      bus.emit("workspace:switched", { cwd: next });
    }
    bus.emit("workspace:removed", { cwd });
    return result;
  }

  function reveal(target: string): Promise<void> {
    return host.reveal(target);
  }

  async function deleteSession(cwd: string, file: string): Promise<any[]> {
    const ws = workspaces.get(cwd);
    const sessions = await host.deleteSession(cwd, file);
    if (ws) {
      delete ws.threads[normalizeThreadKey(file)];
      if (ws.status === "ready") {
        if (normalizeThreadKey(file) === normalizeThreadKey(ws.sessionFile)) {
          await reload(ws);
        } else {
          ws.sessions = sessions;
        }
      }
    }
    bus.emit("session:deleted", { cwd, file });
    return sessions;
  }

  async function reload(ws: WorkspaceState | null = active.value, sessionFile?: string): Promise<void> {
    if (!ws) return;
    applySnapshot(ws, await host.snapshot(ws.cwd, sessionFile));
  }

  async function restart(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws || ws.streaming) return;
    ws.status = "starting";
    try {
      applySnapshot(ws, await host.restart(ws.cwd, ws.sessionFile));
      ws.status = "ready";
    } catch (error: any) {
      ws.status = "error";
      ws.error = error?.message ?? String(error);
    }
  }

  function setSidebarWidth(value: number, persist = true): number {
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.sidebarWidth;
    state.sidebarWidth = Math.round(width);
    if (persist) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    return state.sidebarWidth;
  }

  function setPanelWidth(value: number, persist = true): number {
    const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.panelWidth;
    state.panelWidth = Math.round(width);
    if (persist) localStorage.setItem(PANEL_WIDTH_KEY, String(state.panelWidth));
    return state.panelWidth;
  }

  function setStageWidth(value: number, persist = true): number {
    const width = Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.stageWidth;
    state.stageWidth = Math.round(width);
    if (persist) localStorage.setItem(EDITOR_WIDTH_KEY, String(state.stageWidth));
    return state.stageWidth;
  }

  function togglePanel(id: string): void {
    state.activePanelId = state.activePanelId === id ? "" : id;
  }

  function closePanel(id?: string): void {
    if (!id || state.activePanelId === id) {
      state.activePanelId = "";
    }
  }

  function notice(level: string, text: string): void {
    active.value?.transcript.pushNotice(level, text);
  }

  async function renameSession(name: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setSessionName", [name], ws.sessionFile);
    ws.sessionName = name;
    await refreshSessions(ws);
  }

  async function refreshSessions(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws || disposed || workspaces.get(ws.cwd) !== ws) return;
    const previous = sessionRefreshes.get(ws) ?? { timer: null, running: null, dirty: false, generation: 0 };
    const generation = ++previous.generation;
    sessionRefreshes.set(ws, previous);
    if (previous.running) {
      previous.dirty = true;
      await previous.running;
      return;
    }
    const request = host.sessions(ws.cwd).then((sessions) => {
      if (!disposed && generation === previous.generation && workspaces.get(ws.cwd) === ws) ws.sessions = sessions;
    }).catch(() => {
      // Session refresh is advisory; the active transcript remains usable when the host is unavailable.
    }).finally(() => {
      previous.running = null;
      if (!disposed && previous.dirty && workspaces.get(ws.cwd) === ws) {
        previous.dirty = false;
        scheduleSessionsRefresh(ws);
      } else if (disposed) {
        previous.dirty = false;
      }
    });
    previous.running = request;
    await request;
  }

  function scheduleSessionsRefresh(ws: WorkspaceState): void {
    if (disposed || workspaces.get(ws.cwd) !== ws) return;
    const previous = sessionRefreshes.get(ws) ?? { timer: null, running: null, dirty: false, generation: 0 };
    sessionRefreshes.set(ws, previous);
    previous.dirty = true;
    if (previous.timer !== null || previous.running) return;
    const schedule = typeof window !== "undefined" ? window.setTimeout : setTimeout;
    previous.timer = schedule(() => {
      previous.timer = null;
      if (disposed || workspaces.get(ws.cwd) !== ws || !previous.dirty) return;
      previous.dirty = false;
      void refreshSessions(ws);
    }, 0) as unknown as number;
  }

  function listSessions(cwd: string): Promise<any[]> {
    const ws = workspaces.get(cwd);
    if (ws?.status === "ready") return Promise.resolve(ws.sessions);
    return host.sessions(cwd);
  }

  async function openSession(cwd: string, file: string): Promise<void> {
    const ws = await open(cwd);
    if (file && ws?.status === "ready") await switchSession(file);
  }

  /** 向上加载一页更早的历史消息（同时写入 transcript） */
  async function loadMoreMessages(
    cwd: string,
    sessionFile: string,
    limit: number = PAGE_SIZE,
  ): Promise<{ loaded: number; startIndex: number; total: number }> {
    const ws = workspaces.get(cwd);
    const thread = ws ? ensureThread(ws, sessionFile) : null;
    if (!thread || thread.loadingMore || thread.historyStart <= 0) {
      return { loaded: 0, startIndex: thread?.historyStart ?? 0, total: thread?.messageTotal ?? 0 };
    }
    thread.loadingMore = true;
    try {
      const page = await host.messagePage(cwd, sessionFile, thread.historyStart, limit);
      if (page.messages.length > 0) {
        thread.transcript.prependMessages(page.messages);
        thread.historyStart = page.startIndex;
      }
      thread.messageTotal = page.total;
      return { loaded: page.messages.length, startIndex: page.startIndex, total: page.total };
    } finally {
      thread.loadingMore = false;
    }
  }

  function call(method: string, ...args: any[]): Promise<any> {
    const ws = active.value;
    if (!ws) return Promise.reject(new Error("没有打开的工作区"));
    return rpc(ws.cwd, method, args, ws.sessionFile);
  }

  const pendingNewSessions = new Map<string, Promise<void>>();

  async function send(text: string, { mode }: { mode?: string } = {}): Promise<void> {
    const ws = active.value;
    const message = text.trim();
    if (!ws || (!message && !ws.attachments.length)) return;
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    const attachmentSnapshot = [...thread.attachments];
    const behavior = thread.streaming ? (mode ?? "followUp") : undefined;
    if (!behavior) {
      const imageItems = attachmentSnapshot
        .filter((item: any) => item.image && item.data)
        .map((item: any) => ({ mimeType: String(item.mimeType ?? "image/png"), data: item.data as string }));
      const files = attachmentSnapshot
        .filter((item: any) => !item.image || !item.data)
        .map((item: any) => ({ path: String(item.path), name: String(item.name), kind: item.kind === "folder" ? "folder" as const : "file" as const }));
      thread.transcript.pushUser(
        message,
        imageItems.length,
        { imageItems, attachments: files },
      );
      thread.streaming = true;
      thread.loaded = true;
    }
    try {
      const prepared = attachmentSnapshot.length
        ? await host.prepareAttachments(ws.cwd, attachmentSnapshot.map((item: any) => item.path))
        : { text: "", images: [] };
      const prompt = [prepared.text, message].filter(Boolean).join("\n");
      thread.attachments = [];
      const disposition = await rpc(ws.cwd, "prompt", [prompt, prepared.images, behavior], targetSessionFile);
      if (disposition === "handled") {
        thread.streaming = false;
        await reload(ws, targetSessionFile);
      }
      await refreshSessions(ws);
    } catch (error: any) {
      thread.streaming = false;
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
    }
  }

  async function stop(): Promise<string> {
    const ws = active.value;
    if (!ws) return "";
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    const queued = await rpc(ws.cwd, "clearQueue", [], targetSessionFile);
    await rpc(ws.cwd, "abort", [], targetSessionFile);
    thread.queue = { steering: [], followUp: [] };
    return [...(queued?.steering ?? []), ...(queued?.followUp ?? [])].join("\n");
  }

  async function newSession(): Promise<void> {
    const ws = active.value;
    if (!ws || ws.status !== "ready") return;
    const existingPending = pendingNewSessions.get(ws.cwd);
    if (existingPending) return existingPending;

    const prevSessionFile = ws.sessionFile;
    const prevModel = ws.model;
    const prevLevels = [...ws.levels];
    const prevThinking = ws.thinking;
    const prevSessions = [...ws.sessions];

    // 1. 乐观即时切换（0ms UI 响应）：立即创建空白线程并切换界面，无需等待后端进程/RPC
    const tempFile = `__optimistic_new_${Date.now()}__`;
    const tempKey = normalizeThreadKey(tempFile);
    const tempThread = ensureThread(ws, tempFile);
    tempThread.model = prevModel;
    tempThread.levels = prevLevels;
    tempThread.thinking = prevThinking;
    tempThread.loaded = true;

    ws.sessionFile = tempFile;
    ws.sessions = [
      { id: tempFile, path: tempFile, title: "新会话", empty: true, timestamp: Date.now() },
      ...prevSessions.filter((s: any) => !s.empty || ws.isSessionStreaming(s.path)),
    ];
    bus.emit("session:switched", { cwd: ws.cwd, sessionFile: tempFile });

    // 2. 后台执行单次 RPC 并无缝绑定真实 sessionFile（保留用户在此期间已输入的草稿和附件）
    const task = (async () => {
      try {
        const res = await rpc(ws.cwd, "newSession", []);
        if (res?.cancelled) {
          delete ws.threads[tempKey];
          if (ws.sessionFile === tempFile) ws.sessionFile = prevSessionFile;
          ws.sessions = prevSessions;
          return;
        }
        const realFile = res?.sessionFile || "";
        if (realFile) {
          const realKey = normalizeThreadKey(realFile);
          tempThread.sessionFile = realFile;
          if (res?.state) {
            tempThread.sessionName = res.state.sessionName ?? tempThread.sessionName ?? "";
            tempThread.model = res.state.model ?? tempThread.model;
            tempThread.thinking = res.state.thinkingLevel ?? tempThread.thinking;
            tempThread.streaming = Boolean(res.state.isStreaming);
            tempThread.compacting = Boolean(res.state.isCompacting);
          }
          ws.threads[realKey] = tempThread;
          delete ws.threads[tempKey];
          if (ws.sessionFile === tempFile) {
            ws.sessionFile = realFile;
          }
          if (Array.isArray(res?.workerStates)) {
            for (const worker of res.workerStates) {
              if (!worker?.sessionFile) continue;
              const wThread = ensureThread(ws, worker.sessionFile);
              wThread.streaming = Boolean(worker.streaming);
              wThread.compacting = Boolean(worker.compacting);
            }
          }
          if (Array.isArray(res?.sessions)) {
            ws.sessions = res.sessions;
          } else {
            await reload(ws, realFile);
          }
        } else {
          delete ws.threads[tempKey];
          await reload(ws);
        }
      } catch (error: any) {
        delete ws.threads[tempKey];
        if (ws.sessionFile === tempFile) ws.sessionFile = prevSessionFile;
        ws.sessions = prevSessions;
        bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      } finally {
        pendingNewSessions.delete(ws.cwd);
      }
    })();

    pendingNewSessions.set(ws.cwd, task);
    return task;
  }

  async function switchSession(file: string): Promise<void> {
    const ws = active.value;
    if (!ws || !file || normalizeThreadKey(file) === normalizeThreadKey(ws.sessionFile)) return;
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});

    const previousFile = ws.sessionFile;
    const targetThread = ws.threads[normalizeThreadKey(file)];
    const alreadyLoaded = Boolean(targetThread?.loaded);
    if (alreadyLoaded) {
      // 如果目标会话已在内存中加载过（如正在后台运行的并行会话），立即 0ms 切换视图
      ws.sessionFile = file;
      bus.emit("session:switched", { cwd: ws.cwd, sessionFile: file });
    }

    try {
      const res = await rpc(ws.cwd, "switchSession", [file]);
      if (res?.cancelled) {
        if (ws.sessionFile === file) ws.sessionFile = previousFile;
        return;
      }

      if (alreadyLoaded && res?.reusedWorker && targetThread?.streaming) {
        // 复用了正在流式输出的温备 Worker，无需重新拉取完整历史覆盖实时流
        return;
      }

      await reload(ws, file);
      if (!alreadyLoaded) {
        bus.emit("session:switched", { cwd: ws.cwd, sessionFile: ws.sessionFile });
      }
    } catch (error) {
      if (ws.sessionFile === file) ws.sessionFile = previousFile;
      if (alreadyLoaded) bus.emit("session:switched", { cwd: ws.cwd, sessionFile: previousFile });
      throw error;
    }
  }

  async function setModel(model: any): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    await rpc(ws.cwd, "setModel", [model.provider, model.id], targetSessionFile);
    thread.model = model;
    thread.levels = await rpc(ws.cwd, "getAvailableThinkingLevels", [], targetSessionFile);
  }

  async function setThinking(level: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    await rpc(ws.cwd, "setThinkingLevel", [level], targetSessionFile);
    thread.thinking = level;
  }

  function setTheme(id: string): void {
    state.theme = id;
    localStorage.setItem(THEME_KEY, id);
  }

  /**
   * 应用界面缩放（Chromium zoom factor）。缩放完全由设置页的 uiZoom 控制，
   * 不再绑定全局快捷键。返回主进程实际生效的值。
   */
  async function setAppZoom(factor: number): Promise<number> {
    const next = Math.min(3, Math.max(0.5, Number(factor) || 1));
    if (!host?.setZoomFactor) return next;
    try {
      return await host.setZoomFactor(next);
    } catch {
      return next;
    }
  }

  // ---------- 本机 Pi CLI 定位 / 查更新 / 更新 ----------
  /** 重新定位本机 pi（版本与安装路径），定位完成会广播 pi:located。 */
  /**
   * 重新定位本机 pi。customPath 为空时只从 PATH 识别；传入则直接校验该路径。
   * 返回定位结果，供手动输入路径时做成功/失败判定。定位完成广播 pi:located。
   */
  async function refreshPi(customPath = ""): Promise<{ found: boolean; version: string; path: string }> {
    if (!host?.locate) return { found: state.pi.found, version: state.pi.version, path: state.pi.path };
    const pi = await host.locate(customPath || undefined).catch(() => ({ found: false, version: "", path: customPath }));
    state.pi = {
      ...state.pi,
      found: Boolean(pi.found),
      version: pi.version ?? "",
      path: pi.path ?? customPath,
      checked: true,
    };
    bus.emit("pi:located", { ...state.pi });
    return { found: state.pi.found, version: state.pi.version, path: state.pi.path };
  }

  /** 查询 npm registry 上的最新 Pi CLI 版本。customPath 透传给定位（手动路径同样可查）。 */
  async function checkPiUpdate(customPath = ""): Promise<{ current: string; latest: string; updateAvailable: boolean }> {
    if (!host?.checkPiUpdate || state.pi.checking) {
      return { current: state.pi.version, latest: state.pi.latest, updateAvailable: state.pi.updateAvailable };
    }
    state.pi.checking = true;
    try {
      const result = await host.checkPiUpdate(customPath || undefined);
      state.pi.latest = result.latest ?? "";
      state.pi.updateAvailable = Boolean(result.updateAvailable);
      if (result.error) bus.emit("notify", { level: "warning", text: result.error });
      return { current: result.current, latest: result.latest, updateAvailable: Boolean(result.updateAvailable) };
    } catch (error: any) {
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return { current: state.pi.version, latest: state.pi.latest, updateAvailable: false };
    } finally {
      state.pi.checking = false;
    }
  }

  /**
   * 全局更新 Pi CLI 到 latest。成功后刷新定位与版本，记录 lastUpdate 并通知，
   * 设置页据此展示“更新后做了什么”（版本变化 + 时间 + 安装日志）。
   */
  async function checkAppUpdate(): Promise<{ current: string; latest: string; updateAvailable: boolean; url: string }> {
    const current = state.appUpdate;
    if (!host?.checkAppUpdate || current.checking) {
      return { current: current.current, latest: current.latest, updateAvailable: current.updateAvailable, url: current.url };
    }
    state.appUpdate.checking = true;
    try {
      const result = await host.checkAppUpdate();
      state.appUpdate.current = result.current ?? "";
      state.appUpdate.latest = result.latest ?? "";
      state.appUpdate.updateAvailable = Boolean(result.updateAvailable);
      state.appUpdate.url = result.url ?? "";
      state.appUpdate.assetName = result.assetName ?? "";
      state.appUpdate.phase = result.updateAvailable ? "available" : "idle";
      state.appUpdate.checkedAt = Date.now();
      if (result.error) bus.emit("notify", { level: "warning", text: result.error });
      else if (result.updateAvailable) bus.emit("notify", { level: "info", text: `Pi Desktop ${result.latest} 已发布，当前版本 ${result.current}` });
      return { current: state.appUpdate.current, latest: state.appUpdate.latest, updateAvailable: state.appUpdate.updateAvailable, url: state.appUpdate.url };
    } catch (error: any) {
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return { current: current.current, latest: current.latest, updateAvailable: false, url: current.url };
    } finally {
      state.appUpdate.checking = false;
    }
  }

  async function downloadAppUpdate(): Promise<boolean> {
    if (!host?.downloadAppUpdate || state.appUpdate.phase === "downloading") return false;
    state.appUpdate.phase = "downloading";
    try {
      const prepared = await host.downloadAppUpdate();
      state.appUpdate.latest = prepared.version;
      state.appUpdate.assetName = prepared.assetName;
      state.appUpdate.url = prepared.url;
      state.appUpdate.phase = "ready";
      bus.emit("notify", { level: "info", text: `Pi Desktop ${prepared.version} 已准备完成，确认后才会安装` });
      return true;
    } catch (error: any) {
      state.appUpdate.phase = state.appUpdate.updateAvailable ? "available" : "idle";
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return false;
    }
  }

  async function installAppUpdate(): Promise<boolean> {
    if (!host?.installAppUpdate || state.appUpdate.phase !== "ready") return false;
    state.appUpdate.phase = "installing";
    try {
      await host.installAppUpdate(state.appUpdate.latest);
      return true;
    } catch (error: any) {
      state.appUpdate.phase = "ready";
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return false;
    }
  }

  async function openAppUpdate(): Promise<boolean> {
    if (!state.appUpdate.url || !host?.openAppUpdate) return false;
    return Boolean(await host.openAppUpdate(state.appUpdate.url).catch(() => false));
  }

  async function updatePi(customPath = "", scope: "self" | "all" = "self"): Promise<boolean> {
    if (!host?.updatePi || state.pi.updating) return false;
    state.pi.updating = true;
    try {
      const result = await host.updatePi(customPath || undefined, scope === "all" ? "all" : "self");
      if (!result.ok) {
        bus.emit("notify", { level: "error", text: `Pi 更新失败：${result.log.slice(-200) || "未知错误"}` });
        return false;
      }
      await refreshPi(customPath);
      state.pi.latest = result.to || state.pi.latest;
      state.pi.updateAvailable = false;
      state.pi.lastUpdate = { from: result.from, to: result.to, at: Date.now(), log: result.log };
      bus.emit("notify", {
        level: "info",
        text: result.from === result.to
          ? `Pi 已是最新（${result.to || state.pi.version}），无需更新`
          : `Pi 已从 ${result.from || "未知版本"} 更新到 ${result.to}`,
      });
      bus.emit("pi:updated", { ...state.pi.lastUpdate });
      return true;
    } catch (error: any) {
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return false;
    } finally {
      state.pi.updating = false;
    }
  }

  // ---------- MCP 与 Pi 软件包管理（支持 Electron 宿主 IPC 与 Web 预览兜底） ----------
  const mockMcpOverview = reactive<McpOverview>({
    agentDir: "~/.pi/agent",
    globalConfigPath: "~/.pi/agent/mcp.json",
    projectConfigPath: ".pi/mcp.json",
    autoEnableCodemode: true,
    servers: [
      {
        name: "github",
        scope: "global",
        sourcePath: "~/.pi/agent/mcp.json",
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        enabled: true,
        exposure: "codemode",
        description: "GitHub 仓库、Issue、Pull Request 与分支管理 MCP 服务",
        state: "connected",
        tools: ["list_issues", "create_pull_request", "search_code", "get_file_contents", "list_commits"],
        resources: true,
      },
      {
        name: "linkup",
        scope: "global",
        sourcePath: "~/.pi/agent/mcp.json",
        type: "stdio",
        command: "npx",
        args: ["-y", "linkup-mcp-server"],
        enabled: true,
        exposure: "codemode",
        description: "实时联网搜索与网页内容深度抓取",
        state: "connected",
        tools: ["linkup-search", "linkup-research", "linkup-fetch"],
      },
    ],
    errors: [],
  });

  const mockPackagesOverview = reactive<PiPackagesOverview>({
    agentDir: "~/.pi/agent",
    globalSettingsPath: "~/.pi/agent/settings.json",
    projectSettingsPath: ".pi/settings.json",
    packages: [
      {
        source: "npm:@datfooldive/pi-ask",
        scope: "user",
        kind: "npm",
        displayName: "@datfooldive/pi-ask",
        version: "0.2.1",
        description: "Interactive question & confirmation prompt extension for Pi Coding Agent",
        installed: true,
        installedPath: "~/.pi/agent/npm/node_modules/@datfooldive/pi-ask",
        filtered: false,
        counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
      },
    ],
    resources: [
      {
        path: "~/.pi/agent/npm/node_modules/@datfooldive/pi-ask/index.ts",
        name: "pi-ask",
        type: "extensions",
        enabled: true,
        scope: "user",
        origin: "package",
        source: "npm:@datfooldive/pi-ask",
      },
    ],
  });

  async function mcpOverview(): Promise<McpOverview> {
    if (host?.mcpOverview) return host.mcpOverview(state.activeCwd || undefined);
    return mockMcpOverview;
  }

  async function mcpProbe(): Promise<McpOverview> {
    if (host?.mcpProbe) return host.mcpProbe(state.activeCwd || undefined);
    for (const srv of mockMcpOverview.servers) {
      srv.state = srv.enabled ? "connected" : "disabled";
    }
    return mockMcpOverview;
  }

  async function mcpSaveServer(payload: {
    scope: "global" | "project";
    name: string;
    previousName?: string;
    config: Record<string, any>;
  }): Promise<McpOverview> {
    if (host?.mcpSaveServer) {
      return host.mcpSaveServer(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const name = payload.name.trim();
    if (!name) throw new Error("请输入 MCP 服务名称");
    const cfg = payload.config ?? {};
    const item = {
      name,
      scope: payload.scope,
      sourcePath: payload.scope === "project" ? ".pi/mcp.json" : "~/.pi/agent/mcp.json",
      type: (cfg.url ? "http" : "stdio") as "http" | "stdio",
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      cwd: cfg.cwd,
      url: cfg.url,
      headers: cfg.headers,
      enabled: cfg.enabled !== false,
      exposure: (cfg.exposure || "codemode") as McpExposureMode,
      description: cfg.description,
      state: cfg.enabled === false ? "disabled" : "connected",
      tools: [],
    };
    const idx = mockMcpOverview.servers.findIndex(
      (s) => s.scope === payload.scope && (s.name === (payload.previousName || name) || s.name === name),
    );
    if (idx >= 0) mockMcpOverview.servers.splice(idx, 1, item);
    else mockMcpOverview.servers.push(item);
    return mockMcpOverview;
  }

  async function mcpUpdateServer(payload: {
    scope: "global" | "project";
    name: string;
    patch: { enabled?: boolean; exposure?: McpExposureMode };
  }): Promise<McpOverview> {
    if (host?.mcpUpdateServer) {
      return host.mcpUpdateServer(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const srv = mockMcpOverview.servers.find((s) => s.scope === payload.scope && s.name === payload.name);
    if (srv) {
      if (payload.patch.enabled !== undefined) {
        srv.enabled = payload.patch.enabled;
        srv.state = srv.enabled ? "connected" : "disabled";
      }
      if (payload.patch.exposure !== undefined) {
        srv.exposure = payload.patch.exposure;
      }
    }
    return mockMcpOverview;
  }

  async function mcpRemoveServer(payload: { scope: "global" | "project"; name: string }): Promise<McpOverview> {
    if (host?.mcpRemoveServer) {
      return host.mcpRemoveServer(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const idx = mockMcpOverview.servers.findIndex((s) => s.scope === payload.scope && s.name === payload.name);
    if (idx >= 0) mockMcpOverview.servers.splice(idx, 1);
    return mockMcpOverview;
  }

  async function mcpSetAutoCodemode(payload: { scope?: "global" | "project"; enabled: boolean }): Promise<McpOverview> {
    if (host?.mcpSetAutoCodemode) {
      return host.mcpSetAutoCodemode(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    mockMcpOverview.autoEnableCodemode = payload.enabled;
    return mockMcpOverview;
  }

  async function mcpImportJson(payload: { scope: "global" | "project"; jsonText: string }): Promise<McpOverview> {
    if (host?.mcpImportJson) {
      return host.mcpImportJson(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const parsed = JSON.parse(payload.jsonText);
    const entries = parsed.mcpServers ?? parsed;
    for (const [name, cfg] of Object.entries(entries)) {
      if (cfg && typeof cfg === "object") {
        await mcpSaveServer({ scope: payload.scope, name, config: cfg as Record<string, any> });
      }
    }
    return mockMcpOverview;
  }

  async function packagesOverview(): Promise<PiPackagesOverview> {
    if (host?.packagesOverview) return host.packagesOverview(state.activeCwd || undefined);
    return mockPackagesOverview;
  }

  async function packagesInstall(payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    if (host?.packagesInstall) {
      return host.packagesInstall(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const raw = payload.source.trim();
    if (!raw) throw new Error("请输入要安装的软件包来源");
    const source = raw.startsWith("npm:") || raw.startsWith("git:") || raw.startsWith("./") ? raw : `npm:${raw}`;
    const kind = source.startsWith("git:") ? "git" : source.startsWith("./") ? "local" : "npm";
    const scope = payload.local ? "project" : "user";
    if (!mockPackagesOverview.packages.some((p) => p.source === source && p.scope === scope)) {
      mockPackagesOverview.packages.push({
        source,
        scope,
        kind,
        displayName: source.replace(/^(npm:|git:)/, ""),
        version: "latest",
        description: "已通过 Pi Package Manager 安装并写入配置",
        installed: true,
        installedPath: `~/.pi/agent/npm/node_modules/${source.replace(/^npm:/, "")}`,
        filtered: false,
        counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
      });
    }
    return mockPackagesOverview;
  }

  async function packagesRemove(payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    if (host?.packagesRemove) {
      return host.packagesRemove(state.activeCwd || "", JSON.parse(JSON.stringify(payload)));
    }
    const scope = payload.local ? "project" : "user";
    const idx = mockPackagesOverview.packages.findIndex((p) => p.source === payload.source && p.scope === scope);
    if (idx >= 0) mockPackagesOverview.packages.splice(idx, 1);
    return mockPackagesOverview;
  }

  async function packagesUpdate(payload?: { source?: string }): Promise<PiPackagesOverview> {
    if (host?.packagesUpdate) {
      return host.packagesUpdate(state.activeCwd || "", payload ? JSON.parse(JSON.stringify(payload)) : undefined);
    }
    return mockPackagesOverview;
  }

  const mockSkillsOverview = reactive<PiSkillsOverview>({
    agentDir: "~/.pi/agent",
    globalSkillsDir: "~/.pi/agent/skills",
    projectSkillsDir: ".pi/skills",
    directories: [
      { label: "全局技能目录", path: "~/.pi/agent/skills" },
      { label: "用户 Agent Skills", path: "~/.agents/skills" },
      { label: "当前项目技能目录", path: ".pi/skills" },
    ],
    skills: [
      {
        name: "commit",
        description: "按仓库规范生成提交信息并完成提交",
        filePath: "~/.pi/agent/skills/commit/SKILL.md",
        baseDir: "~/.pi/agent/skills/commit",
        scope: "user",
        origin: "top-level",
        source: "local",
        disableModelInvocation: false,
      },
    ],
    diagnostics: [],
  });

  async function skillsOverview(): Promise<PiSkillsOverview> {
    if (host?.skillsOverview) return host.skillsOverview(state.activeCwd || undefined);
    return mockSkillsOverview;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopHostEvents?.();
    stopHostEvents = null;
    for (const ws of workspaces.values()) {
      const refresh = sessionRefreshes.get(ws);
      if (!refresh) continue;
      if (refresh.timer !== null) {
        const cancel = typeof window !== "undefined" ? window.clearTimeout : clearTimeout;
        cancel(refresh.timer);
        refresh.timer = null;
      }
      refresh.dirty = false;
      refresh.generation += 1;
    }
    opens.clear();
    initPromise = null;
  }

  return {
    state,
    workspaces,
    active,
    init,
    dispose,
    open,
    chooseAndOpen,
    listDirectory,
    readFile: readWorkspaceFile,
    writeFile: writeWorkspaceFile,
    readWorkspaceFile,
    writeWorkspaceFile,
    openWorkspacePath,
    createEntry,
    renameEntry,
    deleteEntry,
    gitOverview,
    gitInspect,
    completePaths,
    addFiles,
    addPastedImage,
    extractDroppedPaths,
    chooseFiles,
    chooseFolder,
    removeAttachment,
    forget,
    removeProject,
    deleteSession,
    reveal,
    reload,
    restart,
    renameSession,
    notice,
    refreshSessions,
    listSessions,
    openSession,
    loadMoreMessages,
    call,
    send,
    stop,
    newSession,
    switchSession,
    refreshPi,
    checkPiUpdate,
    checkAppUpdate,
    downloadAppUpdate,
    installAppUpdate,
    openAppUpdate,
    updatePi,
    setSidebarWidth,
    setPanelWidth,
    setStageWidth,
    togglePanel,
    closePanel,
    setModel,
    setThinking,
    setAppZoom,
    setTheme,
    mcpOverview,
    mcpProbe,
    mcpSaveServer,
    mcpUpdateServer,
    mcpRemoveServer,
    mcpSetAutoCodemode,
    mcpImportJson,
    packagesOverview,
    packagesInstall,
    packagesRemove,
    packagesUpdate,
    skillsOverview,
  };
}

export type Workbench = ReturnType<typeof createWorkbench>;
