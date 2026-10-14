import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// 最小宿主桥：只暴露通道，不暴露 Node 或 ipcRenderer 本身。
contextBridge.exposeInMainWorld("piDesktop", {
  platform: process.platform,
  setTitleBar: (colors: { color: string; symbolColor: string }) => ipcRenderer.invoke("pi:titlebar", colors),
  locate: () => ipcRenderer.invoke("pi:locate"),
  recent: () => ipcRenderer.invoke("pi:recent"),
  forget: (cwd: string) => ipcRenderer.invoke("pi:forget", cwd),
  chooseDirectory: () => ipcRenderer.invoke("pi:choose-directory"),
  chooseFiles: () => ipcRenderer.invoke("pi:choose-files"),
  chooseFolder: () => ipcRenderer.invoke("pi:choose-folder"),
  open: (cwd: string) => ipcRenderer.invoke("pi:open", cwd),
  snapshot: (cwd: string) => ipcRenderer.invoke("pi:snapshot", cwd),
  prepareAttachments: (cwd: string, paths: string[]) => ipcRenderer.invoke("pi:prepare-attachments", cwd, paths),
  listDirectory: (cwd: string, relative: string) => ipcRenderer.invoke("pi:list-directory", cwd, relative),
  readWorkspaceFile: (cwd: string, relative: string) => ipcRenderer.invoke("pi:read-workspace-file", cwd, relative),
  writeWorkspaceFile: (cwd: string, relative: string, content: string) => ipcRenderer.invoke("pi:write-workspace-file", cwd, relative, content),
  openWorkspacePath: (cwd: string, relative: string) => ipcRenderer.invoke("pi:open-workspace-path", cwd, relative),
  completePaths: (cwd: string, query: string) => ipcRenderer.invoke("pi:complete-paths", cwd, query),
  restart: (cwd: string) => ipcRenderer.invoke("pi:restart", cwd),
  sessions: (cwd: string) => ipcRenderer.invoke("pi:sessions", cwd),
  deleteSession: (cwd: string, file: string) => ipcRenderer.invoke("pi:delete-session", cwd, file),
  removeProject: (cwd: string, options?: { deleteSessions?: boolean }) => ipcRenderer.invoke("pi:remove-project", cwd, options),
  call: (cwd: string, method: string, args?: any[]) => ipcRenderer.invoke("pi:call", cwd, method, args),
  respondExtensionUi: (cwd: string, response: Record<string, any>) => ipcRenderer.invoke("pi:extension-ui", cwd, response),
  reveal: (target: string) => ipcRenderer.invoke("pi:reveal", target),
  onEvent: (listener: (payload: any) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: any) => listener(payload);
    ipcRenderer.on("pi:event", wrapped);
    return () => ipcRenderer.removeListener("pi:event", wrapped);
  },
});
