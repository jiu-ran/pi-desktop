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

    // 界面在冒烟期间可能滚动（滚动会按设计收起浮层），因此轮询到出现为止再断言。
    // 带上指针坐标：提示层除了 mouseover，还会按指针位置接管「后来才写回的 title」。
    const at = () => {
      const box = el.getBoundingClientRect();
      return { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
    };
    // 快速划过（停不到 SHOW_DELAY=700ms）不该弹出提示
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, buttons: 0, ...at() }));
    await wait(300);
    const early = document.querySelector(".pi-tooltip");
    // 移开：挂起的提示要取消，title 要写回去
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, buttons: 0, clientX: 8, clientY: 8 }));
    await wait(250);
    const afterLeave = { tooltip: Boolean(document.querySelector(".pi-tooltip")), title: el.getAttribute("title") };

    let shown = false;
    for (let attempt = 0; attempt < 12 && !shown; attempt += 1) {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...at() }));
      for (let i = 0; i < 10; i += 1) {
        await wait(100);
        if (document.querySelector('.pi-tooltip')) { shown = true; break; }
        if (el.isConnected && !el.hasAttribute('title')) {
          // title 已被摘掉说明正在延迟/展示中，继续等待即可
        }
      }
    }
    if (early) throw new Error("快速划过不该弹出提示（SHOW_DELAY 应为 700ms）");
    if (afterLeave.tooltip) throw new Error("移出后不该残留提示浮层");
    if (!afterLeave.title) throw new Error("移出后要把 title 写回去");

    const first = [...document.querySelectorAll('.pi-tooltip')];
    const firstBg = first[0] ? getComputedStyle(first[0]).backgroundColor : '';
    const themedVar = getComputedStyle(document.documentElement).getPropertyValue('--bg-2').trim();
    const box = first[0]?.getBoundingClientRect();
    const inViewport = box
      ? box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth
      : false;

    // 模拟 Vue 在流式更新时把绑定的 title 重新写回。
    // 冒烟期间界面可能在滚动（滚动会按设计收起浮层），所以轮询到浮层重新出现、文案同步为止。
    el.setAttribute('title', '示例提示：这是更新后的说明文字。');
    let afterTips = [];
    let afterText = '';
    for (let i = 0; i < 25; i += 1) {
      afterTips = [...document.querySelectorAll('.pi-tooltip')];
      afterText = afterTips[0]?.textContent ?? '';
      if (afterTips.length === 1 && afterText.includes('更新后的说明')) break;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...at() }));
      await wait(100);
    }
    const afterTitle = el.getAttribute('title');

    // 指针停住时元素被重渲染：Vue 换了新节点、新节点自带 title，没有新的 mouseover。
    // 这种情况也必须接管，否则浏览器会弹原生白底提示（「偶尔出现白底弹窗」的来源）。
    // 真实重渲染不会先触发离开事件，所以这里不能先 dispatch mouseout。
    const replacement = el.cloneNode(true);
    replacement.id = 'pi-tooltip-fixture-replaced';
    replacement.setAttribute('title', '重渲染后的提示文本');
    document.body.replaceChild(replacement, el);
    // 指针确实停在这个位置上：浮层的 300ms 探测靠 pointermove 记住坐标，
    // 不报一次的话探测会判定「指针不在元素上」而把浮层收起。
    {
      const box = replacement.getBoundingClientRect();
      const at = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...at }));
      replacement.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...at }));
      replacement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...at }));
    }
    // 接管靠 300ms 的指针探测：单次等待容易在「界面正在滚动 / 元素刚好被盖住」时误判，
    // 这里按元素当前坐标持续把指针报给它，最多等 3 秒。
    let replacedStripped = false;
    for (let i = 0; i < 30; i += 1) {
      await wait(100);
      if (!replacement.isConnected) break;
      if (replacement.getAttribute('title') === null) {
        replacedStripped = true;
        break;
      }
      // 不额外补指针/悬停事件：元素位置没变，浮层自己的 300ms 探测就能命中；
      // 多派发一次会重走显示流程，把「浮层个数」数到中间态。
    }
    // 让浮层的插入/替换落定再数：轮询到只剩一个浮层为止（最多 1.5s），
    // 否则可能数在「旧的还没收起、新的刚插进来」的中间态。
    for (let i = 0; i < 15; i += 1) {
      if (document.querySelectorAll('.pi-tooltip').length <= 1) break;
      await wait(100);
    }
    await wait(200);
    const replacedTip = document.querySelector('.pi-tooltip')?.textContent ?? '';
    const replacedCount = document.querySelectorAll('.pi-tooltip').length;
    // 出问题时把每个浮层的身份/位置打出来：模板里只有一个 v-if 节点，
    // 出现两个说明重复挂载或别处也用了同名 class。
    const tipNodes = [...document.querySelectorAll('.pi-tooltip')].map((node) => {
      const box = node.getBoundingClientRect();
      return "#" + (node.id || "(no-id)") + "@" + Math.round(box.left) + "," + Math.round(box.top) +
        " «" + (node.textContent || "").slice(0, 24) + "»";
    });

    replacement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
    let closed = 1;
    let restored = replacement.getAttribute('title');
    for (let i = 0; i < 20 && restored === null; i += 1) {
      await wait(120);
      closed = document.querySelectorAll('.pi-tooltip').length;
      restored = replacement.getAttribute('title');
    }

    // 真实界面元素：悬停后应被接管（元素可能因流式重渲染失效，失效时跳过该断言）
    const real = [...document.querySelectorAll('[title]')]
      .find(node => !node.closest('.pi-tooltip') && (node.getAttribute('title') || '').trim().length > 20);
    let realIntercepted = null;
    if (real) {
      // 界面可能在滚动（滚动按设计收起浮层），轮询到 title 被摘掉为止。
      const box = real.getBoundingClientRect();
      const atReal = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      for (let i = 0; i < 15; i += 1) {
        real.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...atReal }));
        await wait(100);
        if (!real.isConnected) break;
        if (real.getAttribute('title') === null) break;
      }
      realIntercepted = real.isConnected ? real.getAttribute('title') === null : null;
      real.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
      await wait(300);
    }

    // 活动栏图标：这里最容易「放上去偶尔冒白底」，单独验一次接管。
    const barBtn = [...document.querySelectorAll('.activity-bar button[title]')]
      .find((node) => (node.getAttribute('title') || '').trim().length > 3);
    let barIntercepted = null;
    if (barBtn) {
      const box = barBtn.getBoundingClientRect();
      const atBar = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      // 活动栏会随插件状态重渲染：轮询到 title 被摘掉为止，别只等一次。
      for (let i = 0; i < 15; i += 1) {
        barBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...atBar }));
        await wait(100);
        if (!barBtn.isConnected) break;
        if (barBtn.getAttribute('title') === null) break;
      }
      barIntercepted = barBtn.isConnected ? barBtn.getAttribute('title') === null : null;
      barBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
      await wait(300);
    }

    // 父元素有提示、子元素自己也有提示：必须切到子元素并摘掉它的 title，
    // 否则父级浮层一直挂着，子元素会弹原生白底提示（排队卡片的编辑/撤回按钮就是这样）。
    // 先把上一阶段可能还挂着的浮层收干净（mousedown 是提示层的强制收起路径）
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(250);

    const outer = document.createElement('div');
    outer.id = 'pi-tooltip-nested';
    outer.style.cssText = 'position:fixed;left:140px;top:220px;width:200px;height:60px;z-index:20000;padding:8px';
    outer.setAttribute('title', '父级提示：整张卡片');
    const inner = document.createElement('button');
    inner.type = 'button';
    inner.id = 'pi-tooltip-nested-child';
    inner.textContent = '子按钮';
    inner.setAttribute('title', '子级提示：撤回这条');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    await wait(50);
    const atOuter = () => {
      const box = outer.getBoundingClientRect();
      return { clientX: Math.round(box.left + 8), clientY: Math.round(box.top + 8) };
    };
    let outerTip = "";
    let outerTrace = null;
    // 注意：重复派发 mouseover 会重置排队的 380ms 延迟，所以每次尝试之间要留够时间。
    for (let attempt = 0; attempt < 4 && !outerTip; attempt += 1) {
      outer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...atOuter() }));
      for (let i = 0; i < 6 && !outerTip; i += 1) {
        await wait(120);
        const node = document.querySelector('.pi-tooltip');
        const text = node?.textContent ?? "";
        outerTrace = {
          attempt,
          step: i,
          tips: document.querySelectorAll('.pi-tooltip').length,
          text: text.slice(0, 20),
          outerTitle: outer.getAttribute('title'),
        };
        if (text) outerTip = text;
      }
    }
    let nestedChildTitle = null;
    let nestedOuterTitleWhileChildActive = null;
    let nestedTip = "";
    if (inner.isConnected) {
      const box = inner.getBoundingClientRect();
      const atInner = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...atInner }));
      // 断言的核心是「子元素与父元素的 title 都被摘掉了，且跨过 300ms 指针探测周期后不会反复切回父元素」
      for (let i = 0; i < 20; i += 1) {
        inner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 0, ...atInner }));
        await wait(120);
        if (!inner.isConnected) break;
        const tipText = document.querySelector('.pi-tooltip')?.textContent ?? "";
        if (tipText) nestedTip = tipText;
        if (inner.getAttribute('title') === null) break;
      }
      // 等待跨过至少一次 300ms probeUnderPointer，确认不会在父子提示间来回乒乓
      await wait(420);
      const afterProbeText = document.querySelector('.pi-tooltip')?.textContent ?? "";
      if (afterProbeText) nestedTip = afterProbeText;
      nestedChildTitle = inner.isConnected ? inner.getAttribute('title') : null;
      nestedOuterTitleWhileChildActive = outer.isConnected ? outer.getAttribute('title') : null;
      inner.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, buttons: 0, relatedTarget: document.body }));
      await wait(250);
    }
    const nestedOuterRestored = outer.getAttribute('title');
    outer.remove();

    el.remove();
    replacement.remove();
    return {
      nested_outer_tip: outerTip,
      nested_debug: { trace: outerTrace, visibility: document.visibilityState },
      nested_child_title: nestedChildTitle,
      nested_outer_while_child: nestedOuterTitleWhileChildActive,
      nested_outer_restored: nestedOuterRestored,
      nested_child_tip: nestedTip,
      // title 可能在 mouseout 时被还原，这里取「移出前是否已被摘掉」的布尔值
      nested_child_intercepted: nestedChildTitle === null,
      count_first: first.length,
      replaced_stripped: replacedStripped,
      replaced_tip: replacedTip,
      replaced_count: replacedCount,
      bg_first: firstBg,
      white_first: isWhite(firstBg),
      in_viewport: inViewport,
      themed_var: themedVar,
      count_after_readd: afterTips.length,
      title_after_readd: afterTitle,
      text_updated: afterText.includes('更新后的说明'),
      count_closed: closed,
      tip_nodes: tipNodes,
      title_restored: restored,
      real_intercepted: realIntercepted,
      bar_intercepted: barIntercepted,
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
  assert.ok(result.title_restored?.includes("重渲染后的提示文本"), "移出后应还原最新 title，便于下次悬停与可访问性");
  if (result.real_intercepted === false) {
    throw new Error("真实界面元素的 title 未被接管");
  }
  if (result.bar_intercepted === false) throw new Error("活动栏图标的 title 未被接管");
  if (result.nested_outer_tip) {
    assert.match(result.nested_outer_tip, /父级提示/, `父级浮层应显示父级文案，实际「${result.nested_outer_tip}」`);
  }
  assert.equal(
    result.nested_child_intercepted,
    true,
    "子元素自己的 title 也必须被接管，否则父级浮层挂着的同时会弹原生白底提示",
  );
  assert.equal(
    result.nested_outer_while_child,
    null,
    "悬停子元素期间父元素的原生 title 也必须被暂存摘除，否则浏览器会弹出父级原生白底提示且导致父子提示反复切换",
  );
  assert.ok(
    result.nested_outer_restored?.includes("父级提示"),
    "离开子元素与父元素后应还原父元素的 title",
  );
  if (result.nested_child_tip) {
    assert.match(result.nested_child_tip, /子级提示/, `浮层应切换到子元素文案，实际「${result.nested_child_tip}」`);
  }
  assert.equal(
    result.replaced_stripped,
    true,
    "指针停住时被重渲染的元素也必须接管 title，否则会弹原生白底提示",
  );
  // 只保证「不会出现两个浮层」（白底双弹的来源）。元素被换掉后是否继续显示取决于
  // 指针状态，不显示也是可接受的，所以断言 ≤ 1。
  assert.ok(
    result.replaced_count <= 1,
    `重渲染后不能出现两个浮层（实际 ${result.replaced_count} 个：${(result.tip_nodes ?? []).join(" | ")}）`,
  );
  if (result.replaced_count === 1) {
    assert.match(result.replaced_tip, /重渲染后的提示文本/, "显示时浮层文案应为新 title");
  }

  // 批量写回 title 不能在主线程里做 O(n) 次强制重排：日志里抓到的卡死栈正是
  // 这个 MutationObserver 回调，一次重渲染写回上千个 title 就把界面拖住几分钟。
  const burstMs = await win.webContents.executeJavaScript(`(() => new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'pi-tooltip-burst';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px';
    document.body.appendChild(host);
    const rows = [];
    for (let i = 0; i < 3000; i += 1) {
      const row = document.createElement('div');
      row.textContent = 'row ' + i;
      host.appendChild(row);
      rows.push(row);
    }
    const started = performance.now();
    for (const row of rows) row.setAttribute('title', '批量标题 ' + Date.now());
    // MutationObserver 的回调在微任务里、timer 之前跑：这个 setTimeout 的耗时包含它
    setTimeout(() => {
      const elapsed = Math.round(performance.now() - started);
      host.remove();
      resolve(elapsed);
    }, 0);
  }))()`);
  console.log(`[tooltip] 3000 个 title 写回耗时 ${burstMs}ms`);
  assert.ok(burstMs < 2000, `批量写回 title 不能把主线程占住（${burstMs}ms，标准 < 2000ms）`);

  console.log(
    `[tooltip] PASS 主题色 / 单浮层 / 属性写回接管 / 重渲染接管 / 收起还原 / 批量写回不卡（${burstMs}ms）`,
  );
}
