/**
 * 反向验证「渲染进程卡死能自动抓到调用栈」。
 *
 * 故意让渲染进程进一个 100 秒的同步死循环，等 Chromium 判定无响应后，
 * 主进程应该把 V8 调用栈写进 <项目>/.pi-desktop/logs/renderer.log。
 *
 * 手工跑：npx electron scripts/checks/_hang-probe.mjs
 */
import { app, BrowserWindow } from "electron";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Hang Probe";
// 开发版默认不挂调试器（会挡住 DevTools），这里显式打开以便验证抓栈
process.env.PI_DESKTOP_TRACE_HANG = "1";
if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = await mkdtemp(path.join(tmpdir(), "pi-hang-agent-"));
}
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.disableHardwareAcceleration();

const workspace = await mkdtemp(path.join(tmpdir(), "pi-hang-ws-"));

setTimeout(() => {
  console.error("[hang] FAIL 全局超时");
  app.exit(1);
}, 180_000);

// 注意：Electron 会等入口模块「加载完」才触发 ready，所以这里不能用顶层
// await app.whenReady()（会死锁），只能走 .then()。
await import("../../dist-electron/main.js");

app.whenReady().then(async () => {
let win = null;
for (let i = 0; i < 100 && !win; i += 1) {
  await new Promise((r) => setTimeout(r, 100));
  win = BrowserWindow.getAllWindows()[0] ?? null;
}
if (!win) {
  console.error("[hang] FAIL 没有窗口");
  app.exit(1);
}
await new Promise((r) => setTimeout(r, 1500));

// 先打开一个项目：日志跟着项目走，否则日志只会攒在内存里，看不到文件
await win.webContents
  .executeJavaScript(`window.__piDesktop.workbench.open(${JSON.stringify(workspace)}).then(() => "ok")`, true)
  .catch((error) => console.error("[hang] open 失败", error.message));
console.log("[hang] 项目已打开", workspace);

// 日志目录跟着「当前项目」走，探针里可能不是刚打开的那个：直接问 logStore
const { logStore } = await import("../../dist-electron/logger.js");
const logDir = logStore.directory || path.join(workspace, ".pi-desktop", "logs");
await new Promise((r) => setTimeout(r, 1200));
console.log("[hang] 日志目录", logDir, (await readdir(logDir).catch(() => [])).join(" "));

// 让渲染进程进同步死循环：整 8 秒（取 8 秒而不是更久，Chromium 判无响应约 30 秒内）
console.log("[hang] 注入 90 秒同步死循环");
win.webContents.executeJavaScript("(() => { const end = Date.now() + 90000; while (Date.now() < end) {} return 'done'; })()", true).catch(() => {});

await new Promise((r) => setTimeout(r, 60_000));
// 卡死相关的行由主进程写进 app.log（scope=renderer），渲染侧的 console 才在 renderer.log
const renderer = await readFile(path.join(logDir, "app.log"), "utf8").catch(() => "");
const perfLog = await readFile(path.join(logDir, "perf.log"), "utf8").catch(() => "");
console.log("[hang] 目录现状", logDir, (await readdir(logDir).catch(() => [])).join(" "));
console.log("[hang] perf.log 尾部", perfLog.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 300));
const hit = /没有响应 ping/.test(renderer) && /渲染进程卡在/.test(renderer) && /#0 /.test(renderer);
console.log("[hang] renderer.log 片段：");
console.log(renderer.split("\n").filter((line) => line.trim()).slice(-14).join("\n"));
console.log(hit ? "[hang] PASS 卡死被抓到并写入了调用栈" : "[hang] FAIL 没有抓到卡死");
app.exit(hit ? 0 : 1);
});
