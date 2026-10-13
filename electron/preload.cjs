const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktop", {
  locate: () => ipcRenderer.invoke("pi:locate"),
  recent: () => ipcRenderer.invoke("pi:recent"),
  chooseDirectory: () => ipcRenderer.invoke("pi:choose-directory"),
  open: (cwd) => ipcRenderer.invoke("pi:open", cwd),
  sessions: (cwd) => ipcRenderer.invoke("pi:sessions", cwd),
  prompt: (cwd, message, streaming) => ipcRenderer.invoke("pi:prompt", cwd, message, streaming),
  stop: (cwd) => ipcRenderer.invoke("pi:stop", cwd),
  newSession: (cwd) => ipcRenderer.invoke("pi:new-session", cwd),
  switchSession: (cwd, sessionPath) => ipcRenderer.invoke("pi:switch-session", cwd, sessionPath),
  setModel: (cwd, provider, modelId) => ipcRenderer.invoke("pi:model", cwd, provider, modelId),
  setThinking: (cwd, level) => ipcRenderer.invoke("pi:thinking", cwd, level),
  onEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("pi:event", wrapped);
    return () => ipcRenderer.removeListener("pi:event", wrapped);
  },
});
