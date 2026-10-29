import { computed, reactive, shallowReactive, toRaw } from "vue";
import { displayProjectName, projectPathKey } from "../shared/util.ts";
import { readStorage, writeStorage } from "../shared/storage.ts";
import { applySessionName } from "../shared/session-title.ts";
import { clearComposerDraft, readComposerDraft, writeComposerDraft, type ComposerDraft } from "../shared/composer-draft.ts";
import { nextRefreshDelay, type RefreshBackoff } from "../shared/refresh-backoff.ts";
import { composePrompt } from "../shared/prompt.ts";
import {
    planQueueEdit,
    planQueueMode,
    planQueueWithdraw,
    planQueuedFlush,
    queueDraftText,
    queueFromOrder,
    queueImagesByPrompt,
    resolveQueueOrder,
    sameQueue,
    type QueuedEntry,
  } from "../shared/queue-view.ts";
import { rebuildPrompt } from "../shared/queue-prompt.ts";
import { piUpdateToast } from "../shared/pi-update.ts";
import { buildCustomSessionBlocks, extractSessionBody } from "../shared/session-block.ts";
import { createTranscript, type TranscriptBlock } from "./transcript.ts";
import type { EventBus } from "./event-bus.ts";
import type {
  GitActionResult,
  GitActionName,
  GitActionPayload,
  GitInspectResult,
  GitOverview,
  GitBranch,
  GitWorktree,
  GitWorktreeCreateResult,
  GitWorktreeRemoveResult,
  McpExposureMode,
  McpOverview,
  PiPackagesOverview,
  PiSkillsOverview,
  WorkspaceEntry,
  WorkspaceFileData,
} from "../env.d.ts";

const THEME_KEY = "pi-desktop.theme";

/** 界面侧日志：走主进程落盘（logs/renderer.log）。日志失败绝不影响工作区。 */
function logUi(level: "debug" | "info" | "warn" | "error", message: string): void {
  try {
    (window as any).piDesktop?.logEvent?.(level, "workbench", message);
  } catch {
    // 忽略
  }
}
/** 每页加载的历史消息条数 */
const PAGE_SIZE = 8;
/** 每页至少渲染多少个块（8 条原始消息在长工具链里可能只渲染成 4 行） */
const PAGE_MIN_BLOCKS = 8;
/** 首屏消息条数：8 条在长工具链会话中可能只够 1～2 条气泡，首屏多给一些上下文 */
const INITIAL_PAGE_SIZE = 40;
/** 首屏至少凑够多少轮用户对话 */
const INITIAL_MIN_TURNS = 3;
/** 子代理会话弹窗一次读取的消息条数（只读快照，不做分页） */
const AGENT_SESSION_LIMIT = 400;
/** 与主进程 prepareAttachments 的上限保持一致 */
const MAX_ATTACHMENTS = 20;
/** 引用对话的上限：每个都占掉一大段上下文，多了提示词会被撑爆 */
const MAX_SESSION_ATTACHMENTS = 5;
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
  const raw = readStorage(key);
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

/** 没有打开工作区或宿主不支持 Git 时的空概览，保证界面字段始终完整。 */
export function emptyGitOverview(): GitOverview {
  return {
    isRepo: false,
    root: "",
    branch: "",
    detached: false,
    upstream: "",
    ahead: 0,
    behind: 0,
    hasCommits: false,
    canWrite: false,
    hasRemote: false,
    status: [],
    commits: [],
    userName: "",
    userEmail: "",
  };
}

export function createWorkbench({ host, bus, beforeRemoveWorkspace = async () => true, beforeGitBranchChange = async () => true }: { host: any; bus: EventBus; beforeRemoveWorkspace?: (cwd: string) => Promise<boolean>; beforeGitBranchChange?: (cwd: string) => Promise<boolean> }) {
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
      lastUpdate: null as null | { from: string; to: string; at: number; log: string; scope?: "self" | "all" },
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
      /** 上次检查失败的原因（限流 / 断网）；有值时不能显示「已是最新」 */
      error: "",
    },
    recent: [] as string[],
    activeCwd: "",
    theme: readStorage(THEME_KEY) === "light" ? "light" : "dark",
    sidebarOpen: true,
    sidebarWidth: savedSidebarWidth(),
    panelWidth: savedWidth(PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 320),
    stageWidth: savedWidth(EDITOR_WIDTH_KEY, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH, 520),
    activePanelId: "files",
    paletteOpen: false,
  });

  const workspaces = shallowReactive(new Map<string, WorkspaceState>());
  const sessionRefreshes = new WeakMap<
    WorkspaceState,
    {
      timer: number | null;
      running: Promise<void> | null;
      dirty: boolean;
      generation: number;
      /** 重排退避状态与上次完成时间：避免事件风暴把刷新变成 0ms 自旋 */
      backoff: RefreshBackoff;
      lastDone: number;
    }
  >();
  const opens = new Map<string, Promise<WorkspaceState>>();
  let stopHostEvents: (() => void) | null = null;
  let initPromise: Promise<void> | null = null;
  let disposed = false;
  /** 用户点了「取消下载」后，下载 Promise 的失败不应再报成错误 Toast。 */
  let appUpdateCancelled = false;

  const draftTimers = new Map<string, number>();

  /** 附件只存路径与名称：恢复时重新向主进程校验，文件被删了就跳过。 */
  function draftOf(thread: SessionThreadState): ComposerDraft {
    const attachments = (thread.attachments ?? [])
      .map((item: any) => ({ path: String(item?.path ?? ""), name: item?.name, kind: item?.kind }))
      .filter((item) => item.path)
      .slice(0, MAX_ATTACHMENTS);
    return { text: thread.draft ?? "", attachments };
  }

  /** 草稿写入防抖：连续输入只写最后一次，避免每键一次 localStorage。 */
  function saveDraftSoon(cwd: string, sessionFile: string, draft: ComposerDraft): void {
    // Node 环境（脚本回归）没有 window / localStorage：草稿落盘只对界面有意义。
    if (!cwd || typeof window === "undefined") return;
    const key = `${cwd}|${sessionFile}`;
    const timer = draftTimers.get(key);
    if (timer) window.clearTimeout(timer);
    draftTimers.set(key, window.setTimeout(() => {
      draftTimers.delete(key);
      writeComposerDraft(cwd, sessionFile, draft);
    }, 400) as unknown as number);
  }

  /** 立即落盘（发送 / 切换会话前调用，避免防抖窗口内丢失）。 */
  function flushDraft(cwd: string, sessionFile: string, draft: ComposerDraft): void {
    if (typeof window === "undefined") return;
    const key = `${cwd}|${sessionFile}`;
    const timer = draftTimers.get(key);
    if (timer) {
      window.clearTimeout(timer);
      draftTimers.delete(key);
    }
    writeComposerDraft(cwd, sessionFile, draft);
  }

  /**
   * 恢复草稿里的附件：逐个重新校验（可能已删除、或不在工作区内），
   * 成功多少恢复多少，失败的汇总成一条提示。
   */
  function restoreDraftAttachments(ws: WorkspaceState, thread: SessionThreadState, stored: ComposerDraft["attachments"]): void {
    if (!stored.length) return;
    void (async () => {
      const missing: string[] = [];
      for (const item of stored) {
        if (thread.attachments.length >= MAX_ATTACHMENTS) break;
        try {
          // 会话附件不在项目目录内，要走会话专用的校验入口。
          const prepared = item.kind === "session"
            ? await host.prepareSessionAttachments(ws.cwd, [item.path])
            : await host.prepareAttachments(ws.cwd, [item.path], [item.path]);
          for (const entry of prepared.items ?? []) {
            if (!entry?.path || thread.attachments.some((existing: any) => existing.path === entry.path)) continue;
            thread.attachments.push(entry);
          }
        } catch {
          missing.push(item.name || item.path);
        }
      }
      if (missing.length) {
        bus.emit("notify", {
          level: "warning",
          text: `草稿里有 ${missing.length} 个附件已不可用，已跳过：${missing.slice(0, 3).join("、")}`,
        });
      }
    })();
  }

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
      // 重启后恢复上次未发送的草稿（正文 + 附件）。
      const stored = readComposerDraft(ws.cwd, sessionFile);
      thread.draft = stored.text;
      ws.threads[key] = thread;
      restoreDraftAttachments(ws, thread, stored.attachments);
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
      name: displayProjectName(cwd),
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
        const thread = this.activeThread;
        thread.draft = value;
        // 输入过程中持续落盘（防抖），重启后可以接着写。
        saveDraftSoon(this.cwd, thread.sessionFile, draftOf(thread));
      },
      get attachments(): any[] {
        return this.activeThread.attachments;
      },
      set attachments(value: any[]) {
        const thread = this.activeThread;
        thread.attachments = value;
        // 附件变化同样落盘：草稿不只是正文。
        saveDraftSoon(this.cwd, thread.sessionFile, draftOf(thread));
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

  /**
   * 按规范化路径查找已打开的工作区。
   * 主进程的 recent 可能返回反斜杠路径，而目录选择器返回正斜杠路径；
   * 如果只用 Map 精确匹配，会为同一个项目创建第二个工作区，导致侧栏出现
   * 两组同名项目、活动任务高亮错位。
   */
  function findWorkspace(cwd: string): WorkspaceState | undefined {
    const direct = workspaces.get(cwd);
    if (direct) return direct;
    const key = projectPathKey(cwd);
    if (!key) return undefined;
    for (const ws of workspaces.values()) {
      if (projectPathKey(ws.cwd) === key) return ws;
    }
    return undefined;
  }

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
    // 打开会话时即便正在流式输出也要补齐历史：
    // 否则 snap.messages 只是压缩后的上下文，可能只有几条消息。
    void hydrateHistory(ws, thread, initial);

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
    const wasStreaming = thread.streaming;
    const loaded = thread.historyStart >= 0 && thread.messageTotal > thread.historyStart
      ? thread.messageTotal - thread.historyStart
      : 0;
    // historyStart < 0 说明这线程是事件/上下文消息建起来的（比如流式中打开），按首屏处理
    const firstLoad = initial || thread.historyStart < 0;
    // 已完整加载过窗口时，流式中不再覆盖，避免抹掉正在输出的半截消息
    if (!firstLoad && wasStreaming) return;
    // 首屏多加载一些：8 条消息在长工具链会话里可能只够一轮对话；
    // 之后再向上翻页时仍按 8 条一页。
    const limit = firstLoad ? INITIAL_PAGE_SIZE : Math.max(PAGE_SIZE, loaded + PAGE_SIZE);
    try {
      const page = await host.messagePage(ws.cwd, file, 0, limit, firstLoad ? INITIAL_MIN_TURNS : 0);
      if (disposed || workspaces.get(ws.cwd) !== ws) return;
      if (thread.sessionFile !== file) return;
      // 请求期间从空闲进入流式：放弃这次覆盖，避免抹掉刚产生的实时内容
      if (!wasStreaming && thread.streaming) return;
      if (page.total === 0) {
        // 文件里还没有落盘消息（刚新建的会话），保留内存里的消息
        thread.historyStart = 0;
        thread.messageTotal = thread.blocks.length;
        return;
      }
      // 非首次加载且内容没变：不重绘，避免用户上翻阅读时被拉回底部
      if (!firstLoad && page.total === thread.messageTotal) return;
      thread.transcript.loadMessages(page.messages);
      thread.historyStart = page.startIndex;
      thread.messageTotal = page.total;
      thread.loaded = true;
    } catch {
      // 会话文件读不到时保留 getMessages() 的结果，不阻断会话打开。
      // 不把 historyStart 伪造成 0：否则界面会误以为“已加载全部”，
      // 也会让 agent_settled 的历史兜底不再重试。
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
        const ws = findWorkspace(cwd);
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
        applyQueue(thread, { steering: [], followUp: [] });
        if (thread.historyStart < 0) {
          // 兜底：打开时没能从文件补齐（比如正好在流式开始的一瞬），本轮结束后补
          // 补齐会重建块，所以用量条要在补齐完成后再挂回去。
          void hydrateHistory(ws, thread, true).finally(() => appendUsage(thread));
        } else {
          appendUsage(thread);
        }
        scheduleSessionsRefresh(ws);
        break;
      case "queue_update":
        applyQueue(thread, { steering: event.steering, followUp: event.followUp });
        break;
      case "message_update":
        // 流式增量里的 usage 可能仍是 provider 初始化的全 0 快照；
        // 先保留它作为兜底，最终用量以 message_end 的完整 assistant message 为准。
        if (event.usage ?? event.message?.usage) thread.usage = event.usage ?? event.message.usage;
        break;
      case "message_end":
        // pi 的 RPC JSON 事件会把最终用量放在 message.usage，而不是
        // message_update.usage。必须在 agent_settled 前接住这个权威快照，
        // 否则界面会把流式开始时的全 0 用量显示出来。
        if (event.message?.role === "assistant" && event.message.usage) {
          thread.usage = event.message.usage;
        }
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
        updateSessionTitle(ws, thread);
        scheduleSessionsRefresh(ws);
        break;
      default:
        break;
    }
  }

  async function open(cwd: string): Promise<WorkspaceState> {
    let ws = findWorkspace(cwd);
    const target = ws?.cwd ?? cwd;
    const switched = projectPathKey(state.activeCwd) !== projectPathKey(target);
    state.activeCwd = target;
    if (switched) bus.emit("workspace:switched", { cwd: target });
    if (ws?.status === "ready") return ws;
    const pending = opens.get(target);
    if (pending) return pending;
    if (!ws) {
      ws = makeWorkspace(cwd);
      workspaces.set(cwd, ws);
    }
    ws.status = "starting";
    ws.error = "";
    // 启动看门狗：open 有可能永不返回（IPC 丢了、渲染进程半挂），那样工作区会一直
    // 停在「启动中」且日志里什么都没有。到点先记一条，再给一个可重试的错误。
    const startupTimers = [
      setTimeout(() => {
        if (disposed || ws!.status !== "starting") return;
        logUi("warn", `工作区 ${target} 启动超过 30 秒仍未就绪（open 尚未返回）`);
      }, 30_000),
      setTimeout(() => {
        if (disposed || ws!.status !== "starting") return;
        logUi("error", `工作区 ${target} 启动超时，已重置为可重试状态`);
        ws!.status = "error";
        ws!.error = "启动超时：Pi 进程没有在一分钟内就绪，点一下这个项目可重新启动";
      }, 90_000),
    ] as const;
    const task = (async () => {
      try {
        const snap = await host.open(target);
        if (disposed) return ws!;
        applySnapshot(ws!, snap);
        ws!.status = "ready";
        state.recent = await host.recent();
        bus.emit("workspace:opened", ws);
      } catch (error: any) {
        ws!.status = "error";
        ws!.error = error?.message ?? String(error);
      } finally {
        for (const timer of startupTimers) clearTimeout(timer);
        opens.delete(target);
      }
      return ws!;
    })();
    opens.set(target, task);
    return task;
  }

  /** 只选目录、不打开：克隆弹窗的「位置」用得上 */
  async function chooseDirectory(): Promise<string | null> {
    if (!host?.chooseDirectory) return null;
    return host.chooseDirectory();
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

  async function writeWorkspaceFile(relative: string, content: string, revision?: string, cwd?: string): Promise<WorkspaceFileData> {
    const target = cwd || active.value?.cwd;
    if (!target) throw new Error("没有打开的工作区");
    return host.writeWorkspaceFile(target, relative, content, revision);
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
    if (!ws || !host?.gitOverview) return emptyGitOverview();
    return host.gitOverview(ws.cwd);
  }

  async function gitInspect(kind: "commit" | "working" | "staged" | "unstaged", target: string): Promise<GitInspectResult> {
    const ws = active.value;
    if (!ws || !host?.gitInspect) throw new Error("没有打开的工作区");
    return host.gitInspect(ws.cwd, kind, target);
  }

  async function gitBranches(): Promise<GitBranch[]> {
    const ws = active.value;
    return ws && host?.gitBranches ? host.gitBranches(ws.cwd) : [];
  }

  async function gitAction(action: GitActionName, payload: GitActionPayload = {}, cwd?: string): Promise<GitActionResult> {
    const target = cwd || active.value?.cwd;
    if (!target || !host?.gitAction) throw new Error("没有打开的工作区");
    const branchChange = action === "switchBranch" || action === "createBranch";
    if (branchChange) {
      const ws = findWorkspace(target);
      if (ws?.hasAnyRunning) throw new Error("当前项目有 Agent 任务运行中，请等待结束后再切换或新建分支");
      if (!await beforeGitBranchChange(target)) throw new Error("请先保存或关闭未保存的文件，再切换或新建分支");
    }
    const result = await host.gitAction(target, action, payload);
    const ws = findWorkspace(target);
    if (ws) ws.branch = result.overview.branch;
    if (branchChange) bus.emit("git:branch-changed", { cwd: target });
    if (state.activeCwd === target) bus.emit("files:changed", { directory: "" });
    return result;
  }

  /**
   * 克隆仓库到 target 目录并直接打开。
   *
   * 目标路径由界面用 `cloneTargetPath` 推导（位置 + 地址里的仓库名），主进程再复核一次
   * 绝对路径 / 父目录 / 目标是否为空，所以这里不再重复校验。
   */
  async function cloneRepository(url: string, target: string): Promise<string> {
    if (!host?.gitClone) throw new Error("当前环境不支持克隆仓库");
    const result = await host.gitClone(url, target);
    await open(result.path);
    return result.path;
  }

  async function gitWorktrees(): Promise<GitWorktree[]> {
    const ws = active.value;
    if (!ws || !host?.gitWorktrees) return [];
    return host.gitWorktrees(ws.cwd);
  }

  async function createGitWorktree(name: string): Promise<GitWorktreeCreateResult> {
    const ws = active.value;
    if (!ws || !host?.gitWorktreeCreate) throw new Error("没有打开的工作区");
    return host.gitWorktreeCreate(ws.cwd, name);
  }

  async function removeGitWorktree(target: string): Promise<GitWorktreeRemoveResult> {
    const ws = active.value;
    if (!ws || !host?.gitWorktreeRemove) throw new Error("没有打开的工作区");
    const cwd = ws.cwd;
    if (workspaces.has(target)) {
      // 移除工作树会删除目录：用户取消保存未保存草稿时必须中止，不能继续删。
      const removed = await removeProject(target);
      if (removed?.cancelled) throw new Error("已取消移除工作树：仍有未保存的文件修改");
    }
    return host.gitWorktreeRemove(cwd, target);
  }

  async function completePaths(query = ""): Promise<WorkspaceEntry[]> {
    const ws = active.value;
    if (!ws) return [];
    return host.completePaths(ws.cwd, query);
  }

  async function addFiles(paths: string[] = []): Promise<void> {
    const ws = active.value;
    if (!ws || !paths.length) return;
    const thread = ws.activeThread;
    const known = new Set(thread.attachments.map((item: any) => item.path));
    const seen = new Set<string>();
    const fresh = paths.filter((path) => {
      if (!path || known.has(path) || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
    const room = Math.max(0, MAX_ATTACHMENTS - thread.attachments.length);
    const accepted = fresh.slice(0, room);
    if (accepted.length < fresh.length) {
      bus.emit("notify", {
        level: "warning",
        text: `附件总数最多 ${MAX_ATTACHMENTS} 个，已忽略 ${fresh.length - accepted.length} 个`,
      });
    }
    if (!accepted.length) return;
    const prepared = await host.prepareAttachments(ws.cwd, accepted, accepted);
    for (const item of prepared.items ?? []) {
      if (!item?.path || thread.attachments.some(existing => existing.path === item.path)) continue;
      if (thread.attachments.length >= MAX_ATTACHMENTS) break;
      thread.attachments.push(item);
    }
    // push 绕过了 ws.attachments 的 setter，这里显式落盘（附件也是草稿的一部分）。
    saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
  }

  /**
   * @ 引用另一个对话：加一枚「会话」附件，发送时由主进程压成上下文块。
   * 会话可能来自任意项目，所以单独走 prepareSessionAttachments（不要求在项目目录内）。
   */
  async function addSessionAttachment(session: { path?: string; id?: string; title?: string } | null): Promise<void> {
    const ws = active.value;
    if (!ws || !session) return;
    const file = String(session.path || session.id || "");
    if (!file) return;
    const thread = ws.activeThread;
    if (file === thread.sessionFile) {
      bus.emit("notify", { level: "info", text: "这是当前对话，不用引用" });
      return;
    }
    if (thread.attachments.some((item: any) => item.kind === "session" && item.path === file)) return;
    const sessions = thread.attachments.filter((item: any) => item.kind === "session").length;
    if (sessions >= MAX_SESSION_ATTACHMENTS) {
      bus.emit("notify", { level: "warning", text: `一次最多引用 ${MAX_SESSION_ATTACHMENTS} 个对话` });
      return;
    }
    if (thread.attachments.length >= MAX_ATTACHMENTS) {
      bus.emit("notify", { level: "warning", text: `附件总数最多 ${MAX_ATTACHMENTS} 个` });
      return;
    }
    const prepared = await host.prepareSessionAttachments(ws.cwd, [file]);
    for (const item of prepared.items ?? []) {
      if (!item?.path || thread.attachments.some((existing: any) => existing.path === item.path)) continue;
      thread.attachments.push(item);
    }
    saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
  }

  /** 粘贴剪贴板图片：主进程落盘到临时目录后作为普通附件加入 */
  async function addPastedImage(payload: { name?: string; mimeType?: string; data: string }): Promise<void> {
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    if (!host?.savePastedImage) throw new Error("当前环境不支持粘贴图片");
    const thread = ws.activeThread;
    const file = await host.savePastedImage(payload);
    if (!file) throw new Error("剪贴板图片保存失败");
    const prepared = await host.prepareAttachments(ws.cwd, [file], [file]);
    for (const item of prepared.items ?? []) {
      if (thread.attachments.length >= MAX_ATTACHMENTS) break;
      if (!thread.attachments.some(existing => existing.path === item.path)) thread.attachments.push(item);
    }
    saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
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
    if (ws) {
      ws.attachments = ws.attachments.filter((item: any) => item.path !== file);
      saveDraftSoon(ws.cwd, ws.activeThread.sessionFile, draftOf(ws.activeThread));
    }
  }

  /**
   * 从「最近项目」里移除。
   *
   * 主进程会同时撤销该目录的授权，所以这里必须把本地工作区一起丢掉：
   * 否则后续任何一次会话刷新都会报「项目目录尚未获得授权」，界面上刷出一片错误提示。
   */
  async function forget(cwd: string): Promise<void> {
    const ws = findWorkspace(cwd);
    const target = ws?.cwd ?? cwd;
    state.recent = await host.forget(cwd);
    if (!ws) return;
    workspaces.delete(target);
    const refresh = sessionRefreshes.get(ws);
    if (refresh?.timer) clearTimeout(refresh.timer);
    sessionRefreshes.delete(ws);
    if (projectPathKey(state.activeCwd) === projectPathKey(target)) {
      const remaining = [...workspaces.values()].find((item: any) => item.status === "ready");
      state.activeCwd = remaining?.cwd ?? [...workspaces.keys()][0] ?? "";
      bus.emit("workspace:switched", { cwd: state.activeCwd });
    }
    bus.emit("workspace:removed", { cwd: target });
  }

  async function removeProject(cwd: string, { deleteSessions = false }: { deleteSessions?: boolean } = {}): Promise<any> {
    const ws = findWorkspace(cwd);
    const target = ws?.cwd ?? cwd;
    if (ws?.hasAnyRunning) throw new Error("该项目有任务正在运行，请先停止");
    if (!(await beforeRemoveWorkspace(target))) {
      return { cancelled: true, recent: state.recent, deleted: 0, failed: 0 };
    }
    const result = await host.removeProject(target, { deleteSessions });
    workspaces.delete(target);
    state.recent = result.recent;
    if (projectPathKey(state.activeCwd) === projectPathKey(target)) {
      const next = [...workspaces.keys()][0] ?? "";
      state.activeCwd = next;
      bus.emit("workspace:switched", { cwd: next });
    }
    bus.emit("workspace:removed", { cwd: target });
    return result;
  }

  function reveal(target: string): Promise<void> {
    return host.reveal(target);
  }

  async function deleteSession(cwd: string, file: string): Promise<any[]> {
    const ws = findWorkspace(cwd);
    const target = ws?.cwd ?? cwd;
    const sessions = await host.deleteSession(target, file);
    clearComposerDraft(target, file);
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
    bus.emit("session:deleted", { cwd: target, file });
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

  /**
   * Pi 本体换了（升级 / 换了手动路径）之后让空闲工作区重新拉起进程。
   *
   * 工作区里的 `pi` 进程是启动时拉起的，不重启就一直在用旧版本：提示里写着
   * 「已更新到 0.9.1」，实际会话还是旧行为，看起来像升级没生效。
   * 正在输出的工作区不动（重启会打断它），由调用方告知用户稍后生效。
   */
  async function restartIdleWorkspaces(): Promise<{ restarted: number; skipped: number }> {
    const list = [...workspaces.values()].filter((ws) => ws.status === "ready");
    const idle = list.filter((ws) => !ws.streaming);
    for (const ws of idle) await restart(ws);
    return { restarted: idle.length, skipped: list.length - idle.length };
  }

  function setSidebarWidth(value: number, persist = true): number {
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.sidebarWidth;
    state.sidebarWidth = Math.round(width);
    if (persist) writeStorage(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    return state.sidebarWidth;
  }

  function setPanelWidth(value: number, persist = true): number {
    const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.panelWidth;
    state.panelWidth = Math.round(width);
    if (persist) writeStorage(PANEL_WIDTH_KEY, String(state.panelWidth));
    return state.panelWidth;
  }

  function setStageWidth(value: number, persist = true): number {
    const width = Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.stageWidth;
    state.stageWidth = Math.round(width);
    if (persist) writeStorage(EDITOR_WIDTH_KEY, String(state.stageWidth));
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
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    // 绑定发送 RPC 时的会话；等待期间切换到另一个会话不能改错线程。
    const file = ws.sessionFile;
    const thread = ensureThread(ws, file);
    await rpc(ws.cwd, "setSessionName", [name], file);
    thread.sessionName = name.replace(/[\r\n]+/g, " ").trim();
    updateSessionTitle(ws, thread);
    await refreshSessions(ws);
  }

  function updateSessionTitle(ws: WorkspaceState, thread: SessionThreadState): void {
    // 即时更新侧栏与顶部标题，无需等待后端刷新
    ws.sessions = applySessionName(ws.sessions, thread.sessionFile, thread.sessionName);
  }

  async function refreshSessions(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws || disposed || workspaces.get(ws.cwd) !== ws) return;
    const previous = sessionRefreshes.get(ws) ?? {
      timer: null,
      running: null,
      dirty: false,
      generation: 0,
      backoff: { streak: 0 },
      lastDone: 0,
    };
    const generation = ++previous.generation;
    sessionRefreshes.set(ws, previous);
    if (previous.running) {
      previous.dirty = true;
      await previous.running;
      return;
    }
    const request = host.sessions(ws.cwd).then((sessions) => {
      // 文件中的最新名称是权威来源，不能用旧线程名称覆盖外部 CLI 的重命名。
      if (!disposed && generation === previous.generation && workspaces.get(ws.cwd) === ws) ws.sessions = sessions;
    }).catch(() => {
      // Session refresh is advisory; the active transcript remains usable when the host is unavailable.
    }).finally(() => {
      previous.running = null;
      previous.lastDone = Date.now();
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
    const previous = sessionRefreshes.get(ws) ?? {
      timer: null,
      running: null,
      dirty: false,
      generation: 0,
      backoff: { streak: 0 },
      lastDone: 0,
    };
    sessionRefreshes.set(ws, previous);
    previous.dirty = true;
    if (previous.timer !== null || previous.running) return;
    // 不再用 0ms 重排：事件密集时会变成「刷新 → 写回 → 再刷新」的自旋。
    const step = nextRefreshDelay(Date.now(), previous.backoff, previous.lastDone);
    previous.backoff = step.state;
    const schedule = typeof window !== "undefined" ? window.setTimeout : setTimeout;
    previous.timer = schedule(() => {
      previous.timer = null;
      if (disposed || workspaces.get(ws.cwd) !== ws || !previous.dirty) return;
      previous.dirty = false;
      void refreshSessions(ws);
    }, step.delay) as unknown as number;
  }

  function listSessions(cwd: string): Promise<any[]> {
    const ws = findWorkspace(cwd);
    if (ws?.status === "ready") return Promise.resolve(ws.sessions);
    return host.sessions(ws?.cwd ?? cwd);
  }

  async function openSession(cwd: string, file: string): Promise<void> {
    const ws = await open(cwd);
    if (file && ws?.status === "ready") await switchSession(file);
  }

  /**
   * 跨项目会话列表（只读，最多 40 条）。
   * 「@ 引用其它项目对话」插件用它填候选；主进程侧有 3 秒缓存，反复查询不会扫盘。
   */
  async function crossProjectSessions(limit = 40): Promise<any[]> {
    if (!host?.crossProjectSessions) return [];
    try {
      const list = await host.crossProjectSessions(limit);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /**
   * 读取子代理自己的会话记录（只读），用于弹窗里展示它的对话。
   * 子代理会话文件由扩展写在本项目会话目录下的嵌套目录里；读不到时返回空数组，
   * 调用方退回展示最终输出，不要因此报错打断阅读。
   */
  async function readAgentSession(sessionFile: string): Promise<any[]> {
    const ws = active.value;
    if (!ws || !sessionFile) return [];
    try {
      const page = await host.messagePage(ws.cwd, sessionFile, 0, AGENT_SESSION_LIMIT, 0);
      return Array.isArray(page?.messages) ? page.messages : [];
    } catch {
      return [];
    }
  }

  /** 向上加载一页更早的历史消息（同时写入 transcript） */
  async function loadMoreMessages(
    cwd: string,
    sessionFile: string,
    limit: number = PAGE_SIZE,
  ): Promise<{ loaded: number; startIndex: number; total: number }> {
    const ws = findWorkspace(cwd);
    const thread = ws ? ensureThread(ws, sessionFile) : null;
    if (!thread || thread.loadingMore || thread.historyStart <= 0) {
      return { loaded: 0, startIndex: thread?.historyStart ?? 0, total: thread?.messageTotal ?? 0 };
    }
    thread.loadingMore = true;
    try {
      const page = await host.messagePage(ws!.cwd, sessionFile, thread.historyStart, limit, 0, PAGE_MIN_BLOCKS);
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

  const pendingNewSessions = new Map<string, Promise<void>>();
  /** 会话切换期间阻止统计等 RPC 抢在 worker 切换完成前使用新文件。 */
  const pendingSessionSwitches = new Map<string, Promise<void>>();

  async function call(method: string, ...args: any[]): Promise<any> {
    let current = active.value;
    if (!current) throw new Error("没有打开的工作区");
    // 只在确实有新建 / 切换流程时等待。空闲时不能 await（哪怕已 resolve 的
    // Promise 也会让出微任务），否则等待期间刚开始的切换会把新文件暴露给宿主。
    for (let guard = 0; guard < 8; guard += 1) {
      const pending = pendingNewSessions.get(current.cwd) ?? pendingSessionSwitches.get(current.cwd);
      if (!pending) break;
      await pending.catch(() => {});
      current = active.value ?? current;
    }
    const ws = active.value;
    if (!ws) throw new Error("没有打开的工作区");
    return rpc(ws.cwd, method, args, ws.sessionFile);
  }

  async function send(text: string, { mode }: { mode?: string } = {}): Promise<boolean> {
    const ws = active.value;
    const message = text.trim();
    if (!ws || (!message && !ws.attachments.length)) return false;
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    const attachmentSnapshot = [...thread.attachments];
    const behavior = thread.streaming ? (mode ?? "followUp") : undefined;
    let accepted = false;
    let optimisticId = "";
    try {
      // 会话引用和文件附件走不同的准备入口：会话在项目目录之外，且内容是压缩过的摘��。
      const filePaths = attachmentSnapshot.filter((item: any) => item.kind !== "session").map((item: any) => item.path);
      // 用户改过上下文的会话引用不再重新生成，直接用它保存的文本（格式与主进程一致）。
      const sessionAttachments = attachmentSnapshot.filter((item: any) => item.kind === "session");
      const customSessions = sessionAttachments.filter((item: any) => typeof item.customText === "string" && item.customText.trim());
      const sessionPaths = sessionAttachments
        .filter((item: any) => !customSessions.includes(item))
        .map((item: any) => item.path);
      const [preparedFiles, preparedSessions] = await Promise.all([
        filePaths.length ? host.prepareAttachments(ws.cwd, filePaths) : Promise.resolve({ text: "", images: [] as any[], items: [] as any[] }),
        sessionPaths.length ? host.prepareSessionAttachments(ws.cwd, sessionPaths) : Promise.resolve({ text: "", images: [] as any[], items: [] as any[] }),
      ]);
      const customSessionText = buildCustomSessionBlocks(customSessions as any[]);
      const sessionText = [customSessionText, preparedSessions.text].filter(Boolean).join("\n");
      const prepared = {
        sessionText,
        fileText: preparedFiles.text,
        text: [sessionText, preparedFiles.text].filter(Boolean).join("\n"),
        images: preparedFiles.images,
        // 改过上下文的引用主进程不会再回传条目，这里用快照里的那份（保留名称与条数）
        items: [
          ...customSessions.map((item: any) => ({ ...item, image: false, inlined: true })),
          ...(preparedSessions.items ?? []),
          ...(preparedFiles.items ?? []),
        ],
      };
      // 用主进程回传的附件状态（大小 / 是否内联）做乐观渲染，保证并发送前看到的一致。
      // 引导（steering）与追加（followUp）也必须立即插入：它们同样会写进会话文件，
      // 之前只在非流式时渲染，导致「发出去看不到、重开会话才出现」。
      const items = prepared.items?.length ? prepared.items : attachmentSnapshot;
      const imageFiles = items.filter((item: any) => item.image);
      const imageItems = imageFiles
        .filter((item: any) => item.data)
        .map((item: any) => ({ mimeType: String(item.mimeType ?? "image/png"), data: item.data as string }));
      const files = items
        .filter((item: any) => !item.image)
        .map((item: any) => ({
          path: String(item.path),
          name: String(item.name),
          kind: item.kind === "session" ? "session" as const : item.kind === "folder" ? "folder" as const : "file" as const,
          size: typeof item.size === "number" ? item.size : undefined,
          inlined: typeof item.inlined === "boolean" ? item.inlined : undefined,
          messages: typeof item.messages === "number" ? item.messages : undefined,
        }));
      // 先拼出真正要发的提示词：Pi 的排队列表里存的是它，气泡靠它去重。
      const prompt = composePrompt({ sessionText: prepared.sessionText, fileText: prepared.fileText, message });
      optimisticId = thread.transcript.pushUser(
        message,
        imageFiles.length,
        { imageItems, attachments: files, queueText: prompt },
      ).id;
      thread.loaded = true;
      if (!behavior) thread.streaming = true;
      // 只移除本次发送快照；准备期间新加的附件留给下一条消息。
      const sentPaths = new Set(attachmentSnapshot.map(item => item.path));
      thread.attachments = thread.attachments.filter(item => !sentPaths.has(item.path));
      saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
      const disposition = await rpc(ws.cwd, "prompt", [prompt, prepared.images, behavior], targetSessionFile);
      accepted = true;
      if (disposition === "handled") {
        thread.streaming = false;
        await reload(ws, targetSessionFile);
      }
      await refreshSessions(ws);
      return true;
    } catch (error: any) {
      if (!accepted && !behavior) thread.streaming = false;
      if (!accepted) {
        // 未送达：撤回乐观消息并恢复附件，让用户可以改完再发
        if (optimisticId) thread.transcript.removeBlock(optimisticId);
        thread.attachments = [...attachmentSnapshot, ...thread.attachments.filter(item => !attachmentSnapshot.some(sent => sent.path === item.path))].slice(0, MAX_ATTACHMENTS);
        saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
      }
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return accepted;
    }
  }

  /**
   * 把「还在队列里的提示词」对应的乐观气泡删掉（从后往前找）。
   *
   * 撤回 / 停止 / 改投递方式都走这里：这些气泡从没真正发出去，队列一清就必须一起消失，
   * 否则界面上会留下一条「看起来已经发过」的消息，文字还会同时回到输入框。
   *
   * 按**出现次数**删：同一句话可以排队两次，两条气泡都得收回去。
   */
  function removeQueuedBlocks(thread: { blocks: TranscriptBlock[]; transcript: { removeBlock: (id: string) => void } }, prompts: string[]): void {
    const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
    const budget = new Map<string, number>();
    for (const prompt of prompts) {
      const key = normalize(prompt);
      if (!key) continue;
      budget.set(key, (budget.get(key) ?? 0) + 1);
    }
    if (!budget.size) return;
    for (let index = thread.blocks.length - 1; index >= 0; index -= 1) {
      const block = thread.blocks[index];
      if (!block || block.kind !== "user") continue;
      const key = normalize(block.queueText ?? "");
      const left = budget.get(key) ?? 0;
      if (!left) continue;
      budget.set(key, left - 1);
      thread.transcript.removeBlock(block.id);
    }
  }

  async function stop(): Promise<string> {
    const ws = active.value;
    if (!ws) return "";
    const pending = pendingNewSessions.get(ws.cwd);
    if (pending) await pending.catch(() => {});
    const targetSessionFile = ws.sessionFile;
    const thread = ensureThread(ws, targetSessionFile);
    const queued = await rpc(ws.cwd, "clearQueue", [], targetSessionFile);
    await rpc(ws.cwd, "abort", [], targetSessionFile);
    const prompts = [...(queued?.steering ?? []), ...(queued?.followUp ?? [])].map(String);
    // 队列被清空后 planQueuedFlush 会把残留的气泡当成「刚发出去」挪到末尾，
    // 所以先删掉它们，再同步队列状态。
    removeQueuedBlocks(thread, prompts);
    applyQueue(thread, { steering: [], followUp: [] });
    // 回填输入框的只有人写的那部分：附件块原样留在会话里，别把 XML 塞进输入框。
    return prompts
      .map((prompt) => queueDraftText(prompt))
      .filter(Boolean)
      .join("\n");
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

    // 在暴露临时文件之前先占住闸门：同步触发的统计请求也必须等真实会话落位。
    let releaseNewSession!: () => void;
    const newSessionGate = new Promise<void>((resolve) => {
      releaseNewSession = resolve;
    });
    pendingNewSessions.set(ws.cwd, newSessionGate);

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
          // 新会话的临时文件名只在内存里出现过，草稿要迁移到真实会话键上。
          if (tempThread.draft) {
            clearComposerDraft(ws.cwd, tempFile);
            writeComposerDraft(ws.cwd, realFile, draftOf(tempThread));
          }
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
        if (pendingNewSessions.get(ws.cwd) === newSessionGate) pendingNewSessions.delete(ws.cwd);
        releaseNewSession();
      }
    })();

    return task;
  }

  async function switchSession(file: string): Promise<void> {
    let ws = active.value;
    if (!ws || !file || normalizeThreadKey(file) === normalizeThreadKey(ws.sessionFile)) return;
    const pendingNew = pendingNewSessions.get(ws.cwd);
    if (pendingNew) await pendingNew.catch(() => {});
    const pendingSwitch = pendingSessionSwitches.get(ws.cwd);
    if (pendingSwitch) await pendingSwitch.catch(() => {});
    ws = active.value;
    if (!ws || normalizeThreadKey(file) === normalizeThreadKey(ws.sessionFile)) return;

    // 乐观切换会立刻改写 ws.sessionFile；先设闸门，统计等 RPC 才不会
    // 拿着尚未在宿主注册的文件去调用。
    let releaseSwitch!: () => void;
    const switchGate = new Promise<void>((resolve) => {
      releaseSwitch = resolve;
    });
    pendingSessionSwitches.set(ws.cwd, switchGate);
    try {
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

        if (alreadyLoaded && res?.reusedWorker && targetThread?.streaming && targetThread.historyStart >= 0) {
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
    } finally {
      if (pendingSessionSwitches.get(ws.cwd) === switchGate) pendingSessionSwitches.delete(ws.cwd);
      releaseSwitch();
    }
  }

  /**
   * 撤回还排在 Pi 队列里的消息：清空队列，并把对应的乐观气泡删掉
   * （它们并没有真正发出去，留着会让人以为已经发出）。返回放回输入框的文字。
   */
  /**
   * 更新队列状态，并把「已经离开队列」的乐观气泡挪到时间线末尾。
   *
   * 排队期间气泡是隐藏的，但位置停在入队那一刻（上一轮输出还在它下面继续追加），
   * 发出后重新显示就会插在中间。这里统一在队列变化后把这类气泡挪到最后。
   */
  function applyQueue(thread: { queue: { steering: string[]; followUp: string[] }; blocks: TranscriptBlock[]; transcript: { moveBlockToEnd: (id: string) => boolean } }, next: { steering?: string[]; followUp?: string[] }): void {
    const queue = { steering: [...(next.steering ?? [])], followUp: [...(next.followUp ?? [])] };
    const previous = thread.queue;
    thread.queue = queue;
    for (const id of planQueuedFlush(thread.blocks, previous, queue)) thread.transcript.moveBlockToEnd(id);
  }

  /**
   * 撤回单条排队消息。
   *
   * Pi 的队列只能整体清空（clearQueue 返回全部文本），所以先清空、再把其余消息
   * 按原顺序重新入队、最后删掉这一条的乐观气泡。重新入队失败时把内容放回输入框，
   * 不能把用户排队的话弄丢。
   */
  async function withdrawQueued(target: {
    mode: "steer" | "followUp";
    text: string;
  }): Promise<{ ok: boolean; draft: string }> {
    const ws = active.value;
    if (!ws || !target?.text) return { ok: false, draft: "" };
    const thread = ws.activeThread;
    const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
    const cleared = await rpc(ws.cwd, "clearQueue", [], thread.sessionFile);
    const current = {
      steering: [...(cleared?.steering ?? [])],
      followUp: [...(cleared?.followUp ?? [])],
    };
    const planned = planQueueWithdraw(current, target);
    // 其余排队消息可能各自带图片，撤回一条时同样要按提示词带回去
    const imagesByPrompt = queueImagesByPrompt(thread.blocks as any[]);
    try {
      for (const text of planned.steering) {
        await rpc(ws.cwd, "steer", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
      for (const text of planned.followUp) {
        await rpc(ws.cwd, "followUp", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
    } catch (error: any) {
      applyQueue(thread, current);
      bus.emit("notify", {
        level: "error",
        text: `撤回失败，其余排队消息已保留：${error?.message ?? String(error)}`,
      });
      return { ok: false, draft: "" };
    }
    applyQueue(thread, planned);
    // 撤回 = 拿回来改：文字回填输入框（附件标记不进去，只回人写的那部分）
    removeQueuedBlocks(thread, [target.text]);
    return { ok: true, draft: queueDraftText(target.text) };
  }

  /**
   * 换一条排队消息的投递方式（排队 ↔ 引导）。
   *
   * 和撤回 / 编辑同一套做法：Pi 只能整体 clearQueue，所以清空后按新分组重新入队。
   * 顺序规则见 planQueueMode：目标列追加到末尾，多次改动不会打乱各自队列的先后。
   * 改成「引导」会立刻插进正在进行的回合；改成「排队」则等这一轮结束再发——
   * 这个时机由 Pi 的两条 RPC 决定，界面只负责把状态同步回来。
   */
  async function changeQueuedMode(
    target: { mode: "steer" | "followUp"; text: string },
    mode: "steer" | "followUp",
  ): Promise<boolean> {
    const ws = active.value;
    if (!ws || !target?.text) return false;
    const thread = ws.activeThread;
    const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
    const cleared = await rpc(ws.cwd, "clearQueue", [], thread.sessionFile);
    const current = {
      steering: [...(cleared?.steering ?? [])],
      followUp: [...(cleared?.followUp ?? [])],
    };
    // 书写顺序：气泡在时间线上的先后，就是用户写下它们的先后。
    // 换成排队时要按这个顺序插回去，否则「先写的话」会排到「后写的话」后面发。
    const rank = new Map<string, number>();
    thread.blocks.forEach((block, index) => {
      if (block.kind !== "user") return;
      const key = normalize(block.queueText ?? "");
      if (key && !rank.has(key)) rank.set(key, index);
    });
    const { queue: planned, changed } = planQueueMode(current, target, mode, rank);
    if (!changed) {
      // 队列里已经没有这条（比如刚被取走发出去）：把最新状态同步回来即可
      applyQueue(thread, current);
      return false;
    }
    const imagesByPrompt = queueImagesByPrompt(thread.blocks as any[]);
    try {
      for (const text of planned.steering) {
        await rpc(ws.cwd, "steer", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
      for (const text of planned.followUp) {
        await rpc(ws.cwd, "followUp", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
    } catch (error: any) {
      applyQueue(thread, current);
      bus.emit("notify", {
        level: "error",
        text: `改投递方式失败，队列已还原：${error?.message ?? String(error)}`,
      });
      return false;
    }
    applyQueue(thread, planned);
    return true;
  }

  /**
   * 拖拽调整整个待发送队列的顺序。
   *
   * 和撤回 / 换投递方式同一套：Pi 只能整体 clearQueue，所以清空后按新顺序重新入队
   * （引导按顺序 steer、排队按顺序 followUp）。跨组拖拽时那一条的投递方式已经由
   * planQueueMove 改好，这里只按队列落实。
   *
   * 以 Pi 的真实队列为准过滤：已被取走发出去的不会又被塞回去；
   * 队列里有但顺序里没出现的（竞态）接在后面，宁可顺序差一点也不能丢消息。
   */
  async function reorderQueued(order: QueuedEntry[]): Promise<boolean> {
    const ws = active.value;
    if (!ws || !order?.length) return false;
    const thread = ws.activeThread;
    const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
    // 顺序就是当前队列：不用惊动 Pi（省一次 clearQueue + 整队重新入队）
    if (sameQueue(queueFromOrder(order), thread.queue)) return false;
    let cleared: { steering?: string[]; followUp?: string[] } | null = null;
    try {
      cleared = await rpc(ws.cwd, "clearQueue", [], thread.sessionFile);
    } catch (error: any) {
      bus.emit("notify", { level: "error", text: `调整顺序失败：${error?.message ?? String(error)}` });
      return false;
    }
    const current = {
      steering: [...(cleared?.steering ?? [])],
      followUp: [...(cleared?.followUp ?? [])],
    };
    const planned = resolveQueueOrder(current, order);
    if (sameQueue(current, planned)) {
      applyQueue(thread, current);
      return false;
    }
    const imagesByPrompt = queueImagesByPrompt(thread.blocks as any[]);
    try {
      for (const text of planned.steering) {
        await rpc(ws.cwd, "steer", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
      for (const text of planned.followUp) {
        await rpc(ws.cwd, "followUp", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
    } catch (error: any) {
      applyQueue(thread, current);
      bus.emit("notify", {
        level: "error",
        text: `调整顺序失败，队列已还原：${error?.message ?? String(error)}`,
      });
      // 还原后把「已被清空」的队列重新排回去，别让用户看着空队列
      try {
        for (const text of current.steering) {
          await rpc(ws.cwd, "steer", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
        }
        for (const text of current.followUp) {
          await rpc(ws.cwd, "followUp", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
        }
      } catch {
        // 还原也失败：把真实状态同步回来即可
      }
      applyQueue(thread, current);
      return false;
    }
    applyQueue(thread, planned);
    return true;
  }

  async function recallQueued(): Promise<string> {
    const ws = active.value;
    if (!ws) return "";
    const thread = ws.activeThread;
    const queued = await rpc(ws.cwd, "clearQueue", [], thread.sessionFile);
    const texts: string[] = [...(queued?.steering ?? []), ...(queued?.followUp ?? [])];
    applyQueue(thread, { steering: [], followUp: [] });
    if (texts.length) {
      const wanted = new Set(texts.map((text) => String(text ?? "").replace(/\r\n/g, "\n").trim()));
      for (const block of [...thread.blocks]) {
        if (block.kind !== "user") continue;
        const key = String(block.queueText ?? block.text ?? "").replace(/\r\n/g, "\n").trim();
        if (wanted.has(key)) thread.transcript.removeBlock(block.id);
      }
    }
    return texts.map((text) => queueDraftText(text)).filter(Boolean).join("\n");
  }

  /**
   * 编辑排队中的消息。
   *
   * Pi 的队列只能整体清空（clearQueue 返回全部文本），没有「删掉其中一条」。
   * 所以做法是：清空 → 按原顺序把其余消息重新入队 → 目标消息用新文字替换。
   * 重新入队失败时把内容放回输入框，绝不能把用户排队的话弄丢。
   */
  /**
   * 编辑一条排队中的消息。
   *
   * `message` 是用户写的话（不含附件标记）；附件标记永远从原提示词里原样保留，
   * 所以不会出现「气泡上多一条 [文件: …]」这种重复路径。
   * `addPaths` 是编辑框里新粘贴的附件，会重新 prepare 后追加到提示词末尾。
   */
  async function editQueued(
    target: { mode: "steer" | "followUp"; text: string },
    next: string | { message: string; keepPaths?: string[]; addPaths?: string[] },
  ): Promise<boolean> {
    const ws = active.value;
    const request = typeof next === "string" ? { message: next } : (next ?? { message: "" });
    const message = String(request.message ?? "").replace(/\r\n/g, "\n").trim();
    const addPaths = (request.addPaths ?? []).filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (!ws || !target?.text) return false;
    if (!message && !addPaths.length) return false;
    const thread = ws.activeThread;
    const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
    const wanted = normalize(target.text);
    const block = thread.blocks.find(
      (item) => item.kind === "user" && normalize(item.queueText ?? "") === wanted,
    );

    // 新粘贴的图片：重新 prepare 一次，既拿到 <file> 标记，也拿到给模型的 base64
    let addedText = "";
    let addedImages: Array<{ mimeType: string; data: string }> = [];
    if (addPaths.length && host?.prepareAttachments) {
      const prepared = await host.prepareAttachments(ws.cwd, addPaths);
      addedText = String(prepared?.text ?? "");
      addedImages = (prepared?.items ?? [])
        .filter((item: any) => item?.image && item?.data)
        .map((item: any) => ({ mimeType: String(item.mimeType ?? "image/png"), data: String(item.data) }));
    }
    const nextPrompt = rebuildPrompt(target.text, message, request.keepPaths, addedText);
    if (!nextPrompt.trim()) return false;

    const cleared = await rpc(ws.cwd, "clearQueue", [], thread.sessionFile);
    const current = {
      steering: [...(cleared?.steering ?? [])],
      followUp: [...(cleared?.followUp ?? [])],
    };
    const planned = planQueueEdit(current, target, nextPrompt);
    // 图片是单独一组数据（steer(message, images)），clearQueue 只回文本：
    // 重新入队时必须按提示词把各自的图片带回去，否则图片丢；也不能全塞同一组，否则会重复。
    const imagesByPrompt = queueImagesByPrompt(thread.blocks as any[]);
    const keptImages = imagesByPrompt[normalize(target.text)] ?? [];
    const nextImages = [...keptImages, ...addedImages];
    if (nextImages.length) imagesByPrompt[normalize(nextPrompt)] = nextImages;
    const images = block?.imageItems as Array<{ mimeType: string; data: string }> | undefined;
    try {
      for (const text of planned.steering) {
        await rpc(ws.cwd, "steer", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
      for (const text of planned.followUp) {
        await rpc(ws.cwd, "followUp", [text, imagesByPrompt[normalize(text)]], thread.sessionFile);
      }
    } catch (error: any) {
      // 重新入队失败：把没排上的内容交回输入框，并刷新队列状态
      applyQueue(thread, { steering: [], followUp: [] });
      bus.emit("notify", {
        level: "error",
        text: `排队消息重新提交失败，内容已放回输入框：${error?.message ?? String(error)}`,
      });
      return false;
    }
    if (block) {
      block.text = message;
      block.queueText = nextPrompt;
      if (addedImages.length) block.imageItems = [...(block.imageItems ?? []), ...addedImages];
      block.images = block.imageItems?.length ?? block.images;
    }
    applyQueue(thread, planned);
    saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
    return true;
  }

  /**
   * 编辑排队消息时粘贴图片：先落到磁盘，返回路径给编辑框当附件标签。
   * 真正的标记与 base64 在保存（editQueued）时由 prepareAttachments 统一生成。
   */
  async function stagePastedAttachment(payload: {
    name?: string;
    mimeType?: string;
    data: string;
  }): Promise<{ path: string; name: string } | null> {
    if (!host?.savePastedImage) throw new Error("当前环境不支持粘贴图片");
    const file = await host.savePastedImage(payload);
    if (!file) throw new Error("剪贴板图片保存失败");
    const name = file.split(/[\\/]/).filter(Boolean).at(-1) ?? file;
    return { path: file, name };
  }

  /** 重新生成某个会话引用的自动上下文（编辑框里「恢复自动」用）。 */
  async function previewSessionQuote(file: string): Promise<{ text: string; title: string }> {
    const ws = active.value;
    if (!ws || !file) return { text: "", title: "" };
    const prepared = await host.prepareSessionAttachments(ws.cwd, [file]);
    return {
      // 只回正文：外层 <session> 由发送时按同样格式重新拼，避免套娃
      text: extractSessionBody(String(prepared?.text ?? "")),
      title: String(prepared?.items?.[0]?.name ?? ""),
    };
  }

  /** 修改会话引用：改名或改写上下文正文（正文为 null 表示恢复自动摘要）。 */
  function setSessionQuote(file: string, patch: { name?: string; customText?: string | null }): boolean {
    const ws = active.value;
    if (!ws || !file) return false;
    const thread = ws.activeThread;
    const item = thread.attachments.find((entry: any) => entry.kind === "session" && entry.path === file);
    if (!item) return false;
    if (typeof patch.name === "string" && patch.name.trim()) item.name = patch.name.trim();
    if (patch.customText === null) delete (item as any).customText;
    else if (typeof patch.customText === "string" && patch.customText.trim()) item.customText = patch.customText;
    saveDraftSoon(ws.cwd, thread.sessionFile, draftOf(thread));
    return true;
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
    writeStorage(THEME_KEY, id);
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
  /** 调整运行日志总量上限（设置页用）。 */
  async function setLogLimit(bytes: number): Promise<void> {
    try {
      await host?.setLogLimit?.(bytes);
    } catch {
      // 日志上限调整失败不影响使用
    }
  }

  async function checkAppUpdate(options: { manual?: boolean } = {}): Promise<{
    current: string;
    latest: string;
    updateAvailable: boolean;
    url: string;
    error?: string;
  }> {
    const current = state.appUpdate;
    if (!host?.checkAppUpdate || current.checking) {
      return { current: current.current, latest: current.latest, updateAvailable: current.updateAvailable, url: current.url };
    }
    state.appUpdate.checking = true;
    try {
      const result = await host.checkAppUpdate(options);
      state.appUpdate.current = result.current ?? "";
      state.appUpdate.latest = result.latest ?? "";
      state.appUpdate.updateAvailable = Boolean(result.updateAvailable);
      state.appUpdate.url = result.url ?? "";
      state.appUpdate.assetName = result.assetName ?? "";
      // 检查失败时不能把状态标成「已是最新」：以前会把限流/断网说成最新版本，
      // 结果用户以为没新版本，其实只是没查到。
      if (result.error) {
        state.appUpdate.error = result.error;
        bus.emit("notify", { level: "warning", text: `检查更新失败：${result.error}` });
      } else {
        state.appUpdate.error = "";
        state.appUpdate.phase = result.updateAvailable ? "available" : "idle";
        state.appUpdate.checkedAt = Date.now();
        if (result.updateAvailable) {
          bus.emit("notify", { level: "info", text: `Pi Desktop ${result.latest} 已发布，当前版本 ${result.current}` });
        }
      }
      return {
        current: state.appUpdate.current,
        latest: state.appUpdate.latest,
        updateAvailable: state.appUpdate.updateAvailable,
        url: state.appUpdate.url,
        error: state.appUpdate.error,
      };
    } catch (error: any) {
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
      return { current: current.current, latest: current.latest, updateAvailable: false, url: current.url };
    } finally {
      state.appUpdate.checking = false;
    }
  }

  /**
   * 下载更新安装包。`background` 表示是自动更新自己发起的：失败只提示一次警告，
   * 不要用红色错误 Toast 打断用户（他没点任何按钮）。
   */
  async function downloadAppUpdate(options: { background?: boolean } = {}): Promise<boolean> {
    if (!host?.downloadAppUpdate || state.appUpdate.phase === "downloading") return false;
    appUpdateCancelled = false;
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
      if (appUpdateCancelled) bus.emit("notify", { level: "info", text: "已取消下载更新" });
      else bus.emit("notify", {
        level: options.background ? "warning" : "error",
        text: `${options.background ? "自动更新下载失败：" : ""}${error?.message ?? String(error)}`,
      });
      appUpdateCancelled = false;
      return false;
    }
  }

  /** 取消正在进行的更新下载；后端只发中止信号，由下载 Promise 统一复位状态。 */
  function cancelAppUpdate(): boolean {
    if (!host?.cancelAppUpdate || state.appUpdate.phase !== "downloading") return false;
    appUpdateCancelled = true;
    const started = Boolean(host.cancelAppUpdate());
    if (started) state.appUpdate.phase = state.appUpdate.updateAvailable ? "available" : "idle";
    return started;
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
      // 记下更新范围：scope=all 时即使 Pi 本体没变，扩展包也可能被更新过，提示要能说清
      state.pi.lastUpdate = { from: result.from, to: result.to, at: Date.now(), log: result.log, scope: scope === "all" ? "all" : "self" };
      // 工作区里的 pi 进程是启动时拉起的：不重启就还在跑旧版本
      const refreshed = await restartIdleWorkspaces();
      const suffix = refreshed.skipped
        ? `（${refreshed.skipped} 个正在输出的任务会在本轮结束后才用上新版本）`
        : "";
      // from === to 只说明「Pi 本体没变」：scope=all 时扩展包可能刚被更新过，
      // 只说「无需更新」会把这件事整个吞掉（措辞见 shared/pi-update.ts）。
      const text = piUpdateToast(
        { from: result.from, to: result.to, scope: scope === "all" ? "all" : "self" },
        state.pi.version,
      );
      bus.emit("notify", { level: "info", text: result.from === result.to ? text : `${text}${suffix}` });
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
    chooseDirectory,
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
    gitBranches,
    gitInspect,
    gitAction,
    gitWorktrees,
    cloneRepository,
    createGitWorktree,
    removeGitWorktree,
    completePaths,
    addFiles,
    addSessionAttachment,
    recallQueued,
    withdrawQueued,
    changeQueuedMode,
    reorderQueued,
    editQueued,
    stagePastedAttachment,
    previewSessionQuote,
    setSessionQuote,
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
    restartIdleWorkspaces,
    renameSession,
    notice,
    refreshSessions,
    listSessions,
    openSession,
    readAgentSession,
    crossProjectSessions,
    loadMoreMessages,
    call,
    send,
    stop,
    newSession,
    switchSession,
    refreshPi,
    checkPiUpdate,
    checkAppUpdate,
    setLogLimit,
    downloadAppUpdate,
    cancelAppUpdate,
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
