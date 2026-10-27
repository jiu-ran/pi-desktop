import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 聊天里的本地图片。
 *
 * 用户贴的是 `![](C:\Users\…\shot.png)`（绝对路径，甚至在工作区之外），
 * 以前 Chromium 当成相对 URL，直接「Image failed to load」。
 * 现在渲染后会把这类 img 读成 data URL；远程地址、data URL 不能被动。
 */
export async function checkLocalImagesInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`本地图片检查超时：${label}`);
  };

  // 工作区之外的一张图：绝对路径能不能读，正是这次要放开的地方
  const outside = await mkdtemp(path.join(tmpdir(), "pi-outside-image-"));
  const absoluteImage = path.join(outside, "outside-shot.png");
  const missingImage = path.join(outside, `missing-${Date.now()}.png`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(absoluteImage, png);

  const inlinePng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  try {
    await evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      const t = thread.transcript;
      t.blocks.splice(0);
      t.pushUser("看下这几张图", 0);
      const absolute = ${JSON.stringify(absoluteImage)};
      const fileUrl = "file:///" + absolute.replace(/\\\\/g, "/");
      const missing = ${JSON.stringify(missingImage)};
      const inline = ${JSON.stringify(inlinePng)};
      const content = [
        "绝对路径：",
        "![外部的图](" + absolute + ")",
        "同样的图写成 file URL：",
        "![file](" + fileUrl + ")",
        "内联 data URL 不该被替换：",
        "![内联](" + inline + ")",
        "读不到的文件：",
        "![不存在](" + missing + ")",
      ].join(String.fromCharCode(10));
      // 走真实事件链路：message_start → text_delta → message_end
      t.applyEvent({ type: "message_start", message: { role: "assistant" } });
      t.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: content } });
      t.applyEvent({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      return true;
    })()`);
    await poll(
      `[...document.querySelectorAll('.md-body img')].filter((img) => (img.getAttribute('src') ?? '').startsWith('data:image/png')).length >= 2`,
      "以绝对路径 / file URL 贴的图片都应被读出来",
    );

    const result = JSON.parse(await evaluate(`(() => {
      const images = [...document.querySelectorAll(".md-body img")];
      return JSON.stringify({
        images: images.map((img) => ({
          src: (img.getAttribute("src") ?? "").slice(0, 26),
          alt: img.getAttribute("alt") ?? "",
        })),
        text: (document.querySelector(".md-body")?.textContent ?? "").slice(0, 400),
      });
    })()`));

    const resolved = result.images.filter((item) => item.src.startsWith("data:image/png"));
    assert.ok(resolved.length >= 3, `绝对路径、file URL、内联 data URL 都应渲染出图片：${JSON.stringify(result)}`);
    assert.deepEqual(
      resolved.map((item) => item.alt).sort(),
      ["内联", "外部的图", "file"].sort(),
      `三张图都要真的渲染出来：${JSON.stringify(resolved)}`,
    );

    // 读不到的路径：markstream 自己报「加载失败」，不是静默空白
    assert.match(result.text, /加载失败|failed to load/i, `找不到的文件要给提示：${result.text}`);

    console.log("[local-images]", JSON.stringify(result));
  } finally {
    await rm(outside, { recursive: true, force: true }).catch(() => {});
  }
}
