/**
 * MyGo 宿主适配层。
 *
 * 业务代码只认 `window.piDesktop` 这个形状（从 Electron 的 preload 桥沿用下来）。
 * 这里把它搭在 MyGo 的绑定方法上：原来的每个 IPC 通道在这里变成
 * `call("Host.<Method>")`，事件则订阅 Go 侧的 `pi:event` / `files:disk-change` /
 * `pi:terminal-event`。这样业务代码不需要知道宿主是 Go 还是别的实现。
 */
import { call, currentWindow, isMyGo, on, onFileDrop, runtime } from "mygo-runtime";

const invoke = <T = any>(method: string, ...args: unknown[]): Promise<T> =>
  call<T>(`Host.${method}`, ...args);

/** 最近一次文件拖放的路径；MyGo 通过 onFileDrop 单独给出路径。 */
let droppedPaths: string[] = [];
let dropWaiters: Array<(paths: string[]) => void> = [];

onFileDrop(({ paths }) => {
  droppedPaths = [...paths];
  const waiters = dropWaiters;
  dropWaiters = [];
  for (const resolve of waiters) resolve(droppedPaths);
  // 抓取窗口很短：DOM drop 事件随后就会消费它。
  setTimeout(() => {
    droppedPaths = [];
  }, 1500);
});

function takeDroppedPath(file: File): string {
  const name = file.name.toLowerCase();
  const index = droppedPaths.findIndex((path) => path.toLowerCase().endsWith(name));
  if (index >= 0) return droppedPaths.splice(index, 1)[0] ?? "";
  return (file as any)?.path || "";
}

/** 等待 MyGo 把这次拖放的路径送过来（最多 600ms）。 */
function waitForDroppedPaths(): Promise<string[]> {
  if (droppedPaths.length) {
    const paths = droppedPaths;
    droppedPaths = [];
    return Promise.resolve(paths);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      dropWaiters = dropWaiters.filter((item) => item !== done);
      resolve([]);
    }, 600);
    const done = (paths: string[]) => {
      clearTimeout(timer);
      resolve(paths);
    };
    dropWaiters.push(done);
  });
}

const platform = (() => {
  try {
    return runtime().platform;
  } catch {
    return "web";
  }
})();

const bridge = {
  platform,
  getPathForFile: takeDroppedPath,
  resolveDroppedPaths: waitForDroppedPaths,

  setWindowBackground: (color: string) => invoke("SetWindowBackground", color),
  setDirty: (dirty: boolean) => invoke("SetDirty", dirty),
  windowControls: {
    minimize: async () => {
      await currentWindow.minimize();
      return true;
    },
    toggleMaximize: async () => {
      await currentWindow.toggleMaximize();
      return currentWindow.isMaximized();
    },
    close: async () => {
      await invoke("CloseWindow");
      return true;
    },
    state: () => invoke("WindowState"),
    onChange: (listener: (state: { maximized: boolean; fullscreen: boolean }) => void) =>
      on("app:window-state", listener),
  },

  locate: (customPath = "") => invoke("Locate", customPath),
  locateAgent: (kind: string, customPath = "") => invoke("LocateAgent", kind, customPath),
  agents: (cwd = "") => invoke("Agents", cwd),
  agentFor: (cwd: string) => invoke("AgentFor", cwd),
  setAgent: (cwd: string, kind: string) => invoke("SetAgent", cwd, kind),
  respondAcpPermission: (cwd: string, sessionFile: string, permissionId: string, optionId: string) =>
    invoke("AcpRespondPermission", cwd, sessionFile, permissionId, optionId),
  setZoomFactor: (factor: number) => invoke("SetZoomFactor", factor),
  checkPiUpdate: (customPath = "") => invoke("CheckPiUpdate", customPath),
  networkApply: (mode = "", custom = "") => invoke("NetworkApply", mode, custom),
  networkStatus: () => invoke("NetworkStatus"),
  checkAppUpdate: (options?: { manual?: boolean }) => invoke("CheckAppUpdate", options ?? {}),
  downloadAppUpdate: () => invoke("DownloadAppUpdate"),
  cancelAppUpdate: () => invoke("CancelAppUpdate"),
  readClipboard: () => invoke("ReadClipboard"),
  installAppUpdate: (version = "") => invoke("InstallAppUpdate", version),
  openAppUpdate: (url = "") => invoke("OpenAppUpdate", url),
  openExternalUrl: (url = "") => invoke("OpenExternalURL", url),
  updatePi: (customPath = "", scope: "self" | "all" = "self") => invoke("UpdatePi", customPath, scope),
  recent: () => invoke("Recent"),
  forget: (cwd: string) => invoke("Forget", cwd),
  chooseDirectory: () => invoke("ChooseDirectory"),
  chooseFiles: () => invoke("ChooseFiles"),
  savePastedImage: (payload: { name?: string; mimeType?: string; data: string }) =>
    invoke("SavePastedImage", payload),
  chooseFolder: () => invoke("ChooseFolder"),
  open: (cwd: string, options?: { resumeSessionFile?: string; targetSessionFile?: string }) => invoke("Open", cwd, options ?? {}),
  snapshot: (cwd: string, sessionFile?: string) => invoke("Snapshot", cwd, sessionFile ?? ""),
  prepareAttachments: (cwd: string, paths: string[], authorizePaths: string[] = []) =>
    invoke("PrepareAttachments", cwd, paths, authorizePaths),
  prepareSessionAttachments: (cwd: string, files: string[]) =>
    invoke("PrepareSessionAttachments", cwd, files),
  crossProjectSessions: (limit?: number) => invoke("CrossProjectSessions", limit ?? 40),
  reportLongTask: (ms: number, label = "") => {
    void invoke("ReportLongTask", ms, label).catch(() => {});
  },
  logEvent: (level: string, scope: string, message: string) => {
    void invoke("LogEvent", level, scope, message).catch(() => {});
  },

  logsInfo: () => invoke("LogsInfo"),
  setLogLimit: (bytes: number) => invoke("SetLogLimit", bytes),
  logsClear: () => invoke("LogsClear"),
  logsOpen: () => invoke("LogsOpen"),
  logsReveal: () => invoke("LogsReveal"),

  listDirectory: (cwd: string, relative: string) => invoke("ListDirectory", cwd, relative),
  readWorkspaceFile: (cwd: string, relative: string) => invoke("ReadWorkspaceFile", cwd, relative),
  writeWorkspaceFile: (cwd: string, relative: string, content: string, revision?: string) =>
    invoke("WriteWorkspaceFile", cwd, relative, content, revision ?? ""),
  openWorkspacePath: (cwd: string, relative: string) => invoke("OpenWorkspacePath", cwd, relative),
  createWorkspaceEntry: (cwd: string, parent: string, name: string, kind: "file" | "folder") =>
    invoke("CreateWorkspaceEntry", cwd, parent, name, kind),
  renameWorkspaceEntry: (cwd: string, relative: string, name: string) =>
    invoke("RenameWorkspaceEntry", cwd, relative, name),
  deleteWorkspaceEntry: (cwd: string, relative: string) => invoke("DeleteWorkspaceEntry", cwd, relative),
  gitOverview: (cwd: string) => invoke("GitOverview", cwd),
  gitBranches: (cwd: string) => invoke("GitBranches", cwd),
  gitInspect: (cwd: string, kind: string, target: string) => invoke("GitInspect", cwd, kind, target),
  gitAction: (cwd: string, action: string, payload?: any) => invoke("GitAction", cwd, action, payload ?? {}),
  gitWorktrees: (cwd: string) => invoke("GitWorktrees", cwd),
  gitWorktreeCreate: (cwd: string, name: string, options?: any) =>
    invoke("GitWorktreeCreate", cwd, name, options ?? {}),
  gitWorktreeRemove: (cwd: string, target: string, options?: any) =>
    invoke("GitWorktreeRemove", cwd, target, options ?? {}),
  gitWorktreeMerge: (cwd: string, options: any) => invoke("GitWorktreeMerge", cwd, options),
  gitClone: (url: string, target: string) => invoke("GitClone", url, target),
  completePaths: (cwd: string, query: string) => invoke("CompletePaths", cwd, query),
  restart: (cwd: string, sessionFile?: string) => invoke("Restart", cwd, sessionFile ?? ""),
  sessions: (cwd: string) => invoke("Sessions", cwd),
  messagePage: (cwd: string, file: string, endIndex = 0, limit = 8, minTurns = 0, minBlocks = 0) =>
    invoke("MessagePage", cwd, file, endIndex, limit, minTurns, minBlocks),
  deleteSession: (cwd: string, file: string) => invoke("DeleteSession", cwd, file),
  projectTrust: (cwd: string) => invoke("ProjectTrust", cwd),
  setProjectTrust: (cwd: string, action: "trust" | "trust-parent" | "distrust") =>
    invoke("SetProjectTrust", cwd, action),
  importSession: (cwd: string, file: string) => invoke("ImportSession", cwd, file),
  exportSessionJsonl: (cwd: string, target?: string) => invoke("ExportSessionJSONL", cwd, target ?? ""),
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) =>
    invoke("RemoveProject", cwd, options ?? {}),
  call: (cwd: string, method: string, args: any[] = [], sessionFile?: string) =>
    invoke("Call", cwd, method, args, sessionFile ?? ""),
  respondExtensionUi: (cwd: string, response: Record<string, any>, sessionFile?: string) =>
    invoke("RespondExtensionUI", cwd, response, sessionFile ?? ""),
  reveal: (target: string) => invoke("Reveal", target),

  mcpOverview: (cwd?: string) => invoke("McpOverview", cwd ?? ""),
  mcpProbe: (cwd?: string) => invoke("McpProbe", cwd ?? ""),
  mcpLogin: (cwd: string | undefined, name: string) => invoke("McpLogin", cwd ?? "", name),
  mcpLogout: (cwd: string | undefined, name: string) => invoke("McpLogout", cwd ?? "", name),
  mcpSaveServer: (cwd: string, payload: any) => invoke("McpSaveServer", cwd, payload),
  mcpUpdateServer: (cwd: string, payload: any) => invoke("McpUpdateServer", cwd, payload),
  mcpRemoveServer: (cwd: string, payload: any) => invoke("McpRemoveServer", cwd, payload),
  mcpSetAutoCodemode: (cwd: string, payload: any) => invoke("McpSetAutoCodemode", cwd, payload),
  mcpImportJson: (cwd: string, payload: any) => invoke("McpImportJSON", cwd, payload),
  packagesOverview: (cwd?: string) => invoke("PackagesOverview", cwd ?? ""),
  packagesInstall: (cwd: string, payload: any) => invoke("PackagesInstall", cwd, payload),
  packagesRemove: (cwd: string, payload: any) => invoke("PackagesRemove", cwd, payload),
  packagesUpdate: (cwd: string, payload?: any) => invoke("PackagesUpdate", cwd, payload ?? {}),
  skillsOverview: (cwd?: string) => invoke("SkillsOverview", cwd ?? ""),
  toolsOverview: (cwd?: string) => invoke("ToolsOverview", cwd ?? ""),
  toolsSet: (cwd: string, payload: any) => invoke("ToolsSet", cwd, payload),
  toolsReset: (cwd: string, payload: any) => invoke("ToolsReset", cwd, payload),
  modelDefaults: (cwd?: string) => invoke("ModelDefaults", cwd ?? ""),
  setModelDefaults: (cwd: string, payload: any) => invoke("SetModelDefaults", cwd, payload),
  globalAgents: () => invoke("GlobalAgents"),
  saveGlobalAgents: (content: string) => invoke("SaveGlobalAgents", content),

  startTerminal: (cwd: string, command: string, options?: any) =>
    invoke("StartTerminal", cwd, command, options ?? {}),
  startTerminalPty: (cwd: string, cols = 100, rows = 30, options?: any) =>
    invoke("StartTerminalPty", cwd, cols, rows, options ?? {}),
  terminalProfiles: () => invoke("TerminalProfiles"),
  chooseTerminalExecutable: () => invoke("ChooseTerminalExecutable"),
  validateTerminalProfile: (options: any) => invoke("ValidateTerminalProfile", options ?? {}),
  startTerminalShell: (cwd: string) => invoke("StartTerminalShell", cwd),
  writeTerminal: (id: string, input: string) => invoke("WriteTerminal", id, input),
  writeTerminalPty: (id: string, data: string, binary = false) =>
    invoke("WriteTerminalPty", id, data, binary),
  resizeTerminalPty: (id: string, cols: number, rows: number) =>
    invoke("ResizeTerminalPty", id, cols, rows),
  setTerminalFocus: (focused: boolean) => invoke("SetTerminalFocus", focused),
  stopTerminal: (id: string) => invoke("StopTerminal", id),
  terminalTasks: () => invoke("TerminalTasks"),
  onTerminalEvent: (listener: (payload: any) => void) => on("pi:terminal-event", listener),
  onFilesDiskChange: (listener: (payload: any) => void) => on("files:disk-change", listener),
  onEvent: (listener: (payload: any) => void) => on("pi:event", listener),
};

export function installMyGoHost(): void {
  if (!isMyGo()) return;
  (window as any).piDesktop = bridge;
  (window as any).__piDesktopHost = "mygo";
}

installMyGoHost();
