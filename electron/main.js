import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiHost, readRecent, writeRecent, forgetRecent } from "./pi-host.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_HTML = path.join(HERE, "../packages/ui/dist/index.html");
const DEV_URL = process.env.PI_DESKTOP_URL ?? "http://127.0.0.1:1420";
let mainWindow = null;

const host = new PiHost({
  emit(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pi:event", plain(payload));
  },
  // 会话文件移入系统回收站，误删可恢复
  trash: (file) => shell.trashItem(file),
});

const recentFile = () => path.join(app.getPath("userData"), "recent-workspaces.json");

function locatePi() {
  return new Promise((resolve) => {
    const probe = spawn("pi", ["--version"], { shell: true });
    let output = "";
    probe.stdout.on("data", (chunk) => { output += chunk; });
    probe.stderr.on("data", (chunk) => { output += chunk; });
    probe.once("error", () => resolve({ found: false, version: "" }));
    probe.once("close", (code) => resolve({ found: code === 0, version: output.trim() }));
  });
}

const TITLEBAR_HEIGHT = 40;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#111214",
    title: "Pi Desktop",
    // 与 Air 一致：标题栏融入界面。Windows/Linux 保留系统窗口按钮覆盖层，macOS 保留红绿灯。
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#111214", symbolColor: "#a8adb5", height: TITLEBAR_HEIGHT },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (app.isPackaged && existsSync(DIST_HTML)) {
    mainWindow.loadFile(DIST_HTML);
    return;
  }
  mainWindow.loadURL(DEV_URL).catch(() => {
    if (existsSync(DIST_HTML) && !process.env.PI_DESKTOP_URL) {
      mainWindow.loadFile(DIST_HTML);
      return;
    }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(DEV_URL);
    }, 600);
  });
}

/** IPC 只传纯 JSON：去掉 Error、函数、循环引用等无法结构化克隆的值。 */
function plain(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => plain(await fn(...args)));
}

app.whenReady().then(() => {
  // 先注册 IPC 再创建窗口，避免渲染进程启动时调用到尚未注册的处理器。
  handle("pi:locate", () => locatePi());
  handle("pi:recent", () => readRecent(recentFile()));
  handle("pi:forget", (cwd) => forgetRecent(recentFile(), cwd));
  handle("pi:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("pi:choose-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "添加文件",
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle("pi:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "添加文件夹",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("pi:open", async (cwd) => {
    await writeRecent(recentFile(), cwd);
    return host.open(cwd);
  });
  handle("pi:snapshot", (cwd) => host.snapshot(cwd));
  handle("pi:prepare-attachments", (cwd, paths) => host.prepareAttachments(cwd, paths));
  handle("pi:list-directory", (cwd, relative) => host.listDirectory(cwd, relative));
  handle("pi:read-workspace-file", (cwd, relative) => host.readWorkspaceFile(cwd, relative));
  handle("pi:write-workspace-file", (cwd, relative, content) => host.writeWorkspaceFile(cwd, relative, content));
  handle("pi:open-workspace-path", async (cwd, relative) => shell.openPath(await host.openWorkspacePath(cwd, relative)));
  handle("pi:complete-paths", (cwd, query) => host.completePaths(cwd, query));
  handle("pi:restart", (cwd) => host.restart(cwd));
  handle("pi:sessions", (cwd) => host.sessions(cwd));
  handle("pi:delete-session", (cwd, file) => host.deleteSession(cwd, file));
  // 移除项目：停止进程、从最近列表移除；可选地把它的会话全部移入回收站。不会删除项目目录本身。
  handle("pi:remove-project", async (cwd, { deleteSessions = false } = {}) => {
    await host.close(cwd);
    const result = deleteSessions ? await host.deleteAllSessions(cwd) : { deleted: 0, failed: 0 };
    return { ...result, recent: await forgetRecent(recentFile(), cwd) };
  });
  handle("pi:call", (cwd, method, args) => host.call(cwd, method, args));
  handle("pi:extension-ui", (cwd, response) => host.respondExtensionUi(cwd, response));
  handle("pi:reveal", (target) => shell.showItemInFolder(target));
  handle("pi:titlebar", ({ color, symbolColor } = {}) => {
    if (!mainWindow || process.platform === "darwin") return false;
    try {
      mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
      mainWindow.setBackgroundColor(color);
      return true;
    } catch {
      return false;
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on("before-quit", async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  await host.stopAll();
  app.exit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
