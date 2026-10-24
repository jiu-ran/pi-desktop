import assert from "node:assert/strict";

/**
 * 主题化 title 提示回归。
 *
 * 背景：title 常来自响应式绑定（例如活动卡片 :title="group.detail"）。流式更新时 Vue
 * 会把属性重新写回；若提示层只在显示瞬间摘一次，浏览器会同时弹出原生白底提示，
 * 表现为「白色 + 两个」。
 *
 * 断言：只有主题化的单个浮层、展示期间持续接管 title、属性写回后同步文案、移出后还原。
 * 用自建 fixture 而不是消息区元素，避免流式重渲染把被测节点替换掉导致假阴性。
 */
export async function checkTooltipInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);

  const result = await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const isWhite = (rgb) => /rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255/.test(rgb);

    // 清掉可能残留的浮层
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(200);

    const el = document.createElement('button');
    el.type = 'button';
    el.id = 'pi-tooltip-fixture';
    el.textContent = 'fixture';
    el.style.cssText = 'position:fixed;left:140px;top:140px;width:120px;height:24px;z-index:20000';
    el.setAttribute('title', '示例提示：这是一段用于验证主题化浮层的较长说明文字。');
    document.body.appendChild(el);
    await wait(50);

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0 }));
    await wait(900);

    const first = [...document.querySelectorAll('.pi-tooltip')];
    const firstBg = first[0] ? getComputedStyle(first[0]).backgroundColor : '';
    const themedVar = getComputedStyle(document.documentElement).getPropertyValue('--bg-2').trim();
    const box = first[0]?.getBoundingClientRect();
    const inViewport = box
      ? box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth
      : false;

    // 模拟 Vue 在流式更新时把绑定的 title 重新写回
    el.setAttribute('title', '示例提示：这是更新后的说明文字。');
    await wait(250);

    const afterTips = [...document.querySelectorAll('.pi-tooltip')];
    const afterTitle = el.getAttribute('title');
    const afterText = afterTips[0]?.textContent ?? '';

    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
    await wait(400);
    const closed = document.querySelectorAll('.pi-tooltip').length;
    const restored = el.getAttribute('title');

    // 真实界面元素：悬停后应被接管（元素可能因流式重渲染失效，失效时跳过该断言）
    const real = [...document.querySelectorAll('[title]')]
      .find(node => !node.closest('.pi-tooltip') && (node.getAttribute('title') || '').trim().length > 20);
    let realIntercepted = null;
    if (real) {
      real.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0 }));
      await wait(700);
      realIntercepted = real.isConnected ? real.getAttribute('title') === null : null;
      real.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
      await wait(300);
    }

    el.remove();
    return {
      count_first: first.length,
      bg_first: firstBg,
      white_first: isWhite(firstBg),
      in_viewport: inViewport,
      themed_var: themedVar,
      count_after_readd: afterTips.length,
      title_after_readd: afterTitle,
      text_updated: afterText.includes('更新后的说明'),
      count_closed: closed,
      title_restored: restored,
      real_intercepted: realIntercepted,
    };
  })()`);

  assert.equal(result.count_first, 1, "悬停时只能有一个提示浮层");
  assert.ok(!result.white_first, `提示浮层必须跟随主题，不能是白底：${result.bg_first}`);
  assert.ok(result.in_viewport, "提示浮层必须完整落在视口内（锚点滚出视口时也不能跑到屏幕外）");
  assert.equal(result.count_after_readd, 1, "title 被重新写回后仍只能有一个浮层");
  assert.equal(
    result.title_after_readd,
    null,
    "展示期间必须持续接管 title，否则浏览器会同时弹出原生白底提示（白色 + 两个）",
  );
  assert.ok(result.text_updated, "title 更新后浮层文案应同步");
  assert.equal(result.count_closed, 0, "移出后提示应收起");
  assert.ok(result.title_restored?.includes("更新后的说明"), "移出后应还原最新 title，便于下次悬停与可访问性");
  if (result.real_intercepted === false) {
    throw new Error("真实界面元素的 title 未被接管");
  }

  console.log(
    `[tooltip] PASS 主题色 / 单浮层 / 属性写回接管 / 收起还原（真实元素接管=${result.real_intercepted}）`,
  );
}
