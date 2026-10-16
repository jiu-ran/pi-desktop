import { app, BrowserWindow } from "electron";

const errors: string[] = [];
let win: BrowserWindow;

async function probe(label: string) {
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
  await import("../../electron/main.ts");
  await new Promise((r) => setTimeout(r, 300));
  win = BrowserWindow.getAllWindows()[0];
  win.webContents.on("console-message", (event: any) => {
    const level = event.level ?? "";
    const message = event.message ?? "";
    if ((level === "error" || level === "warning") && !message.includes("Security Warning")) errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, d) => errors.push(`render gone: ${d.reason}`));
  await win.webContents.reloadIgnoringCache();

  await new Promise((r) => setTimeout(r, 2500));
  await probe("boot");
  const workspace = process.env.PI_DESKTOP_SMOKE_WORKSPACE ?? process.cwd();
  const workspaceLiteral = JSON.stringify(workspace);
  await win.webContents.executeJavaScript(`window.__piDesktop.workbench.open(${workspaceLiteral}).then(() => true)`);
  for (let i = 0; i < 40; i += 1) {
    const done = await win.webContents.executeJavaScript("window.__piDesktop.workbench.active.value?.status === 'ready'");
    if (done) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const ready = await probe("workspace");
  const required = ["sidebar", "strip", "conversation"] as const;
  for (const key of required) {
    if (!ready[key]) errors.push(`missing required UI region: ${key}`);
  }
  if (!ready.ws || ready.ws.status !== "ready") errors.push("workspace did not become ready");
  console.log("[errors]", errors.length ? errors.join("\n") : "none");
  const passed = ready.ws?.status === "ready" && !errors.length;
  console.log("[result]", passed ? "PASS" : "FAIL");
  app.exit(passed ? 0 : 1);
});
