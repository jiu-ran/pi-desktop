import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiHost, readRecent, writeRecent, forgetRecent } from "./pi-host.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_HTML = path.join(HERE, "../packages/ui/dist/index.html");
const requestedDevUrl = process.env.PI_DESKTOP_URL ?? "http://127.0.0.1:1420";
const DEV_URL = (() => {
  try {
    const url = new URL(requestedDevUrl);
    if ((url.protocol === "http:" || url.protocol === "https:") && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      return url.toString();
    }
  } catch {
    // Fall back to the known local development server.
  }
  return "http://127.0.0.1:1420";
})();
const DEV_ORIGIN = new URL(DEV_URL).origin;
let mainWindow: BrowserWindow | null = null;

const host = new PiHost({
  emit(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pi:event", plain(payload));
  },
  trash: (file) => shell.trashItem(file),
});

const recentFile = () => path.join(app.getPath("userData"), "recent-workspaces.json");

async function authorizedCwd(cwd: string): Promise<string> {
  return host.requireAuthorizedWorkspace(cwd);
}

export const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";

export interface PiLocation {
  found: boolean;
  version: string;
  /** 本机 pi 可执行文件的解析路径（仅从 PATH 识别），找不到为空 */
  path: string;
  /** 识别失败时的原因说明（PATH 缺失 / 路径不可用等） */
  error?: string;
}

function runCommand(command: string, args: string[], timeoutMs = 30000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true, timeout: timeoutMs });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.once("error", () => resolve({ code: -1, output: output.trim() }));
    child.once("close", (code) => resolve({ code: code ?? -1, output: output.trim() }));
  });
}

/**
 * 只在系统 PATH 中识别 pi（自己逐目录走一遍，不调 where/which）。
 * Windows 的 `where` 会先命中进程 cwd（如项目根的 node_modules/.bin/pi 本地
 * shim），导致识别到错误位置；手动走 PATH 即与 cmd 的解析一致，又天然排除 cwd。
 */
/**
 * npm scripts 会把项目 node_modules/.bin 插到 PATH 最前面，Electron 从
 * `npm run dev` 拉起时也会继承它。这些是本地 shim，不是用户安装的 Pi，必须跳过。
 */
function isAppLocalBin(candidate: string): boolean {
  const isWin = process.platform === "win32";
  const norm = (value: string) => {
    const resolved = path.resolve(value);
    return isWin ? resolved.toLowerCase() : resolved;
  };
  const file = norm(candidate);
  // app.getAppPath() 在开发态可能是 dist-electron 或 scripts，真正的项目根
  // 以 package.json 为准（main.ts 编译后位于 dist-electron/，上一级即根）。
  const roots = [path.resolve(HERE, ".."), app.getAppPath(), process.cwd()]
    .filter(Boolean)
    .map(norm);
  return roots.some((root) => file === root || file.startsWith(root + path.sep));
}

function findPiOnPath(): string {
  try {
    const isWin = process.platform === "win32";
    const dirs = (process.env.PATH ?? "").split(path.delimiter).map((d) => d.trim()).filter(Boolean);
    const pathext = isWin
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean)
      : [];
    const names = isWin ? [...pathext.map((ext) => `pi${ext.toLowerCase()}`), "pi"] : ["pi"];
    const seen = new Set<string>();
    for (const dir of dirs) {
      for (const name of names) {
        const full = path.join(dir, name);
        const key = isWin ? full.toLowerCase() : full;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!existsSync(full) || isAppLocalBin(full)) continue;
        return full;
      }
    }
  } catch {
    /* 忽略 PATH 解析异常，按找不到处理 */
  }
  return "";
}

/** 用指定二进制跑 `--version` 探活，返回版本号（失败为空字符串）。路径含空格时加引号。 */
async function probePiVersion(bin: string): Promise<string> {
  const quoted = bin.includes(" ") && !(bin.startsWith('"') && bin.endsWith('"')) ? `"${bin}"` : bin;
  const probed = await runCommand(quoted, ["--version"], 10000);
  if (probed.code !== 0) return "";
  return probed.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

/**
 * 定位 Pi CLI。customPath 为空时只从 PATH 识别；PATH 里没有则直接报
 * NOT_IN_PATH，由界面引导用户手动指定路径（不再静默回退）。
 */
async function locatePi(customPath = ""): Promise<PiLocation> {
  const manual = customPath.trim().replace(/^"|"$/g, "");
  if (manual) {
    if (!existsSync(manual)) {
      return { found: false, version: "", path: manual, error: "指定的 Pi 路径不存在，请检查后重新输入" };
    }
    const version = await probePiVersion(manual);
    if (!version) {
      return { found: false, version: "", path: manual, error: "该路径无法运行 pi --version，请确认是 Pi 可执行文件" };
    }
    return { found: true, version, path: manual };
  }
  const auto = findPiOnPath();
  if (!auto) {
    return { found: false, version: "", path: "", error: "未在系统 PATH 中检测到 pi 命令，请先安装 Pi CLI，或在下方手动指定 Pi 可执行文件路径" };
  }
  const version = await probePiVersion(auto);
  if (!version) {
    return { found: false, version: "", path: auto, error: "PATH 中的 pi 无法运行（pi --version 失败），请检查安装或手动指定路径" };
  }
  return { found: true, version, path: auto };
}

export interface PiUpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
  error?: string;
}

/** 查询 npm registry 上的最新 Pi CLI 版本，与本机已安装版本对比。customPath 透传给定位（手动路径同样可查更新）。 */
async function checkPiUpdate(customPath = ""): Promise<PiUpdateCheck> {
  const located = await locatePi(customPath);
  const current = located.version;
  if (!located.found) return { current: "", latest: "", updateAvailable: false, error: located.error ?? "未检测到本机 pi 命令" };
  const viewed = await runCommand("npm", ["view", PI_NPM_PACKAGE, "version"], 20000);
  const latest = viewed.code === 0 ? viewed.output.split(/\s+/).filter(Boolean).at(-1) ?? "" : "";
  if (!latest) return { current, latest: "", updateAvailable: false, error: "无法查询最新版本，请检查网络" };
  return { current, latest, updateAvailable: latest !== current };
}

export interface PiUpdateResult {
  ok: boolean;
  from: string;
  to: string;
  /** 安装输出尾部（排错用） */
  log: string;
}

/**
 * 用识别到的 pi 自己更新（`pi update --self`）。
 * Pi 可能由 npm、pnpm、bun 或官方安装器管理，不能写死 `npm install -g`；
 * `pi update` 会按实际安装方式选择更新命令。
 */
async function updatePi(customPath = "", scope: "self" | "all" = "self"): Promise<PiUpdateResult> {
  const before = await locatePi(customPath);
  const from = before.version;
  if (!before.found || !before.path) return { ok: false, from: "", to: "", log: before.error ?? "未检测到本机 pi 命令" };
  const bin = before.path.includes(" ") ? `"${before.path}"` : before.path;
  const args = scope === "all" ? ["update", "--all", "--no-approve"] : ["update", "--no-approve"];
  const installed = await runCommand(bin, args, 180000);
  const tail = installed.output.split(/\r?\n/).slice(-30).join("\n");
  if (installed.code !== 0) return { ok: false, from, to: from, log: tail || "pi update 异常退出" };
  const after = await locatePi(customPath);
  return { ok: after.found, from, to: after.version || from, log: tail };
}

const TITLEBAR_HEIGHT = 40;

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isAllowedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return path.normalize(fileURLToPath(url)) === path.normalize(DIST_HTML);
    }
    if (app.isPackaged) return false;
    return url.origin === DEV_ORIGIN;
  } catch {
    return false;
  }
}

function isAllowedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  return isAllowedRendererUrl(frame.url);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#111214",
    title: "Pi Desktop",
    icon: path.join(HERE, "../build/icon.png"),
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
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault();
  });
  // Chromium 自带 Ctrl/Cmd + - / + / 0 页面缩放。缩放只允许设置页，
  // 这里把这些组合（含 Shift、小键盘）全部吃掉，避免和输入法抢键。
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if ((!input.control && !input.meta) || input.alt) return;
    const zoom =
      input.code === "Minus" || input.code === "NumpadSubtract" ||
      input.code === "Equal" || input.code === "NumpadAdd" ||
      input.key === "+" || input.key === "-" || input.key === "=" ||
      input.code === "Digit0" || input.code === "Numpad0";
    if (zoom) event.preventDefault();
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

const workspaceChannels = new Set([
  "pi:forget", "pi:snapshot", "pi:prepare-attachments", "pi:list-directory",
  "pi:read-workspace-file", "pi:write-workspace-file", "pi:open-workspace-path",
  "pi:create-workspace-entry", "pi:rename-workspace-entry", "pi:delete-workspace-entry",
  "pi:git-overview", "pi:git-inspect", "pi:complete-paths", "pi:restart", "pi:sessions",
  "pi:delete-session", "pi:remove-project", "pi:call", "pi:extension-ui", "pi:mcp-overview",
  "pi:mcp-probe", "pi:mcp-save-server", "pi:mcp-update-server", "pi:mcp-remove-server",
  "pi:mcp-set-auto-codemode", "pi:mcp-import-json", "pi:packages-overview", "pi:packages-install",
  "pi:packages-remove", "pi:packages-update", "pi:skills-overview",
]);

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isAllowedSender(event)) throw new Error("不允许的 IPC 调用来源");
    if (workspaceChannels.has(channel) && typeof args[0] === "string") {
      args[0] = await authorizedCwd(args[0]);
    }
    return plain(await fn(...args));
  });
}

app.whenReady().then(() => {
  handle("pi:locate", (customPath = "") => locatePi(customPath));
  handle("pi:check-update", (customPath = "") => checkPiUpdate(customPath));
  handle("pi:update", (customPath = "", scope: "self" | "all" = "self") => updatePi(customPath, scope === "all" ? "all" : "self"));
  // 界面缩放完全由设置页控制（不再设全局快捷键，避免与输入法/阅读器冲突）。
  handle("pi:set-zoom", (factor: number) => {
    const next = Math.min(3, Math.max(0.5, Number(factor) || 1));
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setZoomFactor(next);
    } catch {
      /* 忽略窗口已关闭等竞态 */
    }
    return next;
  });
  handle("pi:recent", async () => {
    const recent = await readRecent(recentFile());
    const authorized: string[] = [];
    for (const cwd of recent) {
      try { authorized.push(await host.authorizeWorkspace(cwd)); } catch { /* drop stale/unavailable roots */ }
    }
    return [...new Set(authorized)];
  });
  handle("pi:forget", async (cwd: string) => {
    const authorized = await authorizedCwd(cwd);
    host.revokeWorkspace(authorized);
    return forgetRecent(recentFile(), authorized);
  });
  handle("pi:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return host.authorizeWorkspace(result.filePaths[0]);
  });
  handle("pi:choose-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      title: "添加文件",
    });
    if (!result.canceled) host.authorizeAttachmentPaths(result.filePaths);
    return result.canceled ? [] : result.filePaths;
  });
  handle("pi:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "添加文件夹",
    });
    if (!result.canceled) host.authorizeAttachmentPaths(result.filePaths);
    return result.canceled ? null : result.filePaths[0];
  });
  handle("pi:open", async (cwd: string) => {
    const authorized = await host.authorizeWorkspace(cwd);
    const result = await host.open(authorized);
    await writeRecent(recentFile(), authorized);
    return result;
  });
  handle("pi:snapshot", (cwd: string, sessionFile?: string) => host.snapshot(cwd, sessionFile));
  handle("pi:prepare-attachments", (cwd: string, paths: string[]) => host.prepareAttachments(cwd, paths));
  handle("pi:list-directory", (cwd: string, relative: string) => host.listDirectory(cwd, relative));
  handle("pi:read-workspace-file", (cwd: string, relative: string) => host.readWorkspaceFile(cwd, relative));
  handle("pi:write-workspace-file", (cwd: string, relative: string, content: string) => host.writeWorkspaceFile(cwd, relative, content));
  handle("pi:open-workspace-path", async (cwd: string, relative: string) => shell.openPath(await host.openWorkspacePath(cwd, relative)));
  handle("pi:create-workspace-entry", (cwd: string, parent: string, name: string, kind: "file" | "folder") => host.createWorkspaceEntry(cwd, parent, name, kind));
  handle("pi:rename-workspace-entry", (cwd: string, relative: string, name: string) => host.renameWorkspaceEntry(cwd, relative, name));
  handle("pi:delete-workspace-entry", (cwd: string, relative: string) => host.deleteWorkspaceEntry(cwd, relative));
  handle("pi:git-overview", (cwd: string) => host.gitOverview(cwd));
  handle("pi:git-inspect", (cwd: string, kind: "commit" | "working", target: string) => host.gitInspect(cwd, kind, target));
  handle("pi:complete-paths", (cwd: string, query: string) => host.completePaths(cwd, query));
  handle("pi:restart", (cwd: string, sessionFile?: string) => host.restart(cwd, sessionFile));
  handle("pi:sessions", (cwd: string) => host.sessions(cwd));
  handle("pi:delete-session", (cwd: string, file: string) => host.deleteSession(cwd, file));
  handle("pi:remove-project", async (cwd: string, { deleteSessions = false }: { deleteSessions?: boolean } = {}) => {
    await host.close(cwd);
    const result = deleteSessions ? await host.deleteAllSessions(cwd) : { deleted: 0, failed: 0 };
    host.revokeWorkspace(cwd);
    return { ...result, recent: await forgetRecent(recentFile(), cwd) };
  });
  handle("pi:call", (cwd: string, method: string, args: any[], sessionFile?: string) => host.call(cwd, method, args, sessionFile));
  handle("pi:extension-ui", (cwd: string, response: Record<string, any>, sessionFile?: string) => host.respondExtensionUi(cwd, response, sessionFile));
  handle("pi:reveal", (target: string) => {
    if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("无效的文件路径");
    return shell.showItemInFolder(target);
  });
  handle("pi:mcp-overview", (cwd?: string) => host.mcpOverview(cwd));
  handle("pi:mcp-probe", (cwd?: string) => host.mcpProbe(cwd));
  handle("pi:mcp-save-server", (cwd: string, payload: any) => host.mcpSaveServer(cwd, payload));
  handle("pi:mcp-update-server", (cwd: string, payload: any) => host.mcpUpdateServer(cwd, payload));
  handle("pi:mcp-remove-server", (cwd: string, payload: any) => host.mcpRemoveServer(cwd, payload));
  handle("pi:mcp-set-auto-codemode", (cwd: string, payload: any) => host.mcpSetAutoCodemode(cwd, payload));
  handle("pi:mcp-import-json", (cwd: string, payload: any) => host.mcpImportJson(cwd, payload));
  handle("pi:packages-overview", (cwd?: string) => host.packagesOverview(cwd));
  handle("pi:packages-install", (cwd: string, payload: any) => host.packagesInstall(cwd, payload));
  handle("pi:packages-remove", (cwd: string, payload: any) => host.packagesRemove(cwd, payload));
  handle("pi:packages-update", (cwd: string, payload?: any) => host.packagesUpdate(cwd, payload));
  handle("pi:skills-overview", (cwd?: string) => host.skillsOverview(cwd));
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
