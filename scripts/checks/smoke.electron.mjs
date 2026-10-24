import { app, BrowserWindow } from "electron";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkTerminalInElectron } from "./terminal.smoke.mjs";
import { checkNetworkInElectron } from "./network.electron.mjs";
import { checkEditorInElectron } from "./editor.electron.mjs";
import { checkGitUiInElectron } from "./git-ui.electron.mjs";
import { checkTooltipInElectron } from "./tooltip.electron.mjs";
import { checkComposerDraftInElectron } from "./composer-draft.electron.mjs";
import { checkSubagentInElectron } from "./subagent.electron.mjs";
import { checkSessionQuoteInElectron } from "./session-quote.electron.mjs";
import { checkQueueInElectron } from "./queue.electron.mjs";
import { checkCrossProjectQuoteInElectron } from "./cross-quote.electron.mjs";

// Smoke 直接跑编译后的主进程，避免 Electron 直接执行 .ts 时的 loader 差异。
// profile 必须在导入 main.js 前指定，main.js 会在模块顶层设置 userData。
process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Smoke";
// 会话目录也隔离：否则每跑一次检查都会在开发者的 ~/.pi/agent/sessions 里
// 留下一堆临时项目的会话（历史上堆了 290 多个），既脏又会在会话列表里看得见。
if (!process.env.PI_CODING_AGENT_DIR) {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-smoke-agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
}
// 自动化窗口常被宿主工具遮挡；禁用 native occlusion，否则新版 Chromium
// 会暂停 xterm 的 IntersectionObserver 绘制，造成假阴性。
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.disableHardwareAcceleration();

const errors = [];
/** 单个检查的上限：正常情况下最慢的终端检查约 12s。 */
const STEP_TIMEOUT_MS = 90_000;
let win;

setTimeout(() => {
  console.error("[result] FAIL hard timeout");
  app.exit(1);
}, 150000);

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

/**
 * 渲染进程卡住时（executeJavaScript 不返回），用调试协议强行暂停并抓调用栈。
 * 这类卡死看不出日志，只有栈能说明它在转什么。
 */
async function dumpRendererStack(label) {
  try {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const paused = new Promise((resolve) => {
      const onMessage = (_event, method, params) => {
        if (method !== "Debugger.paused") return;
        dbg.removeListener("message", onMessage);
        resolve(params);
      };
      dbg.on("message", onMessage);
    });
    await dbg.sendCommand("Debugger.enable");
    await dbg.sendCommand("Debugger.pause");
    const params = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (!params) {
      console.error(`[smoke] ${label} 渲染进程无响应，且无法暂停（可能整个进程卡死）`);
      return;
    }
    const frames = (params.callFrames ?? []).slice(0, 20).map((frame, index) => {
      const url = (frame.url || "").split("/").pop();
      return `  #${index} ${frame.functionName || "(anonymous)"} ${url}:${frame.location.lineNumber + 1}`;
    });
    console.error(`[smoke] ${label} 卡在：\n${frames.join("\n")}`);
    await dbg.sendCommand("Debugger.resume").catch(() => {});
  } catch (error) {
    console.error(`[smoke] ${label} 抓栈失败：${error.message || error}`);
  }
}

/**
 * 每个检查单独计时并设上限：卡住时能看出是哪一步，也不会一直拖到全局硬超时。
 */
async function runCheck(name, run) {
  const started = Date.now();
  console.log(`[smoke] → ${name}`);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      await dumpRendererStack(name);
      reject(new Error(`${name} 检查超时（${STEP_TIMEOUT_MS / 1000}s）`));
    }, STEP_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    console.log(`[smoke] ← ${name} ${Date.now() - started}ms`);
  }
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
  // 默认用一次性临时工作区：直接开当前仓库会把开发者自己的长会话（可能几十 MB）读进来，
  // 冒烟变成在测「我的会话有多大」，既慢又和代码质量无关。
  // composer-draft 等检查需要 README.md，这里补一个。
  let workspace = process.env.PI_DESKTOP_SMOKE_WORKSPACE ?? "";
  if (!workspace) {
    workspace = await mkdtemp(path.join(tmpdir(), "pi-smoke-ws-"));
    await writeFile(path.join(workspace, "README.md"), "# smoke workspace\n");
    await writeFile(path.join(workspace, "notes.txt"), "smoke\n");
  }
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
      await runCheck("terminal", () => checkTerminalInElectron(win));
      await runCheck("editor", () => checkEditorInElectron(win));
      await runCheck("git-ui", () => checkGitUiInElectron(win));
      await runCheck("tooltip", () => checkTooltipInElectron(win));
      await runCheck("composer-draft", () => checkComposerDraftInElectron(win));
      await runCheck("subagent", () => checkSubagentInElectron(win));
      await runCheck("session-quote", () => checkSessionQuoteInElectron(win));
      await runCheck("queue", () => checkQueueInElectron(win));
      await runCheck("cross-quote", () => checkCrossProjectQuoteInElectron(win));
    } catch (error) {
      errors.push(`ui-smoke: ${error.message || String(error)}`);
    }
  }
  // 日志持久化链路：渲染进程上报 → 主进程 → userData/logs/*.log（总量上限 100MB）。
  // 界面「卡死」时这份日志是唯一的证据来源，坏掉就等于没法诊断。
  const logsDir = path.join(app.getPath("userData"), "logs");
  const readLog = (name) => readFile(path.join(logsDir, name), "utf8").catch(() => "");
  try {
    const beforePerf = await readLog("perf.log");
    await win.webContents.executeJavaScript("window.piDesktop.reportLongTask(1234, 'smoke-check'); true");
    await win.webContents.executeJavaScript("window.piDesktop.logEvent('warn', 'smoke-check', '渲染侧日志落盘测试'); true");
    let perfOk = false;
    let rendererOk = false;
    for (let i = 0; i < 30 && !(perfOk && rendererOk); i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      if (!perfOk) {
        const now = await readLog("perf.log");
        perfOk = now !== beforePerf && now.includes("渲染进程长任务 1234ms");
      }
      if (!rendererOk) rendererOk = (await readLog("renderer.log")).includes("渲染侧日志落盘测试");
    }
    if (!perfOk) errors.push("卡顿日志未写入 logs/perf.log");
    if (!rendererOk) errors.push("渲染进程日志未写入 logs/renderer.log");
    const appLog = await readLog("app.log");
    if (!appLog.includes("启动 v")) errors.push("启动信息未写入 logs/app.log");
    // 总量必须受控：上限 100MB（冒烟时远低于，但顺带验证统计接口可用）
    const info = JSON.parse(
      await win.webContents.executeJavaScript("(async () => JSON.stringify(await window.piDesktop.logsInfo()))()"),
    );
    if (!info.dir || info.dir !== logsDir) errors.push(`日志目录不对：${info.dir}`);
    if (info.totalBytes > 100 * 1024 * 1024) errors.push(`日志总量超过 100MB：${info.totalBytes}`);
    if (!info.files.some((file) => file.name === "app.log")) errors.push("日志清单里应有 app.log");
    if (perfOk && rendererOk) console.log("[smoke] logs OK 落盘 / 统计 / 上限");
  } catch (error) {
    errors.push(`日志检查失败：${error?.message ?? error}`);
  }

  // 一次性临时工作区用完就从「最近项目」里去掉，别让冒烟 profile 越积越多空项目。
  if (!process.env.PI_DESKTOP_SMOKE_WORKSPACE) {
    await win.webContents
      .executeJavaScript(`window.__piDesktop.workbench.forget(${JSON.stringify(workspace)}).catch(() => true)`)
      .catch(() => {});
  }
  console.log("[errors]",  errors.length ? errors.join("\n") : "none");
  const passed = ready.ws?.status === "ready" && !errors.length;
  console.log("[result]", passed ? "PASS" : "FAIL");
  app.exit(passed ? 0 : 1);
}).catch((error) => {
  console.error("[result] FAIL", error);
  app.exit(1);
});
