const { contextBridge, ipcRenderer } = require("electron");

// 最小宿主桥：只暴露通道，不暴露 Node 或 ipcRenderer 本身。
contextBridge.exposeInMainWorld("piDesktop", {
  platform: process.platform,
  setTitleBar: (colors) => ipcRenderer.invoke("pi:titlebar", colors),
  locate: () => ipcRenderer.invoke("pi:locate"),
  recent: () => ipcRenderer.invoke("pi:recent"),
  forget: (cwd) => ipcRenderer.invoke("pi:forget", cwd),
  chooseDirectory: () => ipcRenderer.invoke("pi:choose-directory"),
  chooseFiles: () => ipcRenderer.invoke("pi:choose-files"),
  chooseFolder: () => ipcRenderer.invoke("pi:choose-folder"),
  open: (cwd) => ipcRenderer.invoke("pi:open", cwd),
  snapshot: (cwd) => ipcRenderer.invoke("pi:snapshot", cwd),
  prepareAttachments: (cwd, paths) => ipcRenderer.invoke("pi:prepare-attachments", cwd, paths),
  listDirectory: (cwd, relative) => ipcRenderer.invoke("pi:list-directory", cwd, relative),
  readWorkspaceFile: (cwd, relative) => ipcRenderer.invoke("pi:read-workspace-file", cwd, relative),
  writeWorkspaceFile: (cwd, relative, content) => ipcRenderer.invoke("pi:write-workspace-file", cwd, relative, content),
  openWorkspacePath: (cwd, relative) => ipcRenderer.invoke("pi:open-workspace-path", cwd, relative),
  completePaths: (cwd, query) => ipcRenderer.invoke("pi:complete-paths", cwd, query),
  restart: (cwd) => ipcRenderer.invoke("pi:restart", cwd),
  sessions: (cwd) => ipcRenderer.invoke("pi:sessions", cwd),
  deleteSession: (cwd, file) => ipcRenderer.invoke("pi:delete-session", cwd, file),
  removeProject: (cwd, options) => ipcRenderer.invoke("pi:remove-project", cwd, options),
  call: (cwd, method, args) => ipcRenderer.invoke("pi:call", cwd, method, args),
  respondExtensionUi: (cwd, response) => ipcRenderer.invoke("pi:extension-ui", cwd, response),
  reveal: (target) => ipcRenderer.invoke("pi:reveal", target),
  onEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("pi:event", wrapped);
    return () => ipcRenderer.removeListener("pi:event", wrapped);
  },
});
