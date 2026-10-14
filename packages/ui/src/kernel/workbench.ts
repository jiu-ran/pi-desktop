import { computed, reactive, shallowReactive, toRaw } from "vue";
import { createTranscript, type TranscriptBlock } from "./transcript.ts";
import type { EventBus } from "./event-bus.ts";

const THEME_KEY = "pi-desktop.theme";
const SIDEBAR_WIDTH_KEY = "pi-desktop.sidebar-width";
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const PANEL_WIDTH_KEY = "pi-desktop.panel-width";
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 520;
const EDITOR_WIDTH_KEY = "pi-desktop.editor-width";
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MAX_WIDTH = 900;

export interface OpenEditorFile {
  path?: string;
  relative: string;
  name: string;
  content: string;
  draft: string;
  savedContent: string;
  size?: number;
  loading: boolean;
  error: string;
  dirty: boolean;
}

export interface WorkspaceState {
  cwd: string;
  name: string;
  status: "idle" | "starting" | "ready" | "error";
  error: string;
  model: any;
  models: any[];
  levels: string[];
  thinking: string;
  streaming: boolean;
  compacting: boolean;
  sessionFile: string;
  sessionName: string;
  branch: string;
  sessions: any[];
  commands: any[];
  queue: { steering: string[]; followUp: string[] };
  usage: any;
  blocks: TranscriptBlock[];
  transcript: ReturnType<typeof createTranscript>;
  draft: string;
  attachments: any[];
}

function savedWidth(key: string, min: number, max: number, fallback: number): number {
  const value = Number(localStorage.getItem(key));
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
    pi: { found: false, version: "", checked: false },
    recent: [] as string[],
    activeCwd: "",
    theme: localStorage.getItem(THEME_KEY) || "dark",
    activeSidebar: "tasks",
    sidebarOpen: true,
    sidebarWidth: savedSidebarWidth(),
    panelWidth: savedWidth(PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 380),
    editorWidth: savedWidth(EDITOR_WIDTH_KEY, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH, 560),
    activePanels: [] as string[],
    openFiles: [] as OpenEditorFile[],
    activeFile: "",
    paletteOpen: false,
  });

  const workspaces = shallowReactive(new Map<string, WorkspaceState>());

  function makeWorkspace(cwd: string): WorkspaceState {
    const transcript = createTranscript(reactive as any);
    return reactive<WorkspaceState>({
      cwd,
      name: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
      status: "idle",
      error: "",
      model: null,
      models: [],
      levels: [],
      thinking: "off",
      streaming: false,
      compacting: false,
      sessionFile: "",
      sessionName: "",
      branch: "",
      sessions: [],
      commands: [],
      queue: { steering: [], followUp: [] },
      usage: null,
      blocks: transcript.blocks,
      transcript,
      draft: "",
      attachments: [],
    });
  }

  const active = computed<WorkspaceState | null>(() => workspaces.get(state.activeCwd) ?? null);

  function rpc(cwd: string, method: string, args: any[] = []): Promise<any> {
    return host.call(cwd, method, plainArgs(args));
  }

  function applySnapshot(ws: WorkspaceState, snap: any): void {
    ws.model = snap.state.model ?? null;
    ws.thinking = snap.state.thinkingLevel ?? "off";
    ws.streaming = Boolean(snap.state.isStreaming);
    ws.compacting = Boolean(snap.state.isCompacting);
    ws.sessionFile = snap.state.sessionFile ?? "";
    ws.sessionName = snap.state.sessionName ?? "";
    ws.models = snap.models ?? [];
    ws.levels = snap.levels ?? [];
    ws.sessions = snap.sessions ?? [];
    ws.commands = snap.commands ?? [];
    ws.branch = snap.branch ?? "";
    ws.transcript.loadMessages(snap.messages ?? []);
  }

  async function init(): Promise<void> {
    if (!host) {
      state.pi = { found: false, version: "", checked: true };
      return;
    }
    host.onEvent(({ cwd, event }: { cwd: string; event: any }) => {
      const ws = workspaces.get(cwd);
      if (!ws) return;
      routeEvent(ws, event);
      bus.emit("pi:event", { cwd, event, workspace: ws });
    });
    const [pi, recent] = await Promise.all([
      host.locate().catch(() => ({ found: false, version: "" })),
      host.recent().catch(() => [] as string[]),
    ]);
    state.pi = { ...pi, checked: true };
    state.recent = recent;
    if (pi.found && recent[0]) open(recent[0]);
  }

  function routeEvent(ws: WorkspaceState, event: any): void {
    ws.transcript.applyEvent(event);
    switch (event.type) {
      case "agent_start":
        ws.streaming = true;
        break;
      case "agent_settled":
        ws.streaming = false;
        ws.queue = { steering: [], followUp: [] };
        refreshSessions(ws);
        break;
      case "queue_update":
        ws.queue = { steering: event.steering ?? [], followUp: event.followUp ?? [] };
        break;
      case "message_update":
        if (event.usage) ws.usage = event.usage;
        break;
      case "compaction_start":
        ws.compacting = true;
        break;
      case "compaction_end":
        ws.compacting = false;
        break;
      case "thinking_level_changed":
        ws.thinking = event.level;
        break;
      case "session_info_changed":
        ws.sessionName = event.name ?? "";
        break;
      default:
        break;
    }
  }

  async function open(cwd: string): Promise<WorkspaceState> {
    let ws = workspaces.get(cwd);
    if (state.activeCwd !== cwd) {
      state.openFiles = [];
      state.activeFile = "";
    }
    state.activeCwd = cwd;
    if (ws && (ws.status === "ready" || ws.status === "starting")) return ws;
    if (!ws) {
      ws = makeWorkspace(cwd);
      workspaces.set(cwd, ws);
    }
    ws.status = "starting";
    ws.error = "";
    try {
      const snap = await host.open(cwd);
      applySnapshot(ws, snap);
      ws.status = "ready";
      state.recent = await host.recent();
      bus.emit("workspace:opened", ws);
    } catch (error: any) {
      ws.status = "error";
      ws.error = error?.message ?? String(error);
    }
    return ws;
  }

  async function chooseAndOpen(): Promise<void> {
    const cwd = await host.chooseDirectory();
    if (cwd) await open(cwd);
  }

  async function listDirectory(relative = ""): Promise<any[]> {
    const ws = active.value;
    if (!ws) return [];
    return host.listDirectory(ws.cwd, relative);
  }

  async function openFile(relative: string): Promise<any> {
    const ws = active.value;
    if (!ws) return null;
    const existing = state.openFiles.find((item) => item.relative === relative);
    if (existing) {
      state.activeFile = relative;
      return existing;
    }
    const placeholder: OpenEditorFile = {
      relative,
      name: String(relative).split(/[\\/]/).at(-1) ?? relative,
      content: "",
      draft: "",
      savedContent: "",
      loading: true,
      error: "",
      dirty: false,
    };
    state.openFiles.push(placeholder);
    state.activeFile = relative;
    try {
      const file = await host.readWorkspaceFile(ws.cwd, relative);
      const index = state.openFiles.findIndex((item) => item.relative === relative);
      if (index >= 0) {
        state.openFiles.splice(index, 1, {
          ...file,
          draft: file.content,
          loading: false,
          error: "",
          savedContent: file.content,
          dirty: false,
        });
      }
      return file;
    } catch (error: any) {
      const index = state.openFiles.findIndex((item) => item.relative === relative);
      if (index >= 0) state.openFiles.splice(index, 1, { ...placeholder, loading: false, error: error?.message ?? String(error) });
      throw error;
    }
  }

  function closeFile(relative = state.activeFile): void {
    const index = state.openFiles.findIndex((item) => item.relative === relative);
    if (index >= 0) state.openFiles.splice(index, 1);
    if (state.activeFile === relative) state.activeFile = state.openFiles[Math.max(0, index - 1)]?.relative ?? state.openFiles[0]?.relative ?? "";
  }

  function activateFile(relative: string): void {
    if (state.openFiles.some((item) => item.relative === relative)) state.activeFile = relative;
  }

  async function readWorkspaceFile(relative: string): Promise<any> {
    const ws = active.value;
    if (!ws) return null;
    return host.readWorkspaceFile(ws.cwd, relative);
  }

  async function saveWorkspaceFile(relative: string, content: string): Promise<any> {
    const ws = active.value;
    if (!ws) return null;
    const file = await host.writeWorkspaceFile(ws.cwd, relative, content);
    const index = state.openFiles.findIndex((item) => item.relative === relative);
    if (index >= 0) {
      state.openFiles.splice(index, 1, {
        ...file,
        draft: file.content,
        loading: false,
        error: "",
        savedContent: file.content,
        dirty: false,
      });
    }
    return file;
  }

  async function openWorkspacePath(relative: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    const error = await host.openWorkspacePath(ws.cwd, relative);
    if (error) throw new Error(error);
  }

  async function completePaths(query = ""): Promise<any[]> {
    const ws = active.value;
    if (!ws) return [];
    return host.completePaths(ws.cwd, query);
  }

  async function addFiles(paths: string[] = []): Promise<void> {
    const ws = active.value;
    if (!ws || !paths.length) return;
    const prepared = await host.prepareAttachments(ws.cwd, paths);
    const known = new Set(ws.attachments.map((item: any) => item.path));
    ws.attachments.push(...prepared.items.filter((item: any) => !known.has(item.path)));
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
    if (ws?.streaming) throw new Error("该项目有任务正在运行，请先停止");
    const result = await host.removeProject(cwd, { deleteSessions });
    workspaces.delete(cwd);
    state.recent = result.recent;
    if (state.activeCwd === cwd) {
      const next = [...workspaces.keys()][0] ?? "";
      state.activeCwd = next;
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
    if (ws?.status === "ready") {
      if (file === ws.sessionFile) await reload(ws);
      else ws.sessions = sessions;
    }
    bus.emit("session:deleted", { cwd, file });
    return sessions;
  }

  async function reload(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws) return;
    applySnapshot(ws, await host.snapshot(ws.cwd));
  }

  async function restart(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws || ws.streaming) return;
    ws.status = "starting";
    try {
      applySnapshot(ws, await host.restart(ws.cwd));
      ws.status = "ready";
    } catch (error: any) {
      ws.status = "error";
      ws.error = error?.message ?? String(error);
    }
  }

  function setSidebarWidth(value: number): number {
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.sidebarWidth;
    state.sidebarWidth = Math.round(width);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    return state.sidebarWidth;
  }

  function setPanelWidth(value: number): number {
    const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.panelWidth;
    state.panelWidth = Math.round(width);
    localStorage.setItem(PANEL_WIDTH_KEY, String(state.panelWidth));
    return state.panelWidth;
  }

  function setEditorWidth(value: number): number {
    const width = Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.editorWidth;
    state.editorWidth = Math.round(width);
    localStorage.setItem(EDITOR_WIDTH_KEY, String(state.editorWidth));
    return state.editorWidth;
  }

  function notice(level: string, text: string): void {
    active.value?.transcript.pushNotice(level, text);
  }

  async function renameSession(name: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setSessionName", [name]);
    ws.sessionName = name;
    await refreshSessions(ws);
  }

  async function refreshSessions(ws: WorkspaceState | null = active.value): Promise<void> {
    if (!ws) return;
    ws.sessions = await host.sessions(ws.cwd);
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

  function call(method: string, ...args: any[]): Promise<any> {
    const ws = active.value;
    if (!ws) return Promise.reject(new Error("没有打开的工作区"));
    return rpc(ws.cwd, method, args);
  }

  async function send(text: string, { mode }: { mode?: string } = {}): Promise<void> {
    const ws = active.value;
    const message = text.trim();
    if (!ws || (!message && !ws.attachments.length)) return;
    const behavior = ws.streaming ? (mode ?? "followUp") : undefined;
    if (!behavior) {
      const attachmentNames = ws.attachments.map((item: any) => item.name).join("、");
      const displayMessage = [message, attachmentNames ? `附件：${attachmentNames}` : ""].filter(Boolean).join("\n");
      ws.transcript.pushUser(displayMessage || `请查看附件（${ws.attachments.length} 项）`, ws.attachments.filter((item: any) => item.image).length);
      ws.streaming = true;
    }
    try {
      const prepared = ws.attachments.length
        ? await host.prepareAttachments(ws.cwd, ws.attachments.map((item: any) => item.path))
        : { text: "", images: [] };
      const prompt = [prepared.text, message].filter(Boolean).join("\n");
      const disposition = await rpc(ws.cwd, "prompt", [prompt, prepared.images, behavior]);
      ws.attachments = [];
      if (disposition === "handled") {
        ws.streaming = false;
        await reload(ws);
      }
    } catch (error: any) {
      ws.streaming = false;
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
    }
  }

  async function stop(): Promise<string> {
    const ws = active.value;
    if (!ws) return "";
    const queued = await rpc(ws.cwd, "clearQueue", []);
    await rpc(ws.cwd, "abort", []);
    ws.queue = { steering: [], followUp: [] };
    return [...(queued?.steering ?? []), ...(queued?.followUp ?? [])].join("\n");
  }

  async function newSession(): Promise<void> {
    const ws = active.value;
    if (!ws || ws.streaming) return;
    await rpc(ws.cwd, "newSession", []);
    await reload(ws);
  }

  async function switchSession(file: string): Promise<void> {
    const ws = active.value;
    if (!ws || ws.streaming || file === ws.sessionFile) return;
    await rpc(ws.cwd, "switchSession", [file]);
    await reload(ws);
  }

  async function setModel(model: any): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setModel", [model.provider, model.id]);
    ws.model = model;
    ws.levels = await rpc(ws.cwd, "getAvailableThinkingLevels", []);
  }

  async function setThinking(level: string): Promise<void> {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setThinkingLevel", [level]);
    ws.thinking = level;
  }

  function setTheme(id: string): void {
    state.theme = id;
    localStorage.setItem(THEME_KEY, id);
  }

  return {
    state,
    workspaces,
    active,
    init,
    open,
    chooseAndOpen,
    listDirectory,
    openFile,
    closeFile,
    activateFile,
    readWorkspaceFile,
    saveWorkspaceFile,
    openWorkspacePath,
    completePaths,
    addFiles,
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
    call,
    send,
    stop,
    newSession,
    switchSession,
    setSidebarWidth,
    setPanelWidth,
    setEditorWidth,
    setModel,
    setThinking,
    setTheme,
  };
}
