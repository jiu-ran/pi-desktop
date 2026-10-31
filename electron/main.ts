import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiHost, readRecent, writeRecent, forgetRecent } from "./pi-host.ts";
import { piCliEntryFromExecutable, resolvePiEntryFromSystem } from "./pi-entry.ts";
import { TerminalHost } from "./terminal-host.ts";
import { listTerminalProfiles, resolveTerminalProfile, type TerminalPtyOptions } from "./terminal-profiles.ts";
import { createAppUpdateManager, MANUAL_CHECK_CACHE_MS } from "./network/update.ts";
import { atomicWriteText } from "./atomic-file.ts";
import { activity, logPerfLine, withActivity } from "./perf-log.ts";
import { isWritableDir, log, logStore, useAppLogs } from "./logger.ts";
import { runStartupMaintenance } from "./maintenance.ts";
import { cleanLegacyProjectArtifacts } from "./project-cleanup.ts";
import type { AppUpdateCheckResult } from "./network/update.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ownsInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

// 开发实例使用独立 profile：
// Electron 的 userData 目录取自 package.json 的 productName，而 dev 与已安装版本
// 用的是同一份 package.json，两个进程会抢同一个 Cache/GPUCache，
// 启动时报 "Unable to move the cache: 拒绝访问 (0x5)" / "Gpu Cache Creation failed"。
// dev 独立目录后，已安装版本可以与 npm run dev 同时运行。
if (!app.isPackaged) {
  const profile = process.env.PI_DESKTOP_PROFILE || "Pi Desktop Dev";
  const dir = path.join(app.getPath("appData"), profile);
  try {
    mkdirSync(dir, { recursive: true });
    app.setPath("userData", dir);
  } catch {
    // 目录不可写时退回默认 profile，不影响启动
  }
}
/**
 * 日志目录：安装目录下的 `logs/`，跟程序放在一起（好找，也方便打给别人）。
 *
 * 整机安装（装在 Program Files、非管理员运行）时安装目录不可写，
 * 这时回落到 userData，保证日志一定落得下去。总量上限 100MB。
 */
async function resolveLogDir(): Promise<string> {
  // 开发时落在仓库根目录，和打包版行为一致（打包后 __dirname 在 resources 里，用 exe 位置）
  const installRoot = app.isPackaged ? path.dirname(app.getPath("exe")) : path.resolve(HERE, "..");
  const preferred = path.join(installRoot, "logs");
  if (await isWritableDir(preferred)) return preferred;
  return path.join(app.getPath("userData"), "logs");
}

let logDirPromise: Promise<string> | null = null;

/** 启动时调用一次：之后所有日志都写这个目录。 */
function activateLogs(): void {
  logDirPromise ??= resolveLogDir()
    .then(async (dir) => {
      await useAppLogs(dir);
      return dir;
    })
    .catch(() => "");
}

process.on("uncaughtException", (error) => {
  log.error("main", `未捕获异常：${error?.stack ?? error}`);
});
process.on("unhandledRejection", (reason: any) => {
  log.error("main", `未处理的 Promise 拒绝：${reason?.stack ?? reason}`);
});

/** 剪贴板粘贴图片：允许的 MIME → 扩展名 */
const PASTE_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};
/** base64 长度上限约 20MB 原图 */
const PASTE_IMAGE_MAX_BASE64 = 20 * 1024 * 1024 * 1.4;
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
// 渲染进程崩溃时留一份本地转储（不上传）：没有 dump 时只能看到 "crashed" 两个字，
// 有 dump 才能拿给 Chromium 的符号工具看栈。
try {
  crashReporter.start({ uploadToServer: false, productName: "Pi Desktop" });
} catch (error) {
  log.warn("app", `崩溃转储不可用：${(error as Error)?.message ?? error}`);
}

/** 渲染进程崩溃记录（跨启动累计，只留最近 24 小时），用来判断要不要关掉硬件加速 */
const RENDERER_CRASH_FILE = () => path.join(app.getPath("userData"), "renderer-crashes.json");
const RENDERER_CRASH_WINDOW_MS = 24 * 60 * 60 * 1000;

function readRecentRendererCrashes(): Array<{ at: number; reason: string }> {
  try {
    const parsed = JSON.parse(readFileSync(RENDERER_CRASH_FILE(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (item): item is { at: number; reason: string } =>
        typeof item?.at === "number" && now - item.at < RENDERER_CRASH_WINDOW_MS,
    );
  } catch {
    return [];
  }
}

function recordRendererCrash(reason: string): number {
  const next = [...readRecentRendererCrashes(), { at: Date.now(), reason }];
  try {
    writeFileSync(RENDERER_CRASH_FILE(), JSON.stringify(next.slice(-20)), "utf8");
  } catch {
    // 记不下就算了：退避策略只是兜底，不能因为写文件失败影响崩溃恢复
  }
  return next.length;
}

// 硬件加速是 Chromium 偶发崩溃最常见的来源。连续崩到一定次数就先关掉它，
// 让应用以软件渲染跑起来 —— 分辨率低一点，总比随机黑屏强。
const gpuDisabledByEnv = process.env.PI_DESKTOP_DISABLE_GPU === "1";
const recentCrashCount = readRecentRendererCrashes().length;
if (gpuDisabledByEnv || recentCrashCount >= 3) {
  app.disableHardwareAcceleration();
  log.warn(
    "app",
    gpuDisabledByEnv
      ? "已按 PI_DESKTOP_DISABLE_GPU=1 关闭硬件加速"
      : `已关闭硬件加速：最近 24 小时渲染进程崩溃 ${recentCrashCount} 次`,
  );
}

let mainWindow: BrowserWindow | null = null;
let terminalFocused = false;

/**
 * 放大动画交给系统，动画结束后补一次全屏。
 *
 * 原生最大化的客户区比屏幕矮 1 DIP（实测 1536×863 vs 1536×864），矮掉的那条露出的
 * 是窗口外面的桌面 —— 深色界面下就是底部一条白线。全屏的客户区正好等于屏幕
 * （实测 1536×864），而且全屏窗口不画圆角、内容也不位移，所以等放大动画跑完
 * （实测约 250ms）再切全屏，正好把这条缝补掉，前后只差 1 DIP。
 *
 * 代价：最大化状态变成 fullscreen，isMaximized() 不能直接用，统一走 windowIsMaximized()。
 */
const FILL_SCREEN_DELAY = 260;
let fillTimer: NodeJS.Timeout | null = null;
let restoreAfterFullscreen = false;

function windowIsMaximized(): boolean {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return false;
  return win.isFullScreen() || win.isMaximized();
}

/** 放大动画结束后切全屏补齐底部那 1 DIP（macOS / Linux 有系统标题栏，不需要） */
function fillScreenAfterMaximize(): void {
  if (process.platform !== "win32") return;
  if (fillTimer) clearTimeout(fillTimer);
  fillTimer = setTimeout(() => {
    fillTimer = null;
    const win = mainWindow;
    if (!win || win.isDestroyed() || win.isFullScreen() || !win.isMaximized()) return;
    win.setFullScreen(true);
    pushWindowState();
  }, FILL_SCREEN_DELAY);
}

function cancelFillScreen(): void {
  if (!fillTimer) return;
  clearTimeout(fillTimer);
  fillTimer = null;
}

function pushWindowState(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send("app:window-state", {
    maximized: windowIsMaximized(),
    fullscreen: win.isFullScreen(),
  });
}

const host = new PiHost({
  emit(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pi:event", plain(payload));
  },
  trash: (file) => shell.trashItem(file),
  worktreeRoot: path.join(app.getPath("userData"), "worktrees"),
  piEntry: resolvePiEntry,
});

const terminalHost = new TerminalHost({
  emit(event) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("pi:terminal-event", plain(event));
  },
});

const recentFile = () => path.join(app.getPath("userData"), "recent-workspaces.json");

async function authorizedCwd(cwd: string): Promise<string> {
  return host.requireAuthorizedWorkspace(cwd);
}

export const PI_NPM_PACKAGE = ["@earendil-works", "pi-coding-agent"].join("/");

/** 设置里手动指定的 Pi 路径（空 = 只从 PATH 识别）；会话启动时也按它解析 */
let piCustomPath = "";

/**
 * 解析本机 Pi 的 `dist/cli.js`：先看手动路径 / PATH，再看 npm 全局 node_modules。
 * 桌面端不跑内置 Pi（见 docs/product-boundary.md），拿不到入口就直接报错，让界面提示安装。
 */
async function resolvePiEntry(): Promise<string> {
  const located = await locatePi(piCustomPath);
  if (!located.found) throw new Error(located.error ?? "没有找到本机 Pi CLI，请先安装 pi 或到「设置 → Pi CLI」指定路径");
  const direct = piCliEntryFromExecutable(located.path);
  if (direct) return direct;
  const fallback = await resolvePiEntryFromSystem(located.path);
  if (fallback) return fallback;
  throw new Error(
    `已找到 pi（${located.path}），但没能定位到它的 dist/cli.js。请用 npm 安装 Pi，或在「设置 → Pi CLI」直接指定 node_modules/@earendil-works/pi-coding-agent/dist/cli.js`,
  );
}

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
    // Node.js 22 (DEP0190): 启用 shell: true 时若传递 args 数组会触发 DeprecationWarning。
    // 将命令与参数拼成单一命令行字符串传入，彻底消除警告并确保 Windows 下 .cmd shim 正常执行。
    const cmdLine = args.length ? `${command} ${args.join(" ")}` : command;
    const child = spawn(cmdLine, { shell: true, timeout: timeoutMs, windowsHide: true });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.once("error", () => resolve({ code: -1, output: output.trim() }));
    child.once("close", (code) => resolve({ code: code ?? -1, output: output.trim() }));
  });
}

/**
 * 把一个可执行文件路径安全地包成 shell 参数。
 * runCommand 使用 shell:true 才能运行 npm 在 Windows 上生成的 .cmd shim，
 * 但用户手选的 Pi 路径可能包含空格/& 等字符，必须加引号并拒绝会破坏引号的字符。
 */
function quoteShellPath(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error("Pi 路径包含不支持的换行或空字符");
  if (process.platform === "win32") {
    if (value.includes('"')) throw new Error("Pi 路径包含不支持的引号");
    return `"${value}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  const quoted = quoteShellPath(bin);
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

// AppUpdateCheckResult 类型已从 network/update.ts 导入
type AppUpdateCheck = AppUpdateCheckResult;

// 应用更新管理器实例
const appUpdateManager = createAppUpdateManager();

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
  const bin = quoteShellPath(before.path);
  const args = scope === "all" ? ["update", "--all", "--no-approve"] : ["update", "--no-approve"];
  const installed = await runCommand(bin, args, 180000);
  const tail = installed.output.split(/\r?\n/).slice(-30).join("\n");
  if (installed.code !== 0) return { ok: false, from, to: from, log: tail || "pi update 异常退出" };
  const after = await locatePi(customPath);
  return { ok: after.found, from, to: after.version || from, log: tail };
}

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

/** 渲染进程卡死时抓调用栈：CDP 的 Debugger.pause 能中断同步死循环。 */
let dumpingRendererStack = false;

/**
 * 主动 ping 渲染进程：卡死时 ping 不会返回。
 *
 * 不用 Chromium 的 unresponsive 事件，也不用自己的 IPC 心跳——前者在某些环境
 * （窗口被遮挡、无 GPU）不触发，后者卡死时同样发不出去，出问题就查不出所以然。
 * 这里每 5 秒发一个 executeJavaScript("1")，15 秒没回应就当作卡死。
 */
const PING_INTERVAL_MS = 5000;
const PING_STALE_MS = 15_000;
const PING_DUMP_INTERVAL_MS = 60_000;
const rendererPing = { pendingAt: 0, lastDumpAt: 0 };

export function startRendererWatchdog(win: BrowserWindow): () => void {
  const timer = setInterval(() => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    // 页面还在加载时不判卡死：加载本身慢，否则日志里会全是误报。
    if (win.webContents.isLoading()) return;
    const now = Date.now();
    if (rendererPing.pendingAt) {
      const waited = now - rendererPing.pendingAt;
      if (waited < PING_STALE_MS) return;
      if (now - rendererPing.lastDumpAt >= PING_DUMP_INTERVAL_MS) {
        rendererPing.lastDumpAt = now;
        log.error("renderer", `渲染进程 ${Math.round(waited / 1000)} 秒没有响应 ping（界面卡死），抓取调用栈`);
        void dumpRendererStack(win, `ping ${Math.round(waited / 1000)}s 无响应`);
      }
      rendererPing.pendingAt = 0;
      return;
    }
    if (win.webContents.isLoading()) return;
    rendererPing.pendingAt = now;
    const startedAt = now;
    win.webContents
      .executeJavaScript("0")
      .then(() => {
        const took = Date.now() - startedAt;
        if (took > 2000) log.warn("renderer", `ping 耗时 ${took}ms（界面可能正在卡）`);
      })
      .catch(() => {})
      .finally(() => {
        rendererPing.pendingAt = 0;
      });
  }, PING_INTERVAL_MS);
  (timer as any).unref?.();
  return () => clearInterval(timer);
}
/**
 * 提前把调试器挂上（只 enable，不 pause）。
 *
 * 这一条是抓栈能成功的关键：如果等卡死之后才 attach + Debugger.enable，
 * 那两个命令本身也要排队等渲染进程回应，永远回不来。启动时就挂好，
 * 卡死时只剩一个 Debugger.pause —— 它走 V8 中断，能在死循环里停下来。
 */
let rendererDebuggerArmed = false;
async function armRendererDebugger(win: BrowserWindow): Promise<void> {
  if (rendererDebuggerArmed) return;
  // 挂在调试器上会挡住 DevTools（同一个 target 只能有一个调试器），
  // 开发版默认不挂；打包版没有 DevTools，默认就挂。
  if (!app.isPackaged && !process.env.PI_DESKTOP_TRACE_HANG) return;
  const dbg = win.webContents.debugger;
  try {
    if (!dbg.isAttached()) await dbg.attach("1.3");
    await dbg.sendCommand("Debugger.enable");
    rendererDebuggerArmed = true;
  } catch (error: any) {
    log.warn("renderer", `调试器挂载失败，卡死时将只能拿到「无法暂停」：${error?.message ?? error}`);
  }
}

async function dumpRendererStack(win: BrowserWindow, reason: string): Promise<void> {
  if (dumpingRendererStack) return;
  dumpingRendererStack = true;
  const dbg = win.webContents.debugger;
  // 正常情况下启动时已挂好（见 armRendererDebugger）；没挂上就临时补挂，尽力而为。
  const attachedHere = !dbg.isAttached();
  // 卡死的渲染进程不会回应任何调试命令（Debugger.enable 也可能一直挂着），
  // 所以每条命令都要有超时；pause 靠 V8 中断实现，即使 JS 在死循环里也能暂停。
  const send = (method: string, ms: number) =>
    Promise.race([
      dbg.sendCommand(method),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${method} 超时 ${ms}ms`)), ms)),
    ]);
  try {
    if (attachedHere) await Promise.race([
      dbg.attach("1.3"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("attach 超时")), 4000)),
    ]);
    const paused = new Promise<any>((resolve) => {
      const onMessage = (_event: unknown, method: string, params: any) => {
        if (method !== "Debugger.paused") return;
        dbg.removeListener("message", onMessage);
        resolve(params);
      };
      dbg.on("message", onMessage);
    });
    if (!rendererDebuggerArmed) {
      await send("Debugger.enable", 4000).catch((error: any) => log.warn("renderer", `${error.message}`));
    }
    await send("Debugger.pause", 4000).catch((error: any) => log.warn("renderer", `${error.message}`));
    const params = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (!params) {
      log.warn("renderer", `渲染进程无响应且无法暂停（${reason}）：可能是原生死循环`);
      return;
    }
    const frames = (params.callFrames ?? []).slice(0, 24).map((frame: any, index: number) => {
      const file = String(frame.url || "").split("/").filter(Boolean).pop() || "(inline)";
      const name = frame.functionName || "(anonymous)";
      return `  #${index} ${name} ${file}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`;
    });
    log.error("renderer", `渲染进程卡在（${reason}）：\n${frames.join("\n")}`);
    await send("Debugger.resume", 3000).catch(() => {});
  } catch (error: any) {
    log.warn("renderer", `抓取渲染进程调用栈失败：${error?.message ?? error}`);
    return;
  } finally {
    // 挂好的调试器要留着：下一次卡死还要靠它抓栈。
    if (attachedHere) {
      try {
        dbg.detach();
      } catch {
        // 已经断开
      }
      rendererDebuggerArmed = false;
    }
    dumpingRendererStack = false;
  }
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
    // Windows / Linux 用自绘窗口按钮（系统按钮悬停没有任何反馈）；
    // macOS 保留系统红绿灯，只把标题栏做透明。
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("maximize", () => {
    fillScreenAfterMaximize();
    pushWindowState();
  });
  mainWindow.on("unmaximize", () => {
    cancelFillScreen();
    pushWindowState();
  });
  mainWindow.on("enter-full-screen", () => pushWindowState());
  mainWindow.on("leave-full-screen", () => {
    const win = mainWindow;
    // 「全屏补齐」状态下点还原：退出全屏后再退回原尺寸，动画仍是系统的
    if (restoreAfterFullscreen && win && !win.isDestroyed()) {
      restoreAfterFullscreen = false;
      win.unmaximize();
    }
    pushWindowState();
  });

  // 渲染进程卡死时没有任何日志（不重绘、不跑定时器），只有调用栈能说明它在转什么。
  // 卡死是偶发的，所以必须自动抓：Chromium 判定无响应后暂停 V8 并把栈写进日志。
  mainWindow.webContents.on("unresponsive", () => {
    log.warn("renderer", "渲染进程无响应（unresponsive），开始抓取调用栈");
    void dumpRendererStack(mainWindow!, "unresponsive");
  });
  mainWindow.webContents.on("responsive", () => {
    log.info("renderer", "渲染进程已恢复响应");
  });
  startRendererWatchdog(mainWindow);
  void armRendererDebugger(mainWindow);
  // 渲染进程崩溃后窗口会停在纯黑：页面没了、主进程还在、也没人重建它，用户只能重启。
  // 所以崩溃就自动重载；一分钟内连崩三次说明那个页面一加载就崩，改用原生对话框，
  // 别在崩溃循环里空转（原生对话框不依赖渲染进程，黑屏时仍然能用）。
  const rendererCrashes: number[] = [];
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer", `渲染进程退出：${details?.reason ?? "unknown"}（exitCode=${details?.exitCode ?? "?"}）`);
    if (details?.reason === "clean-exit") return;
    // 崩溃时把各进程内存写进日志：OOM 引起的崩溃在这里会很明显
    try {
      const metrics = app.getAppMetrics().map((item) => {
        const mem = item.memory ?? ({} as (typeof item)["memory"]);
        return `${item.type}#${item.pid} ${Math.round((mem.workingSetSize ?? 0) / 1024)}MB`;
      });
      log.error("renderer", `崩溃时进程内存：${metrics.join(" · ")}`);
    } catch {
      // 指标拿不到不影响恢复
    }
    log.warn("renderer", `最近 24 小时第 ${recordRendererCrash(details?.reason ?? "unknown")} 次崩溃`);
    const now = Date.now();
    rendererCrashes.push(now);
    while (rendererCrashes.length && now - rendererCrashes[0]! > 60_000) rendererCrashes.shift();
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    if (rendererCrashes.length < 3) {
      setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.reload();
      }, 800);
      return;
    }
    rendererCrashes.length = 0;
    void dialog
      .showMessageBox(window, {
        type: "error",
        title: "界面渲染进程崩溃",
        message: "界面进程反复崩溃，窗口已经无法继续显示。",
        detail: `原因：${details?.reason ?? "unknown"}（exitCode=${details?.exitCode ?? "?"}）。\n日志目录里的 renderer.log / app.log 有对应记录。`,
        buttons: ["重新加载界面", "退出"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (window.isDestroyed()) return;
        if (result.response === 0) window.webContents.reload();
        else app.quit();
      });
  });
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning", title: "存在未保存的修改",
      message: "关闭或刷新会丢失文件编辑器中尚未保存的草稿。",
      buttons: ["取消，返回保存", "放弃修改并继续"], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  terminalFocused = false;
  mainWindow.webContents.on("did-start-loading", () => {
    terminalFocused = false;
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.setIgnoreMenuShortcuts(false);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-frame-navigate", (event) => {
    if (!isAllowedRendererUrl(event.url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault();
  });
  // Chromium 自带 Ctrl/Cmd + - / + / 0 页面缩放。缩放只允许设置页，
  // 这里把这些组合（含 Shift、小键盘）全部吃掉，避免和输入法抢键。
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || terminalFocused) return;
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
  "pi:forget", "pi:snapshot", "pi:prepare-attachments", "pi:prepare-session-attachments", "pi:list-directory",
  "pi:read-workspace-file", "pi:write-workspace-file", "pi:open-workspace-path",
  "pi:create-workspace-entry", "pi:rename-workspace-entry", "pi:delete-workspace-entry",
  "pi:git-overview", "pi:git-branches", "pi:git-inspect", "pi:git-worktrees", "pi:git-worktree-create", "pi:git-worktree-remove", "pi:git-worktree-merge", "pi:complete-paths", "pi:restart", "pi:sessions",
  "pi:delete-session", "pi:message-page", "pi:remove-project", "pi:call", "pi:extension-ui",
  "pi:project-trust", "pi:project-trust-set", "pi:import-session", "pi:export-session-jsonl", "pi:mcp-overview", "pi:git-action",
  "pi:mcp-probe", "pi:mcp-save-server", "pi:mcp-update-server", "pi:mcp-remove-server",
  "pi:mcp-set-auto-codemode", "pi:mcp-import-json", "pi:packages-overview", "pi:packages-install",
  "pi:packages-remove", "pi:packages-update", "pi:skills-overview", "pi:terminal-start", "pi:terminal-shell", "pi:terminal-pty",
]);

/** 超过这个耗时的 IPC 会记一条：界面「卡住」时能直接看到是哪个调用慢。 */
const SLOW_IPC_MS = 400;

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isAllowedSender(event)) throw new Error("不允许的 IPC 调用来源");
    const started = Date.now();
    let phase = "鉴权";
    try {
      if (workspaceChannels.has(channel) && typeof args[0] === "string") {
        args[0] = await authorizedCwd(args[0]);
      }
      phase = "执行";
      return plain(await withActivity(channel, () => fn(...args)));
    } catch (error: any) {
      // IPC 失败也要留痕：界面上只看到一句提示，真正的原因经常只在日志里。
      log.error("ipc", `${channel} 失败（${phase}）：${error?.message ?? String(error)}`);
      throw error;
    } finally {
      const cost = Date.now() - started;
      if (cost >= SLOW_IPC_MS) logPerfLine(`IPC ${channel} ${phase}耗时 ${cost}ms`);
    }
  });
}

app.on("render-process-gone", (_event, contents, details) => {
  log.error("window", `渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`);
});
app.on("child-process-gone", (_event, details) => {
  log.warn("app", `子进程退出：${details.type} ${details.reason}（exitCode=${details.exitCode}）`);
});

app.on("browser-window-created", (_event, window) => {
  log.info("window", `创建窗口 ${window.id}`);
  window.on("closed", () => log.info("window", `关闭窗口 ${window.id}`));
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/**
 * 主进程事件循环卡顿日志。
 *
 * 窗口绘制、IPC 分发都在主进程：一旦这里被同步阻塞（例如解析超大会话文件），
 * 整个界面会像冻住一样。记录超过 1 秒的阻塞，出问题时能直接看出发生了什么。
 */
function startLagWatchdog(): void {
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - 1000;
    last = now;
    if (lag < 1000) return;
    const label = activity();
    logPerfLine(label ? `主进程阻塞 ${lag}ms（${label}）` : `主进程阻塞 ${lag}ms`);
  }, 1000);
  (timer as any).unref?.();
}

app.whenReady().then(() => {
  activateLogs();
  if (!ownsInstance) return;
  handle("pi:locate", (customPath = "") => {
    // 记下手动路径：会话启动时要按同一个路径解析 pi 入口
    piCustomPath = String(customPath ?? "").trim();
    host.invalidatePiEntry();
    return locatePi(customPath);
  });
  handle("pi:check-update", (customPath = "") => checkPiUpdate(customPath));
  handle("app:check-update", (options: { manual?: boolean } = {}) =>
    appUpdateManager.check({ maxAgeMs: options?.manual ? MANUAL_CHECK_CACHE_MS : undefined }),
  );
  handle("app:download-update", () => appUpdateManager.download());
  handle("app:cancel-update", () => appUpdateManager.cancelDownload());
  // 终端 Ctrl+V 读取系统剪贴板；渲染进程的 navigator.clipboard.readText 在部分平台上需要额外权限。
  handle("app:read-clipboard", () => clipboard.readText());
  handle("app:install-update", (version = "") => appUpdateManager.install(version));
  handle("app:open-update", (url = "") => {
    if (!isAllowedExternalUrl(url)) return false;
    return shell.openExternal(url).then(() => true, () => false);
  });
  // markdown 里 Ctrl+点击外部链接（app:open-update 只给更新提示用，语义不同）
  handle("app:open-external", (url = "") => {
    if (!isAllowedExternalUrl(url)) return false;
    return shell.openExternal(url).then(() => true, () => false);
  });
  handle("pi:update", async (customPath = "", scope: "self" | "all" = "self") => {
    const result = await updatePi(customPath, scope === "all" ? "all" : "self");
    // Pi 刚被换过版本：下次起 worker 要重新解析入口（路径通常不变，但缓存不能留旧值）
    if (result.ok) host.invalidatePiEntry();
    return result;
  });
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
  // 渲染进程的长任务（>1s）也记到同一份日志里：卡死可能出在渲染侧，
  // 只记主进程会让人误以为主进程没问题。
  ipcMain.on("perf:long-task", (event, payload: any) => {
    if (!isAllowedSender(event)) return;
    const ms = Number(payload?.ms);
    const label = typeof payload?.label === "string" ? payload.label.slice(0, 80) : "";
    if (!Number.isFinite(ms) || ms < 1000) return;
    logPerfLine(`渲染进程长任务 ${Math.round(ms)}ms${label ? `（${label}）` : ""}`);
  });
  // 渲染进程上报的日志（console.warn/error、Vue 错误、未捕获异常）
  ipcMain.on("app:log-event", (event, payload: any) => {
    if (!isAllowedSender(event)) return;
    const level = ["debug", "info", "warn", "error"].includes(payload?.level) ? payload.level : "info";
    const scope = typeof payload?.scope === "string" ? payload.scope.slice(0, 40) : "renderer";
    const message = typeof payload?.message === "string" ? payload.message.slice(0, 8000) : "";
    if (!message) return;
    log.renderer(level, scope, message);
  });
  handle("app:logs-info", async () => logStore.summary());
  // 设置页调整日志总量上限：立刻生效并顺手清一次超量文件
  handle("app:set-log-limit", async (bytes: number) => logStore.setLimits(bytes));
  handle("app:logs-clear", async () => {
    await logStore.clear();
    log.info("logs", "日志已清空");
    return logStore.summary();
  });
  handle("app:logs-open", async () => {
    const summary = await logStore.summary();
    if (!summary.dir) return false;
    await mkdir(summary.dir, { recursive: true });
    await shell.openPath(summary.dir);
    return true;
  });
  // 打开日志所在的项目目录（日志目录本身可能还没创建）
  handle("app:logs-reveal", async () => {
    const summary = await logStore.summary();
    if (!summary.dir) return false;
    await shell.openPath(path.dirname(path.dirname(summary.dir)));
    return true;
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
  // 克隆不是「工作区内的 Git 操作」：调用方还没有项目，所以不进 workspaceChannels
  handle("pi:git-clone", (url: string, target: string) => host.gitClone(url, target));
  // 剪贴板图片（Ctrl+V）：写入临时目录后作为普通附件加入，不入仓、不污染工作区
  handle("pi:save-pasted-image", async (payload: { name?: string; mimeType?: string; data?: string } = {}) => {
    const mime = String(payload.mimeType ?? "image/png").toLowerCase();
    const ext = PASTE_IMAGE_TYPES[mime];
    if (!ext) throw new Error(`不支持的图片格式：${mime}`);
    const base64 = String(payload.data ?? "").replace(/^data:[^;]+;base64,/, "");
    if (!base64) throw new Error("剪贴板图片内容为空");
    if (base64.length > PASTE_IMAGE_MAX_BASE64) throw new Error("图片过大（最大 20MB）");
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      throw new Error("剪贴板图片解码失败");
    }
    if (!buffer.length) throw new Error("剪贴板图片内容为空");
    const dir = path.join(app.getPath("temp"), "pi-desktop-paste");
    await mkdir(dir, { recursive: true });
    const stem = String(payload.name ?? "pasted")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]+/g, "-")
      .slice(0, 40) || "pasted";
    const file = path.join(dir, `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    await writeFile(file, buffer);
    host.authorizeAttachmentPaths([file]);
    return file;
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
    // 把旧版本写进项目的日志目录与 .git/info/exclude 忽略行清掉（只清能确认是自己留的）
    void cleanLegacyProjectArtifacts(authorized);
    const result = await host.open(authorized);
    await writeRecent(recentFile(), authorized);
    return result;
  });
  handle("pi:snapshot", (cwd: string, sessionFile?: string) => host.snapshot(cwd, sessionFile));
  handle("pi:prepare-attachments", (cwd: string, paths: string[], authorizePaths?: string[]) => {
    host.authorizeAttachmentPaths(authorizePaths ?? []);
    return host.prepareAttachments(cwd, paths);
  });
  // @ 引用对话：会话可能在任意项目目录下，主进程只校验它在会话根目录内。
  handle("pi:prepare-session-attachments", (cwd: string, files: string[]) => host.prepareSessionAttachments(cwd, files));
  // @ 引用其它项目对话：跨项目只读列举，限 40 条，带 3 秒缓存
  handle("pi:cross-project-sessions", (limit?: number) => host.crossProjectSessions(limit));
  handle("pi:list-directory", (cwd: string, relative: string) => host.listDirectory(cwd, relative));
  handle("pi:read-workspace-file", (cwd: string, relative: string) => host.readWorkspaceFile(cwd, relative));
  handle("pi:write-workspace-file", (cwd: string, relative: string, content: string, revision?: string) => host.writeWorkspaceFile(cwd, relative, content, revision));
  handle("pi:open-workspace-path", async (cwd: string, relative: string) => shell.openPath(await host.openWorkspacePath(cwd, relative)));
  handle("pi:create-workspace-entry", (cwd: string, parent: string, name: string, kind: "file" | "folder") => host.createWorkspaceEntry(cwd, parent, name, kind));
  handle("pi:rename-workspace-entry", (cwd: string, relative: string, name: string) => host.renameWorkspaceEntry(cwd, relative, name));
  handle("pi:delete-workspace-entry", (cwd: string, relative: string) => host.deleteWorkspaceEntry(cwd, relative));
  handle("pi:git-overview", (cwd: string) => host.gitOverview(cwd));
  handle("pi:git-branches", (cwd: string) => host.gitBranches(cwd));
  handle("pi:git-action", (cwd: string, action: any, payload: any) => host.gitAction(cwd, action, payload));
  handle("pi:git-worktrees", (cwd: string) => host.gitWorktrees(cwd));
  handle("pi:git-worktree-create", (cwd: string, name: string, options?: any) => host.gitWorktreeCreate(cwd, name, options));
  handle("pi:git-worktree-remove", async (cwd: string, target: string, options?: any) => {
    const result = await host.gitWorktreeRemove(cwd, target, options);
    await forgetRecent(recentFile(), path.resolve(target));
    return result;
  });
  handle("pi:git-worktree-merge", (cwd: string, options: any) => host.gitWorktreeMerge(cwd, options));
  handle("pi:git-inspect", (cwd: string, kind: "commit" | "working" | "staged" | "unstaged", target: string) => host.gitInspect(cwd, kind, target));
  handle("pi:complete-paths", (cwd: string, query: string) => host.completePaths(cwd, query));
  handle("pi:restart", (cwd: string, sessionFile?: string) => host.restart(cwd, sessionFile));
  handle("pi:sessions", (cwd: string) => host.sessions(cwd));
  handle("pi:project-trust", (cwd: string) => host.projectTrust(cwd));
  handle("pi:project-trust-set", (cwd: string, action: "trust" | "trust-parent" | "distrust") => host.setProjectTrust(cwd, action));
  handle("pi:import-session", (cwd: string, file: string) => host.importSession(cwd, file));
  handle("pi:export-session-jsonl", (cwd: string, target?: string) => host.exportSessionJsonl(cwd, target));
  handle("pi:message-page", (cwd: string, file: string, endIndex?: number, limit?: number, minTurns?: number, minBlocks?: number) =>
    host.messagePage(cwd, file, endIndex, limit, minTurns, minBlocks),
  );
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
  handle("pi:terminal-start", (cwd: string, command: string, options?: TerminalPtyOptions) => terminalHost.startWithProfile(cwd, command, options));
  handle("pi:terminal-shell", (cwd: string) => terminalHost.startShell(cwd));
  handle("pi:terminal-pty", (cwd: string, cols?: number, rows?: number, options?: TerminalPtyOptions) => terminalHost.startPty(cwd, cols, rows, options));
  handle("pi:terminal-profiles", () => listTerminalProfiles());
  handle("pi:terminal-choose-executable", async () => {
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: "选择终端 shell 可执行文件",
      properties: ["openFile"],
      ...(process.platform === "win32" ? { filters: [{ name: "可执行程序", extensions: ["exe"] }] } : {}),
    });
    return selected.canceled ? null : selected.filePaths[0];
  });
  handle("pi:terminal-profile-validate", (options: TerminalPtyOptions) => resolveTerminalProfile(options));
  handle("pi:terminal-write", (id: string, input: string) => terminalHost.write(id, input));
  handle("pi:terminal-pty-write", (id: string, data: string, binary = false) => terminalHost.writePty(id, data, binary));
  handle("pi:terminal-pty-resize", (id: string, cols: number, rows: number) => terminalHost.resizePty(id, cols, rows));
  handle("pi:terminal-focus", (focused: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
    terminalFocused = focused === true;
    mainWindow.webContents.setIgnoreMenuShortcuts(terminalFocused);
    return true;
  });
  handle("pi:terminal-stop", (id: string) => terminalHost.stop(id));
  handle("pi:terminal-list", () => terminalHost.list());
  const agentsPath = path.join(homedir(), ".pi", "agent", "AGENTS.md");
  handle("pi:global-agents", async () => {
    try { return { path: agentsPath, content: await readFile(agentsPath, "utf8") }; }
    catch (error: any) { if (error?.code === "ENOENT") return { path: agentsPath, content: "" }; throw error; }
  });
  handle("pi:global-agents-save", async (content: string) => {
    if (typeof content !== "string" || content.length > 1024 * 1024) throw new Error("全局提示词不能超过 1 MB");
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await atomicWriteText(agentsPath, content);
    return { path: agentsPath, content };
  });
  /** 主题切换时同步窗口底色：无边框窗口在缩放 / 首帧时会露出来 */
  handle("app:window-background", (color = "#111214") => {
    try {
      mainWindow?.setBackgroundColor(String(color));
      return true;
    } catch {
      return false;
    }
  });

  /** 自绘窗口按钮：最小化 / 最大化切换 / 关闭 */
  handle("app:window-minimize", () => {
    mainWindow?.minimize();
    return true;
  });
  handle("app:window-toggle-maximize", () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return false;
    cancelFillScreen();
    if (win.isFullScreen()) {
      // 先退全屏，等 leave-full-screen 事件再把窗口退回原尺寸
      restoreAfterFullscreen = true;
      win.setFullScreen(false);
      pushWindowState();
      return false;
    }
    if (win.isMaximized()) {
      win.unmaximize();
      pushWindowState();
      return false;
    }
    win.maximize();
    return true;
  });
  handle("app:window-close", () => {
    mainWindow?.close();
    return true;
  });
  handle("app:window-state", () => ({
    maximized: windowIsMaximized(),
    fullscreen: Boolean(mainWindow?.isFullScreen()),
  }));

  log.info(
    "app",
    `启动 v${app.getVersion()} · ${process.platform}/${process.arch} · ${app.isPackaged ? "packaged" : "dev"} · userData=${app.getPath("userData")} · pi=${process.env.PI_CODING_AGENT_DIR || "默认"}`,
  );
  app.on("before-quit", () => {
    log.info("app", "退出");
    // 退出前把缓冲刷干净，否则最后几行会丢
    void logStore.flushAll();
  });
  void logStore.prune();
  createWindow();
  startLagWatchdog();

  // 升级后顺手清理旧安装包与过大的运行时缓存：放在窗口出来之后再跑，
  // 不占启动时间；失败也只是少清一次，不影响使用。
  setTimeout(() => {
    void runStartupMaintenance(app.getPath("userData")).then((result) => {
      if (!result.removedInstallers.length && !result.freedBytes) return;
      const freedMb = Math.round(result.freedBytes / (1024 * 1024));
      // 打包版没有终端：这类后台动作写进项目日志
      log.info("maintenance", `清理旧安装包 ${result.removedInstallers.length} 个，缓存 ${freedMb}MB`);
    }).catch(() => {});
  }, 5000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitting = false;
app.on("before-quit", async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  appUpdateManager.cancelDownload();
  await Promise.allSettled([terminalHost.dispose(), host.stopAll(), appUpdateManager.cleanup()]);
  app.exit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
