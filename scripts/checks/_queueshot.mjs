/**
 * 手工探针：待发送区的排版截图（方案 A：附件一行 + 单行正文）。
 *
 * 手工跑：npx electron scripts/checks/_queueshot.mjs
 * 产物：<tmp>/qshot-dark.png / qshot-light.png / qshot-hover.png / qshot-narrow.png
 */
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

    // 真实文件：大小是从磁盘上读的
    const attachDir = await mkdtemp(path.join(tmpdir(), "pi-qshot-attach-"));
    const note = path.join(attachDir, "note.txt");
    const spec = path.join(attachDir, "api-spec-v2-final.md");
    const cases = path.join(attachDir, "cases.csv");
    const shots = path.join(attachDir, "screens");
    // 超长名字：验证「文件名优先」，窄窗口里也不能被徽标 / 大小挤没
    const longShot = path.join(attachDir, "screenshot-2026-10-27-at-14.22.08-full-page.png");
    await writeFile(note, "x".repeat(2 * 1024));
    await writeFile(spec, "x".repeat(18 * 1024));
    await writeFile(cases, "x".repeat(6 * 1024));
    await writeFile(longShot, "x".repeat(1024 * 1024));
    await mkdir(shots, { recursive: true });

    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      thread.transcript.blocks.splice(0);
      thread.transcript.pushUser("先跑一遍检查，再一起看这几处", 0);
      const block = (tag, target) => '<' + tag + ' name="' + target + '">' + String.fromCharCode(10) + '内容' + String.fromCharCode(10) + '</' + tag + '>';
      const wrap = (attachments, text) => [...attachments, text].filter(Boolean).join(String.fromCharCode(10));
      const cards = [
        wrap([block("file", ${JSON.stringify(note)})], "顺便看下这个文件"),
        wrap([], "先别动界面，把日志补全就行；顺便确认一下引导和排队两条链路的顺序都没问题"),
        wrap([block("file", ${JSON.stringify(spec)}), block("file", ${JSON.stringify(cases)})], "再检查一下接口返回的字段是否和文档一致，如果不一致请列出差异，并给出修改建议。"),
        wrap([block("directory", ${JSON.stringify(shots)})], "最后帮我生成测试用例"),
        wrap([block("file", ${JSON.stringify(longShot)})], "这张长图的文件名也要看得到"),
      ];
      thread.queue = { steering: cards.slice(0, 2), followUp: cards.slice(2) };
      return true;
    })()`);
    await wait(1200);
    log("queue injected");

    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const shot = async (name, selector, pad = 12) => {
      const box = await evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return "null";
        const r = node.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left) - ${pad}, y: Math.round(r.top) - ${pad}, width: Math.round(r.width) + ${pad * 2}, height: Math.round(r.height) + ${pad * 2} });
      })()`);
      if (box === "null") return log("缺少节点", selector);
      const png = await dbg.sendCommand("Page.captureScreenshot", {
        format: "png",
        clip: { ...JSON.parse(box), scale: 2 },
      });
      const target = path.join(tmpdir(), name);
      await writeFile(target, Buffer.from(png.data, "base64"));
      log("shot", target);
    };

    await shot("qshot-dark.png", ".queue-strip");
    await evaluate(`document.documentElement.dataset.theme = "light"; true`);
    await wait(500);
    await shot("qshot-light.png", ".queue-strip");
    await evaluate(`document.documentElement.dataset.theme = "dark"; true`);
    await wait(300);

    // 悬停：图标操作要现形
    const hover = JSON.parse(
      await evaluate(`(() => {
        const card = document.querySelectorAll(".queue-card")[1];
        const r = card.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width - 60), y: Math.round(r.top + r.height / 2) });
      })()`),
    );
    await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: hover.x, y: hover.y, button: "none", buttons: 0, clickCount: 0 });
    await wait(300);
    await shot("qshot-hover.png", ".queue-strip");

    win.setSize(900, 820);
    await wait(500);
    await shot("qshot-narrow.png", ".queue-strip");
    win.setSize(1280, 860);
    await wait(400);

    log(
      "metrics",
      await evaluate(`(() => {
        const strip = document.querySelector(".queue-strip");
        return JSON.stringify({
          overflow: strip.scrollWidth - strip.clientWidth,
          cards: [...strip.querySelectorAll(".queue-card")].map((card) => ({
            w: Math.round(card.getBoundingClientRect().width),
            h: Math.round(card.getBoundingClientRect().height),
            files: [...card.querySelectorAll(".queue-file-name")].map((n) => n.textContent.trim()),
            text: card.querySelector(".queue-card-text")?.textContent.trim().slice(0, 30) ?? "",
            lines: (() => {
              const text = card.querySelector(".queue-card-text");
              if (!text) return 0;
              const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 1;
              return Math.round(text.getBoundingClientRect().height / lineHeight);
            })(),
          })),
        });
      })()`),
    );

    if (dbg.isAttached()) dbg.detach();
    app.exit(0);
  } catch (error) {
    console.error("[qshot] FAIL", error?.stack ?? error);
    app.exit(1);
  }
});
