import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

// 最小宿主桥：只暴露通道，不暴露 Node 或 ipcRenderer 本身。
contextBridge.exposeInMainWorld("piDesktop", {
  platform: process.platform,
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  setTitleBar: (colors: { color: string; symbolColor: string }) => ipcRenderer.invoke("pi:titlebar", colors),
  locate: (customPath = "") => ipcRenderer.invoke("pi:locate", customPath),
  setZoomFactor: (factor: number) => ipcRenderer.invoke("pi:set-zoom", factor),
  checkPiUpdate: (customPath = "") => ipcRenderer.invoke("pi:check-update", customPath),
  updatePi: (customPath = "") => ipcRenderer.invoke("pi:update", customPath),
  recent: () => ipcRenderer.invoke("pi:recent"),
  forget: (cwd: string) => ipcRenderer.invoke("pi:forget", cwd),
  chooseDirectory: () => ipcRenderer.invoke("pi:choose-directory"),
  chooseFiles: () => ipcRenderer.invoke("pi:choose-files"),
  chooseFolder: () => ipcRenderer.invoke("pi:choose-folder"),
  open: (cwd: string) => ipcRenderer.invoke("pi:open", cwd),
  snapshot: (cwd: string, sessionFile?: string) => ipcRenderer.invoke("pi:snapshot", cwd, sessionFile),
  prepareAttachments: (cwd: string, paths: string[]) => ipcRenderer.invoke("pi:prepare-attachments", cwd, paths),
  listDirectory: (cwd: string, relative: string) => ipcRenderer.invoke("pi:list-directory", cwd, relative),
  readWorkspaceFile: (cwd: string, relative: string) => ipcRenderer.invoke("pi:read-workspace-file", cwd, relative),
  writeWorkspaceFile: (cwd: string, relative: string, content: string) => ipcRenderer.invoke("pi:write-workspace-file", cwd, relative, content),
  openWorkspacePath: (cwd: string, relative: string) => ipcRenderer.invoke("pi:open-workspace-path", cwd, relative),
  createWorkspaceEntry: (cwd: string, parent: string, name: string, kind: "file" | "folder") => ipcRenderer.invoke("pi:create-workspace-entry", cwd, parent, name, kind),
  renameWorkspaceEntry: (cwd: string, relative: string, name: string) => ipcRenderer.invoke("pi:rename-workspace-entry", cwd, relative, name),
  deleteWorkspaceEntry: (cwd: string, relative: string) => ipcRenderer.invoke("pi:delete-workspace-entry", cwd, relative),
  gitOverview: (cwd: string) => ipcRenderer.invoke("pi:git-overview", cwd),
  gitInspect: (cwd: string, kind: "commit" | "working", target: string) => ipcRenderer.invoke("pi:git-inspect", cwd, kind, target),
  completePaths: (cwd: string, query: string) => ipcRenderer.invoke("pi:complete-paths", cwd, query),
  restart: (cwd: string, sessionFile?: string) => ipcRenderer.invoke("pi:restart", cwd, sessionFile),
  sessions: (cwd: string) => ipcRenderer.invoke("pi:sessions", cwd),
  deleteSession: (cwd: string, file: string) => ipcRenderer.invoke("pi:delete-session", cwd, file),
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) => ipcRenderer.invoke("pi:remove-project", cwd, options),
  call: (cwd: string, method: string, args?: any[], sessionFile?: string) => ipcRenderer.invoke("pi:call", cwd, method, args, sessionFile),
  respondExtensionUi: (cwd: string, response: Record<string, any>, sessionFile?: string) => ipcRenderer.invoke("pi:extension-ui", cwd, response, sessionFile),
  reveal: (target: string) => ipcRenderer.invoke("pi:reveal", target),
  mcpOverview: (cwd?: string) => ipcRenderer.invoke("pi:mcp-overview", cwd),
  mcpProbe: (cwd?: string) => ipcRenderer.invoke("pi:mcp-probe", cwd),
  mcpSaveServer: (cwd: string, payload: any) => ipcRenderer.invoke("pi:mcp-save-server", cwd, payload),
  mcpUpdateServer: (cwd: string, payload: any) => ipcRenderer.invoke("pi:mcp-update-server", cwd, payload),
  mcpRemoveServer: (cwd: string, payload: any) => ipcRenderer.invoke("pi:mcp-remove-server", cwd, payload),
  mcpSetAutoCodemode: (cwd: string, payload: any) => ipcRenderer.invoke("pi:mcp-set-auto-codemode", cwd, payload),
  mcpImportJson: (cwd: string, payload: any) => ipcRenderer.invoke("pi:mcp-import-json", cwd, payload),
  packagesOverview: (cwd?: string) => ipcRenderer.invoke("pi:packages-overview", cwd),
  packagesInstall: (cwd: string, payload: any) => ipcRenderer.invoke("pi:packages-install", cwd, payload),
  packagesRemove: (cwd: string, payload: any) => ipcRenderer.invoke("pi:packages-remove", cwd, payload),
  packagesUpdate: (cwd: string, payload?: any) => ipcRenderer.invoke("pi:packages-update", cwd, payload),
  skillsOverview: (cwd?: string) => ipcRenderer.invoke("pi:skills-overview", cwd),
  onEvent: (listener: (payload: any) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: any) => listener(payload);
    ipcRenderer.on("pi:event", wrapped);
    return () => ipcRenderer.removeListener("pi:event", wrapped);
  },
});
