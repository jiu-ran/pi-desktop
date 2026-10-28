import assert from "node:assert/strict";

/**
 * 快速打开（Ctrl+P）的样式回归。
 *
 * 背景：设置面板重写时整段切掉了 components.css 末尾的通用 overlay 区块，
 * 把 `.palette input`、`.palette-item` 和全部 `.quick-open-*` 一起带走。
 * 组件本身没坏，只是退回浏览器原生外观 —— 深色主题下输入框是白底细边、
 * 宽度只有 20 字符（占位文字被截断），提示行也没有内边距和分隔线。
 *
 * 这里量的是「外观是否还成立」：输入行铺满、没有原生边框、页脚有上边线。
 * 边框宽度按数值比较：窗口缩放不是 100% 时计算值是 0.8px 这种小数。
 */
export async function checkPaletteInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`快速打开检查超时：${label}`);
  };
  const near = (value, expected, tolerance, label) =>
    assert.ok(Math.abs(value - expected) <= tolerance, `${label}：期望 ${expected}，实际 ${value}`);

  // 最近打开记录会改变列表内容（有记录时没有空状态），先清空让断言稳定
  await evaluate(
    `(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("pi-desktop:recent-files:")) localStorage.removeItem(key); return true; })()`,
  );
  // 焦点若停在表单控件里，快捷键会被全局按键处理跳过（输入框里按 Ctrl+P 不该抢键）
  await evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur(), true");

  win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "P", modifiers: ["control"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "P", modifiers: ["control"] });
  await poll("Boolean(document.querySelector('.palette.quick-open'))", "Ctrl+P 应打开快速打开面板");

  const info = JSON.parse(
    await evaluate(`(() => {
      const palette = document.querySelector('.palette.quick-open');
      const input = palette.querySelector('input');
      const foot = palette.querySelector('.quick-open-foot');
      const state = palette.querySelector('.quick-open-state');
      const style = getComputedStyle(input);
      const num = (value) => Math.round((parseFloat(value) || 0) * 100) / 100;
      const rect = (node) => node.getBoundingClientRect();
      return JSON.stringify({
        paletteWidth: Math.round(rect(palette).width),
        inputWidth: Math.round(rect(input).width),
        inputHeight: Math.round(rect(input).height),
        borderTop: num(style.borderTopWidth),
        borderLeft: num(style.borderLeftWidth),
        borderBottom: num(style.borderBottomWidth),
        borderBottomStyle: style.borderBottomStyle,
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        focused: document.activeElement === input,
        placeholder: input.placeholder,
        itemCount: document.querySelectorAll('.quick-open-item').length,
        footPresent: Boolean(foot),
        footBorder: foot ? num(getComputedStyle(foot).borderTopWidth) : -1,
        footGap: foot ? Math.round(rect(foot).top - rect(palette).top) : -1,
        statePresent: Boolean(state),
        statePaddingTop: state ? num(getComputedStyle(state).paddingTop) : -1,
        statePaddingLeft: state ? num(getComputedStyle(state).paddingLeft) : -1,
      });
    })()`),
  );

  assert.ok(info.focused, "打开后焦点应在输入框里（否则直接打字没反应）");
  assert.ok(info.placeholder.includes("快速打开文件"), `占位文字不对：${info.placeholder}`);
  near(info.inputWidth, info.paletteWidth - 2, 2, "输入行要铺满面板宽度");
  assert.ok(info.inputHeight >= 40, `输入行高度应在 40px 以上，实际 ${info.inputHeight}px`);
  assert.ok(info.borderTop < 0.5, `输入行不能有原生上边框（深色主题下会显出一条白框），实际 ${info.borderTop}px`);
  assert.ok(info.borderLeft < 0.5, `输入行不能有原生左右边框，实际 ${info.borderLeft}px`);
  assert.ok(info.borderBottom >= 0.5, "输入行下方要有 1px 分隔线");
  assert.equal(info.borderBottomStyle, "solid", "分隔线要是实线");
  assert.equal(info.background, "rgba(0, 0, 0, 0)", "输入行背景要透明，跟随面板底色");
  assert.equal(info.outlineStyle, "none", "聚焦时不能出现浏览器描边");
  assert.equal(info.itemCount, 0, "清空最近打开后列表应为空");
  assert.ok(info.statePresent, "没有最近文件时要显示空状态提示");
  assert.ok(info.statePaddingTop >= 8, `空状态要有上内边距，实际 ${info.statePaddingTop}px`);
  assert.ok(info.statePaddingLeft >= 8, `空状态要有左内边距，实际 ${info.statePaddingLeft}px`);
  assert.ok(info.footPresent, "页脚应存在（快捷键提示）");
  assert.ok(info.footBorder >= 0.5, "页脚要有上边线，否则和列表粘在一起");
  assert.ok(info.footGap > info.inputHeight, `页脚应在输入行下方：页脚 y=${info.footGap} / 输入高 ${info.inputHeight}`);

  // 收尾：关掉面板，别影响后续检查
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await poll("!document.querySelector('.palette.quick-open')", "Esc 应关闭面板");
}
