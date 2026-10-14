// 冒烟测试：用真实 Electron + 真实 Pi 启动应用，抓取控制台报错与关键 DOM。
import { app, BrowserWindow } from "electron";

const errors = [];
let win;

async function probe(label) {
  const result = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((() => {
    const q = (s) => document.querySelectorAll(s).length;
    const k = window.__piDesktop;
    return {
      islands: q('.island'),
      sidebar: q('.sidebar'),
      projects: q('.project'),
      tasks: q('.task-row'),
      strip: q('.strip-btn'),
      turns: q('.turn'),
      stage: q('.stage > *'),
      welcome: q('.welcome'),
      conversation: q('.conversation'),
      blocks: q('.timeline-inner > *'),
      tools: q('.tool-card'),
      user: q('.msg.user'),
      assistant: q('.msg.assistant'),
      thinking: q('.thinking'),
      titlebar: document.querySelector('.titlebar')?.innerText.replace(/\\s+/g, ' ').slice(0, 200),
      composer: document.querySelector('.composer-bar')?.innerText.replace(/\\s+/g, ' ').slice(0, 120),
      font: getComputedStyle(document.body).fontFamily.slice(0, 40),
      fontLoaded: document.fonts.check('13px Inter'),
      plugins: k?.plugins.records.map((r) => r.id + ':' + (r.enabled ? 'on' : 'off')).join(' '),
      ws: k?.workbench.active.value ? { status: k.workbench.active.value.status, blocks: k.workbench.active.value.blocks.length, sessions: k.workbench.active.value.sessions.length, error: k.workbench.active.value.error } : null,
    };
  })())`));
  console.log(`[${label}]`, JSON.stringify(result));
  return result;
}

app.whenReady().then(async () => {
  await import("../../electron/main.js");
  await new Promise((r) => setTimeout(r, 300));
  win = BrowserWindow.getAllWindows()[0];
  win.webContents.on("console-message", (event) => {
    const level = event.level ?? "";
    const message = event.message ?? "";
    if ((level === "error" || level === "warning") && !message.includes("Security Warning")) errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push(`render gone: ${d.reason}`));
  // 延后 import 导致页面可能早于 IPC 注册加载，重新加载一次保证测试与真实启动一致
  await win.webContents.reloadIgnoringCache();

  await new Promise((r) => setTimeout(r, 2500));
  await probe("boot");
  await win.webContents.executeJavaScript("window.__piDesktop.workbench.open('C:\\\\Users\\\\jiuran\\\\Desktop\\\\chat').then(() => true)");
  for (let i = 0; i < 40; i += 1) {
    const done = await win.webContents.executeJavaScript("window.__piDesktop.workbench.active.value?.status === 'ready'");
    if (done) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // 切到一个含工具调用的历史会话，验证工具卡片渲染
  await win.webContents.executeJavaScript(`(async () => {
    const k = window.__piDesktop;
    const ws = k.workbench.active.value;
    const target = ws.sessions.find((s) => s.title.includes('mcp'));
    if (target) await k.workbench.switchSession(target.path);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const ready = await probe("workspace");

  // 停用工具卡片插件，确认卡片退回兜底、启用后恢复
  await win.webContents.executeJavaScript("window.__piDesktop.plugins.setEnabled('pi.builtin.tool-cards', false).then(() => true)");
  await new Promise((r) => setTimeout(r, 400));
  const off = await win.webContents.executeJavaScript("({ cards: document.querySelectorAll('.tool-card').length, fallback: document.querySelectorAll('.block-fallback').length })");
  console.log("[tool-cards off]", JSON.stringify(off));
  await win.webContents.executeJavaScript("window.__piDesktop.plugins.setEnabled('pi.builtin.tool-cards', true).then(() => true)");
  await new Promise((r) => setTimeout(r, 400));
  const on = await win.webContents.executeJavaScript("({ cards: document.querySelectorAll('.tool-card').length, fallback: document.querySelectorAll('.block-fallback').length })");
  console.log("[tool-cards on]", JSON.stringify(on));

  const { writeFileSync } = await import("node:fs");
  const shot = process.env.SHOT ?? "shot.png";
  writeFileSync(shot, (await win.webContents.capturePage()).toPNG());

  // 打开插件面板与变更面板
  await win.webContents.executeJavaScript("window.__piDesktop.workbench.state.activePanel = 'plugins'; true");
  await new Promise((r) => setTimeout(r, 400));
  const plugins = await win.webContents.executeJavaScript("document.querySelectorAll('.plugin-card').length");
  await win.webContents.executeJavaScript("window.__piDesktop.workbench.state.activePanel = 'changes'; true");
  await new Promise((r) => setTimeout(r, 400));
  const panel = await win.webContents.executeJavaScript("document.querySelector('.panel .pane-head')?.innerText");
  console.log("[panes]", JSON.stringify({ pluginCards: plugins, panel }));

  // 浅色主题截图
  await win.webContents.executeJavaScript("window.__piDesktop.workbench.setTheme('light'); true");
  await new Promise((r) => setTimeout(r, 500));
  writeFileSync(shot.replace(/\.png$/, "-light.png"), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("window.__piDesktop.workbench.setTheme('dark'); window.__piDesktop.workbench.state.activePanel = ''; true");

  console.log("[errors]", errors.length ? errors.join("\n") : "none");
  console.log("[result]", ready.ws?.status === "ready" && !errors.length ? "PASS" : "CHECK");
  app.exit(0);
});
