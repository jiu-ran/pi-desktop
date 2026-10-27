/**
 * 手工探针：把待发送区摆成常见状态（混合模式 / 长文本 / 附件 / 窄窗口 / 编辑态）后截图。
 *
 * 手工跑：npx electron scripts/checks/_queueshot.mjs
 */
import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PI_DESKTOP_PROFILE ||= "Pi Desktop Queue Shot";
if (!process.env.PI_CODING_AGENT_DIR) process.env.PI_CODING_AGENT_DIR = path.join(tmpdir(), "pi-qshot-agent");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.disableHardwareAcceleration();

const log = (...args) => console.log("[qshot]", ...args);
setTimeout(() => {
  console.error("[qshot] FAIL 超时");
  app.exit(1);
}, 140_000);

await import("../../dist-electron/main.js");

app.whenReady().then(async () => {
  try {
    let win = null;
    for (let i = 0; i < 100 && !win; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      win = BrowserWindow.getAllWindows()[0] ?? null;
    }
    if (!win) throw new Error("没有窗口");
    const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const dir = path.join(tmpdir(), "pi-qshot-ws");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "readme.txt"), "qshot\n");
    await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(dir)}).then(() => true)`);
    for (let i = 0; i < 100; i += 1) {
      if ((await evaluate(`window.__piDesktop.workbench.active.value?.status`)) === "ready") break;
      await wait(150);
    }
    await wait(600);

    const file = (name) => `<file name="C:\\\\proj\\\\${name}">\\n内容\\n</file>`;
    const prompt = (name) => `${file(name)}\\n顺便看下这个文件`;

    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.blocks.splice(0);
      thread.transcript.pushUser("先跑一遍检查，再一起看这几处", 0);
      thread.queue = {
        steering: [
          ${JSON.stringify(`${file("note.txt")}\n顺便看下这个文件`)},
          "先别动界面，把日志补全就行",
        ],
        followUp: [
          ${JSON.stringify(`${file("a.png")}\n${file("b.png")}\n把这两张图对比一下，主要看按钮的圆角和阴影` )},
          "最后再把 CHANGELOG 补上",
        ],
      };
      return true;
    })()`);
    await wait(700);
    log("queue injected");

    const shot = async (name, selector, pad = 12) => {
      const box = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return "null";
        const r = node.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left) - ${pad}, y: Math.round(r.top) - ${pad}, width: Math.round(r.width) + ${pad * 2}, height: Math.round(r.height) + ${pad * 2} });
      })()`);
      if (box === "null") return log("缺少节点", selector);
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) await dbg.attach("1.3");
      const png = await dbg.sendCommand("Page.captureScreenshot", {
        format: "png",
        clip: { ...JSON.parse(box), scale: 2 },
      });
      const target = path.join(tmpdir(), name);
      await writeFile(target, Buffer.from(png.data, "base64"));
      log("shot", target);
      if (dbg.isAttached()) dbg.detach();
    };

    await shot("qshot-dark.png", ".queue-strip");
    await evaluate(`window.__piDesktop.workbench.setTheme("light"); true`);
    await wait(400);
    await shot("qshot-light.png", ".queue-strip");
    await evaluate(`window.__piDesktop.workbench.setTheme("dark"); true`);
    await wait(200);

    // 窄窗口：卡片里的控制条会不会挤爆 / 溢出
    win.setSize(900, 820);
    await wait(500);
    await shot("qshot-narrow.png", ".queue-strip");
    win.setSize(1280, 860);
    await wait(400);

    // 编辑态
    await evaluate(`(() => {
      document.querySelector(".queue-card-text").click();
      return true;
    })()`);
    await wait(500);
    await shot("qshot-edit.png", ".queue-strip");
    await evaluate(`(() => { const b = document.querySelector(".queue-editor-actions button"); b?.click(); return true; })()`);
    await wait(300);

    log("metrics", await evaluate(`(() => {
      const strip = document.querySelector(".queue-strip");
      const r = strip.getBoundingClientRect();
      const cards = [...strip.querySelectorAll(".queue-card")];
      return JSON.stringify({
        stripW: Math.round(r.width),
        overflow: strip.scrollWidth - strip.clientWidth,
        cards: cards.map((c) => ({
          h: Math.round(c.getBoundingClientRect().height),
          w: Math.round(c.getBoundingClientRect().width),
          badge: c.querySelector(".queue-card-badge")?.textContent.trim(),
          note: c.previousElementSibling?.classList.contains("queue-group-note") ? c.previousElementSibling.textContent.trim() : null,
          text: c.querySelector(".queue-card-text")?.textContent.trim().slice(0, 40) ?? "",
          chips: [...c.querySelectorAll(".queue-attach-chip .queue-attach-name")].map((n) => n.textContent.trim()),
          textLines: (() => {
            const t = c.querySelector(".queue-card-text");
            if (!t) return 0;
            const lh = parseFloat(getComputedStyle(t).lineHeight);
            return Math.round(t.getBoundingClientRect().height / lh);
          })(),
          actionsOpacity: getComputedStyle(c.querySelector(".queue-card-actions")).opacity,
        })),
      });
    })()`));

    app.exit(0);
  } catch (error) {
    console.error("[qshot] FAIL", error?.stack ?? error);
    app.exit(1);
  }
});
