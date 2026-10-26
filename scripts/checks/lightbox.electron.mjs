import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 图片放大回归。
 *
 * 之前点图片「没反应」：放大层是 Teleport 到 body 的，但它用 `inset: var(--titlebar-h) …`
 * 定位，而这个变量只写在 `.shell` 上 —— body 下的元素读到空值后整条 inset 失效，
 * 放大层缩成视口外的 64×64 小方块。所以这里既测点击链路，也测「它真的铺满窗口」。
 */
export async function checkLightboxInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`图片放大检查超时：${label}`);
  };

  const dir = await mkdtemp(path.join(tmpdir(), "pi-lightbox-"));
  const image = path.join(dir, "shot.png");
  // 1×1 透明 PNG：只关心点击与浮层布局，不需要真实内容
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(image, png);

  // 变量本身：Teleport 到 body 的浮层只能读到 :root 上的值
  const vars = JSON.parse(
    await evaluate(`JSON.stringify({
      root: getComputedStyle(document.documentElement).getPropertyValue("--titlebar-h").trim(),
      barHeight: Math.round(document.querySelector(".titlebar")?.getBoundingClientRect().height ?? 0),
    })`),
  );
  assert.ok(vars.root, "--titlebar-h 必须定义在 :root 上（否则 body 下的浮层读不到）");
  assert.equal(parseInt(vars.root, 10), vars.barHeight, `--titlebar-h 要和标题栏实际高度一致：${vars.root} vs ${vars.barHeight}px`);

  await evaluate(`window.__piDesktop.bus.emit("file:open", ${JSON.stringify(image)}); true`);
  await poll("Boolean(document.querySelector('.file-image-preview img'))", "图片预览出现");

  // 点图片 → 放大层出现
  await evaluate("document.querySelector('.file-image-preview').click(); true");
  await poll("Boolean(document.querySelector('.image-lightbox'))", "点图片应打开放大层");

  const box = JSON.parse(
    await evaluate(`(() => {
      const node = document.querySelector('.image-lightbox');
      const rect = node.getBoundingClientRect();
      const img = node.querySelector('img');
      const imageRect = img?.getBoundingClientRect();
      const style = getComputedStyle(node);
      return JSON.stringify({
        viewport: [window.innerWidth, window.innerHeight],
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        imageVisible: Boolean(imageRect && imageRect.width > 0 && imageRect.height > 0),
        zIndex: Number(style.zIndex) || 0,
        position: style.position,
        parent: node.parentElement?.tagName ?? "",
        titlebar: Math.round(document.querySelector(".titlebar")?.getBoundingClientRect().height ?? 0),
        bodyLocked: getComputedStyle(document.body).overflow,
        closeButton: Boolean(node.querySelector('.image-lightbox-close')),
        counter: node.querySelector('.image-lightbox-count')?.textContent?.trim() ?? '',
      });
    })()`),
  );

  assert.equal(box.position, "fixed", "放大层要固定在视口上");
  assert.equal(box.parent, "BODY", "放大层应该被 Teleport 到 body（不受工作区层叠影响）");
  assert.ok(box.rect[1] <= box.titlebar + 1, `放大层要从标题栏下方开始，实际 y=${box.rect[1]}`);
  assert.ok(box.rect[2] >= box.viewport[0] - 1, `放大层要铺满宽度：${box.rect[2]}/${box.viewport[0]}`);
  assert.ok(box.rect[3] >= box.viewport[1] - box.titlebar - 1, `放大层要铺满剩余高度：${box.rect[3]}/${box.viewport[1] - box.titlebar}`);
  assert.ok(box.zIndex >= 90, `放大层要在内容之上（z-index=${box.zIndex}）`);
  assert.ok(box.imageVisible, "放大层的图片必须真的显示出来");
  assert.ok(box.closeButton, "放大层要有关闭按钮");
  assert.match(box.counter, /^1 \/ 1$/, `单张图片的计数应为 1 / 1，实际 ${box.counter}`);

  // 关闭按钮与 Esc 都要能关掉
  await evaluate("document.querySelector('.image-lightbox-close').click(); true");
  await wait(200);
  assert.equal(await evaluate("Boolean(document.querySelector('.image-lightbox'))"), false, "点关闭按钮应收起放大层");

  await evaluate("document.querySelector('.file-image-preview').click(); true");
  await poll("Boolean(document.querySelector('.image-lightbox'))", "再次打开放大层");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await wait(220);
  assert.equal(await evaluate("Boolean(document.querySelector('.image-lightbox'))"), false, "Esc 应收起放大层");
  // 注意：这个应用本身就让 body 不可滚动（桌面壳内部滚动），
  // 所以这里不能拿 body.overflow 当「锁解开」的证据，只能看浮层是否真的没了。
  assert.equal(
    await evaluate("document.querySelectorAll('.image-lightbox').length"),
    0,
    "放大层关掉后 DOM 里不该残留浮层",
  );

  console.log("[lightbox]", JSON.stringify({ vars, box }));
}
