/** 手工探针：聊天里点图片放大后的样子（截图留档用） */
import { app, BrowserWindow } from "electron";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Zoom Shot";
if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = path.join(tmpdir(), "pi-zoomshot-agent");
app.commandLine.appendSwitch("force-device-scale-factor", "2");
app.disableHardwareAcceleration();
setTimeout(() => { console.error("[zshot] FAIL 超时"); app.exit(1); }, 120_000);

await import("../../dist-electron/main.js");

app.whenReady().then(async () => {
  try {
    let win = null;
    for (let i = 0; i < 100 && !win; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      win = BrowserWindow.getAllWindows()[0] ?? null;
    }
    const ev = (x) => win.webContents.executeJavaScript(x, true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const ws = path.join(tmpdir(), "pi-zoomshot-ws");
    await mkdir(ws, { recursive: true });
    await writeFile(path.join(ws, "readme.txt"), "x\n");
    await ev(`window.__piDesktop.workbench.open(${JSON.stringify(ws)}).then(() => true)`);
    for (let i = 0; i < 100; i += 1) {
      if ((await ev(`window.__piDesktop.workbench.active.value?.status`)) === "ready") break;
      await wait(150);
    }
    await wait(500);

    // 一张真实图片，放在工作区之外（临时目录）
    const dir = await mkdtemp(path.join(tmpdir(), "pi-zoomshot-img-"));
    const shot = path.join(dir, "design-review.png");
    await copyFile(path.resolve("build/icon.png"), shot);

    await ev(`(() => {
      const t = window.__piDesktop.workbench.active.value.activeThread.transcript;
      t.blocks.splice(0);
      t.pushUser("看下这张设计稿", 0);
      const md = ["截图在这里：", "![设计稿](" + ${JSON.stringify(shot)} + ")", "点图片可以放大看细节。"].join(String.fromCharCode(10));
      t.applyEvent({ type: "message_start", message: { role: "assistant" } });
      t.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: md } });
      t.applyEvent({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      return true;
    })()`);
    await wait(1500);
    await ev(`document.querySelector(".md-body .md img").click(), true`);
    await wait(800);

    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const png = await dbg.sendCommand("Page.captureScreenshot", { format: "png" });
    const target = path.join(tmpdir(), "zoomshot.png");
    await writeFile(target, Buffer.from(png.data, "base64"));
    console.log("[zshot] saved", target);
    if (dbg.isAttached()) dbg.detach();
    app.exit(0);
  } catch (error) {
    console.error("[zshot] FAIL", error?.stack ?? error);
    app.exit(1);
  }
});
