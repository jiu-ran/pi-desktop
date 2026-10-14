import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiHost, readRecent, writeRecent, forgetRecent } from "./pi-host.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_HTML = path.join(HERE, "../packages/ui/dist/index.html");
const DEV_URL = process.env.PI_DESKTOP_URL ?? "http://127.0.0.1:1420";
let mainWindow: BrowserWindow | null = null;

const host = new PiHost({
  emit(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pi:event", plain(payload));
  },
  trash: (file) => shell.trashItem(file),
});

const recentFile = () => path.join(app.getPath("userData"), "recent-workspaces.json");

function locatePi(): Promise<{ found: boolean; version: string }> {
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
      mainWindow?.loadFile(DIST_HTML);
      return;
    }
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(DEV_URL);
    }, 600);
  });
}

function plain<T>(value: T): T | null {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (_event, ...args) => plain(await fn(...args)));
}

app.whenReady().then(() => {
  handle("pi:locate", () => locatePi());
  handle("pi:recent", () => readRecent(recentFile()));
  handle("pi:forget", (cwd: string) => forgetRecent(recentFile(), cwd));
  handle("pi:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("pi:choose-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      title: "添加文件",
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle("pi:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "添加文件夹",
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("pi:open", async (cwd: string) => {
    await writeRecent(recentFile(), cwd);
    return host.open(cwd);
  });
  handle("pi:snapshot", (cwd: string) => host.snapshot(cwd));
  handle("pi:prepare-attachments", (cwd: string, paths: string[]) => host.prepareAttachments(cwd, paths));
  handle("pi:list-directory", (cwd: string, relative: string) => host.listDirectory(cwd, relative));
  handle("pi:read-workspace-file", (cwd: string, relative: string) => host.readWorkspaceFile(cwd, relative));
  handle("pi:write-workspace-file", (cwd: string, relative: string, content: string) => host.writeWorkspaceFile(cwd, relative, content));
  handle("pi:open-workspace-path", async (cwd: string, relative: string) => shell.openPath(await host.openWorkspacePath(cwd, relative)));
  handle("pi:complete-paths", (cwd: string, query: string) => host.completePaths(cwd, query));
  handle("pi:restart", (cwd: string) => host.restart(cwd));
  handle("pi:sessions", (cwd: string) => host.sessions(cwd));
  handle("pi:delete-session", (cwd: string, file: string) => host.deleteSession(cwd, file));
  handle("pi:remove-project", async (cwd: string, { deleteSessions = false }: { deleteSessions?: boolean } = {}) => {
    await host.close(cwd);
    const result = deleteSessions ? await host.deleteAllSessions(cwd) : { deleted: 0, failed: 0 };
    return { ...result, recent: await forgetRecent(recentFile(), cwd) };
  });
  handle("pi:call", (cwd: string, method: string, args: any[]) => host.call(cwd, method, args));
  handle("pi:extension-ui", (cwd: string, response: Record<string, any>) => host.respondExtensionUi(cwd, response));
  handle("pi:reveal", (target: string) => shell.showItemInFolder(target));
  handle("pi:titlebar", ({ color = "#111214", symbolColor = "#a8adb5" }: { color?: string; symbolColor?: string } = {}) => {
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
