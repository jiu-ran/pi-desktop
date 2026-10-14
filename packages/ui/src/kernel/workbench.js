import { computed, reactive, shallowReactive, toRaw } from "vue";
import { createTranscript } from "./transcript.js";

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

function savedWidth(key, min, max, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function savedSidebarWidth() {
  return savedWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, 272);
}

/** 传给 IPC 的参数必须是纯数据，Vue 响应式 Proxy 无法被结构化克隆。 */
function plainArgs(args) {
  return JSON.parse(JSON.stringify(args.map((arg) => (arg && typeof arg === "object" ? toRaw(arg) : arg)) ?? []));
}

/**
 * 工作区服务：维护多工作区状态、把宿主事件分发到对应工作区。
 * 只依赖 host（window.piDesktop）与 bus，不依赖任何组件。
 */
export function createWorkbench({ host, bus }) {
  const state = reactive({
    pi: { found: false, version: "", checked: false },
    recent: [],
    activeCwd: "",
    theme: localStorage.getItem(THEME_KEY) || "dark",
    activeSidebar: "tasks",
    sidebarOpen: true,
    sidebarWidth: savedSidebarWidth(),
    panelWidth: savedWidth(PANEL_WIDTH_KEY, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 380),
    editorWidth: savedWidth(EDITOR_WIDTH_KEY, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH, 560),
    activePanels: [],
    openFiles: [],
    activeFile: "",
    paletteOpen: false,
  });

  /** cwd -> 工作区状态 */
  const workspaces = shallowReactive(new Map());

  function makeWorkspace(cwd) {
    const transcript = createTranscript(reactive);
    return reactive({
      cwd,
      name: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
      status: "idle", // idle | starting | ready | error
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

  const active = computed(() => workspaces.get(state.activeCwd) ?? null);

  /** 唯一的 RPC 出口：参数先纯化再过 IPC */
  function rpc(cwd, method, args = []) {
    return host.call(cwd, method, plainArgs(args));
  }

  function applySnapshot(ws, snap) {
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

  async function init() {
    if (!host) {
      state.pi = { found: false, version: "", checked: true };
      return;
    }
    host.onEvent(({ cwd, event }) => {
      const ws = workspaces.get(cwd);
      if (!ws) return;
      routeEvent(ws, event);
      bus.emit("pi:event", { cwd, event, workspace: ws });
    });
    const [pi, recent] = await Promise.all([
      host.locate().catch(() => ({ found: false, version: "" })),
      host.recent().catch(() => []),
    ]);
    state.pi = { ...pi, checked: true };
    state.recent = recent;
    if (pi.found && recent[0]) open(recent[0]);
  }

  function routeEvent(ws, event) {
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

  async function open(cwd) {
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
    } catch (error) {
      ws.status = "error";
      ws.error = error?.message ?? String(error);
    }
    return ws;
  }

  async function chooseAndOpen() {
    const cwd = await host.chooseDirectory();
    if (cwd) await open(cwd);
  }

  async function listDirectory(relative = "") {
    const ws = active.value;
    if (!ws) return [];
    return host.listDirectory(ws.cwd, relative);
  }

  async function openFile(relative) {
    const ws = active.value;
    if (!ws) return null;
    const existing = state.openFiles.find((item) => item.relative === relative);
    if (existing) {
      state.activeFile = relative;
      return existing;
    }
    const placeholder = { relative, name: String(relative).split(/[\\/]/).at(-1) ?? relative, content: "", draft: "", savedContent: "", loading: true, error: "", dirty: false };
    state.openFiles.push(placeholder);
    state.activeFile = relative;
    try {
      const file = await host.readWorkspaceFile(ws.cwd, relative);
      const index = state.openFiles.findIndex((item) => item.relative === relative);
      if (index >= 0) state.openFiles.splice(index, 1, { ...file, draft: file.content, loading: false, error: "", savedContent: file.content, dirty: false });
      return file;
    } catch (error) {
      const index = state.openFiles.findIndex((item) => item.relative === relative);
      if (index >= 0) state.openFiles.splice(index, 1, { ...placeholder, loading: false, error: error?.message ?? String(error) });
      throw error;
    }
  }

  function closeFile(relative = state.activeFile) {
    const index = state.openFiles.findIndex((item) => item.relative === relative);
    if (index >= 0) state.openFiles.splice(index, 1);
    if (state.activeFile === relative) state.activeFile = state.openFiles[Math.max(0, index - 1)]?.relative ?? state.openFiles[0]?.relative ?? "";
  }

  function activateFile(relative) {
    if (state.openFiles.some((item) => item.relative === relative)) state.activeFile = relative;
  }

  async function readWorkspaceFile(relative) {
    const ws = active.value;
    if (!ws) return null;
    return host.readWorkspaceFile(ws.cwd, relative);
  }

  async function saveWorkspaceFile(relative, content) {
    const ws = active.value;
    if (!ws) return null;
    const file = await host.writeWorkspaceFile(ws.cwd, relative, content);
    const index = state.openFiles.findIndex((item) => item.relative === relative);
    if (index >= 0) state.openFiles.splice(index, 1, { ...file, loading: false, error: "", savedContent: file.content, dirty: false });
    return file;
  }

  async function openWorkspacePath(relative) {
    const ws = active.value;
    if (!ws) return;
    const error = await host.openWorkspacePath(ws.cwd, relative);
    if (error) throw new Error(error);
  }

  async function completePaths(query = "") {
    const ws = active.value;
    if (!ws) return [];
    return host.completePaths(ws.cwd, query);
  }

  async function addFiles(paths = []) {
    const ws = active.value;
    if (!ws || !paths.length) return;
    const prepared = await host.prepareAttachments(ws.cwd, paths);
    const known = new Set(ws.attachments.map((item) => item.path));
    ws.attachments.push(...prepared.items.filter((item) => !known.has(item.path)));
  }

  async function chooseFiles() {
    await addFiles((await host.chooseFiles()) ?? []);
  }

  async function chooseFolder() {
    const folder = await host.chooseFolder();
    if (folder) await addFiles([folder]);
  }

  function removeAttachment(file) {
    const ws = active.value;
    if (ws) ws.attachments = ws.attachments.filter((item) => item.path !== file);
  }

  async function forget(cwd) {
    state.recent = await host.forget(cwd);
  }

  /**
   * 移除项目：停止它的 pi 进程并从列表移除。deleteSessions 为真时，
   * 还会把该项目的全部会话移入回收站。项目目录本身不会被删除。
   */
  async function removeProject(cwd, { deleteSessions = false } = {}) {
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

  /** 在系统文件管理器中显示文件或目录 */
  function reveal(target) {
    return host.reveal(target);
  }

  /** 删除一个会话（移入回收站）。删的是当前会话时，Pi 会先切到最近的另一个会话。 */
  async function deleteSession(cwd, file) {
    const ws = workspaces.get(cwd);
    const sessions = await host.deleteSession(cwd, file);
    if (ws?.status === "ready") {
      if (file === ws.sessionFile) await reload(ws);
      else ws.sessions = sessions;
    }
    bus.emit("session:deleted", { cwd, file });
    return sessions;
  }

  async function reload(ws = active.value) {
    if (!ws) return;
    applySnapshot(ws, await host.snapshot(ws.cwd));
  }

  /** /reload：重启当前项目的 pi 进程，重新加载扩展 / 技能 / 提示模板，保留当前会话 */
  async function restart(ws = active.value) {
    if (!ws || ws.streaming) return;
    ws.status = "starting";
    try {
      applySnapshot(ws, await host.restart(ws.cwd));
      ws.status = "ready";
    } catch (error) {
      ws.status = "error";
      ws.error = error?.message ?? String(error);
    }
  }

  /** 在当前对话里插入一条本地提示（不写入 Pi 会话，重新加载后消失） */
  function setSidebarWidth(value) {
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.sidebarWidth;
    state.sidebarWidth = Math.round(width);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    return state.sidebarWidth;
  }

  function setPanelWidth(value) {
    const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.panelWidth;
    state.panelWidth = Math.round(width);
    localStorage.setItem(PANEL_WIDTH_KEY, String(state.panelWidth));
    return state.panelWidth;
  }

  function setEditorWidth(value) {
    const width = Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, Number(value)));
    if (!Number.isFinite(width)) return state.editorWidth;
    state.editorWidth = Math.round(width);
    localStorage.setItem(EDITOR_WIDTH_KEY, String(state.editorWidth));
    return state.editorWidth;
  }

  function notice(level, text) {
    active.value?.transcript.pushNotice(level, text);
  }

  async function renameSession(name) {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setSessionName", [name]);
    ws.sessionName = name;
    await refreshSessions(ws);
  }

  async function refreshSessions(ws = active.value) {
    if (!ws) return;
    ws.sessions = await host.sessions(ws.cwd);
  }

  /** 未启动的项目也能列出历史会话（只读 Pi 的 JSONL 头部） */
  function listSessions(cwd) {
    const ws = workspaces.get(cwd);
    if (ws?.status === "ready") return Promise.resolve(ws.sessions);
    return host.sessions(cwd);
  }

  /** 打开项目并切到指定会话 */
  async function openSession(cwd, file) {
    const ws = await open(cwd);
    if (file && ws?.status === "ready") await switchSession(file);
  }

  function call(method, ...args) {
    const ws = active.value;
    if (!ws) return Promise.reject(new Error("没有打开的工作区"));
    return rpc(ws.cwd, method, args);
  }

  async function send(text, { mode } = {}) {
    const ws = active.value;
    const message = text.trim();
    if (!ws || (!message && !ws.attachments.length)) return;
    const behavior = ws.streaming ? (mode ?? "followUp") : undefined;
    if (!behavior) {
      const attachmentNames = ws.attachments.map((item) => item.name).join("、");
      const displayMessage = [message, attachmentNames ? `附件：${attachmentNames}` : ""].filter(Boolean).join("\n");
      ws.transcript.pushUser(displayMessage || `请查看附件（${ws.attachments.length} 项）`, ws.attachments.filter((item) => item.image).length);
      ws.streaming = true;
    }
    try {
      const prepared = ws.attachments.length
        ? await host.prepareAttachments(ws.cwd, ws.attachments.map((item) => item.path))
        : { text: "", images: [] };
      const prompt = [prepared.text, message].filter(Boolean).join("\n");
      const disposition = await rpc(ws.cwd, "prompt", [prompt, prepared.images, behavior]);
      ws.attachments = [];
      if (disposition === "handled") {
        ws.streaming = false;
        await reload(ws);
      }
    } catch (error) {
      ws.streaming = false;
      bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
    }
  }

  async function stop() {
    const ws = active.value;
    if (!ws) return "";
    const queued = await rpc(ws.cwd, "clearQueue", []);
    await rpc(ws.cwd, "abort", []);
    ws.queue = { steering: [], followUp: [] };
    return [...(queued?.steering ?? []), ...(queued?.followUp ?? [])].join("\n");
  }

  async function newSession() {
    const ws = active.value;
    if (!ws || ws.streaming) return;
    await rpc(ws.cwd, "newSession", []);
    await reload(ws);
  }

  async function switchSession(file) {
    const ws = active.value;
    if (!ws || ws.streaming || file === ws.sessionFile) return;
    await rpc(ws.cwd, "switchSession", [file]);
    await reload(ws);
  }

  async function setModel(model) {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setModel", [model.provider, model.id]);
    ws.model = model;
    ws.levels = await rpc(ws.cwd, "getAvailableThinkingLevels", []);
  }

  async function setThinking(level) {
    const ws = active.value;
    if (!ws) return;
    await rpc(ws.cwd, "setThinkingLevel", [level]);
    ws.thinking = level;
  }

  function setTheme(id) {
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
