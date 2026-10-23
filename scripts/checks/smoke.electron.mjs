import { app, BrowserWindow } from "electron";
import { checkTerminalInElectron } from "./terminal.smoke.mjs";
import { checkNetworkInElectron } from "./network.electron.mjs";
import { checkEditorInElectron } from "./editor.electron.mjs";
import { checkGitUiInElectron } from "./git-ui.electron.mjs";

// Smoke 直接跑编译后的主进程，避免 Electron 直接执行 .ts 时的 loader 差异。
// profile 必须在导入 main.js 前指定，main.js 会在模块顶层设置 userData。
process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Smoke";
// 自动化窗口常被宿主工具遮挡；禁用 native occlusion，否则新版 Chromium
// 会暂停 xterm 的 IntersectionObserver 绘制，造成假阴性。
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.disableHardwareAcceleration();

const errors = [];
let win;

setTimeout(() => {
  console.error("[result] FAIL hard timeout");
  app.exit(1);
}, 60000);

async function probe(label) {
  const result = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((() => {
    const q = (s) => document.querySelectorAll(s).length;
    const k = window.__piDesktop;
    return {
      islands: q('.island'),
      sidebar: q('.sidebar'),
      projects: q('.project'),
      tasks: q('.task-row'),
      strip: q('.activity-btn'),
      turns: q('.timeline-inner > *'),
      stage: q('.editor > *'),
      welcome: q('.empty-thread'),
      conversation: q('.area-chat'),
      blocks: q('.timeline-inner > *'),
      tools: q('.tool-card'),
      user: q('.msg.user'),
      assistant: q('.msg.assistant'),
      thinking: q('.thinking'),
      titlebar: document.querySelector('.titlebar')?.innerText.replace(/\s+/g, ' ').slice(0, 200),
      composer: document.querySelector('.composer-bar')?.innerText.replace(/\s+/g, ' ').slice(0, 120),
      font: getComputedStyle(document.body).fontFamily.slice(0, 40),
      fontLoaded: document.fonts.check('13px Inter'),
      plugins: k?.plugins.records.map((r) => r.id + ':' + (r.enabled ? 'on' : 'off')).join(' '),
      ws: k?.workbench.active.value ? { status: k.workbench.active.value.status, blocks: k.workbench.active.value.blocks.length, sessions: k.workbench.active.value.sessions.length, error: k.workbench.active.value.error } : null,
    };
  })())`));
  console.log(`[${label}]`, JSON.stringify(result));
  return result;
}

await import("../../dist-electron/main.js");
console.log("[smoke] main imported");

app.whenReady().then(async () => {
  for (let i = 0; i < 50 && BrowserWindow.getAllWindows().length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  win = BrowserWindow.getAllWindows()[0];
  console.log("[smoke] window", Boolean(win));
  if (!win) {
    console.error("[result] FAIL no window");
    app.exit(1);
    return;
  }
  // Electron 新版会节流被其他窗口遮挡的渲染；冒烟必须实际绘制 DOM。
  win.show();
  win.focus();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on("console-message", (event) => {
    const level = event.level ?? "";
    const message = event.message ?? "";
    if ((level === "error" || level === "warning") && !message.includes("Security Warning")) errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push(`render gone: ${d.reason}`));
  await new Promise((r) => setTimeout(r, 2500));
  await checkNetworkInElectron();
  console.log("[smoke] probing");
  await probe("boot");
  console.log("[smoke] probed");
  const workspace = process.env.PI_DESKTOP_SMOKE_WORKSPACE ?? process.cwd();
  const workspaceLiteral = JSON.stringify(workspace);
  await win.webContents.executeJavaScript(`window.__piDesktop.workbench.open(${workspaceLiteral}).then(() => true)`);
  for (let i = 0; i < 40; i += 1) {
    const done = await win.webContents.executeJavaScript("window.__piDesktop.workbench.active.value?.status === 'ready'");
    if (done) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const ready = await probe("workspace");
  const required = ["sidebar", "strip", "conversation"];
  for (const key of required) {
    if (!ready[key]) errors.push(`missing required UI region: ${key}`);
  }
  if (!ready.ws || ready.ws.status !== "ready") errors.push("workspace did not become ready");
  if (ready.ws?.status === "ready") {
    try {
      await checkTerminalInElectron(win);
      await checkEditorInElectron(win);
      await checkGitUiInElectron(win);
    } catch (error) {
      errors.push(`terminal: ${error.message || String(error)}`);
    }
  }
  console.log("[errors]",  errors.length ? errors.join("\n") : "none");
  const passed = ready.ws?.status === "ready" && !errors.length;
  console.log("[result]", passed ? "PASS" : "FAIL");
  app.exit(passed ? 0 : 1);
}).catch((error) => {
  console.error("[result] FAIL", error);
  app.exit(1);
});
