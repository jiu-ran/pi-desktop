import assert from "node:assert/strict";

/**
 * 输入框高度回归。
 *
 * 用户现象：什么都没输入，输入框却是好几行的高度（「有时候才出现」）。
 *
 * 原因：高度是内联样式（autosize 写入的），只在 draft 变化和挂载时重算。
 * 下列情况 draft 不变、但高度该变，旧实现不会重算，于是停在旧高度：
 * - 切会话 / 切项目（两边草稿都是空，watch 不触发）；
 * - 窗口或面板宽度变化（空输入框的占位文案换行，:placeholder-shown 的 min-height 变了）。
 */
export async function checkComposerHeightInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const height = () =>
    evaluate(`(() => Math.round(document.querySelector(".composer textarea").getBoundingClientRect().height))()`);

  // 空输入时的基准高度（一行 + 上下内边距）
  const baseline = await height();
  assert.ok(baseline > 20 && baseline < 70, `空输入框应是一行高度，实际 ${baseline}px`);

  // 1. 模拟「上一次停留在长文本高度」：直接写内联高度，值仍然是空的
  await evaluate(`(() => {
    const box = document.querySelector(".composer textarea");
    box.style.height = "112px";
    return true;
  })()`);
  await wait(120);
  const stale = await height();
  assert.ok(stale >= 100, `准备阶段应把高度顶上去，实际 ${stale}px`);

  // 2. 窗口尺寸变化 → 高度必须重新算回一行（旧版没有 resize 重算）
  await evaluate(`(() => { window.dispatchEvent(new Event("resize")); return true; })()`);
  await wait(200);
  const afterResize = await height();
  assert.ok(
    afterResize <= baseline + 8,
    `窗口变化后空输入框应回到一行高度：基准 ${baseline}px，实际 ${afterResize}px`,
  );

  // 3. 输入多行 → 变高；清空 → 立刻回到一行（交还给 CSS，不保留内联高度）
  await evaluate(`(() => {
    const box = document.querySelector(".composer textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "第一行\\n第二行\\n第三行\\n第四行\\n第五行");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(250);
  const grown = await height();
  assert.ok(grown > baseline + 20, `输入多行后应变高：基准 ${baseline}px，实际 ${grown}px`);

  await evaluate(`(() => {
    const box = document.querySelector(".composer textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(250);
  const cleared = await height();
  assert.ok(cleared <= baseline + 8, `清空后应回到一行高度：基准 ${baseline}px，实际 ${cleared}px`);
  const inline = await evaluate(`document.querySelector(".composer textarea").style.height || ""`);
  assert.equal(inline, "", `空输入时不该保留内联高度（实际 "${inline}"）`);

  console.log("[composer-height]", JSON.stringify({ baseline, stale, afterResize, grown, cleared }));
}
