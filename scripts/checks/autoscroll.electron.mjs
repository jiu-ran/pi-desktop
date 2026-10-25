import assert from "node:assert/strict";

/**
 * 流式输出时的「上滑被弹回底部」回归。
 *
 * 用户报的现象：AI 边输出边看历史，向上滑一下，画面又自己回到最底部（少数情况才出现）。
 *
 * 根因（旧实现）：程序化滚动后 120ms 内的 scroll 事件一律当成「自己滚的」忽略掉。
 * 流式输出每几十毫秒就贴底一次，这个窗口几乎一直是开的 —— 用户那一次 scroll 被吞掉，
 * `stick` 仍是 true，于是下一次内容长高又贴回底部。
 *
 * 现在的判定：
 * - 只有「scrollTop 还停在我们上次设置的位置」才算自己滚的（值判定，不看时间窗）；
 * - 滚轮向上立刻 `stick = false`，并让已排队的贴底帧作废。
 *
 * 这里用真实的 DOM 撑高 + wheel 事件验证：上滑之后继续长高，位置必须留在历史处。
 */
export async function checkAutoScrollInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(80);
    }
    throw new Error(`滚动检查超时：${label}`);
  };

  const LINE = "这是一段用来把对话撑高的内容，验证上滑之后不会被弹回底部，重复重复重复重复重复重复重复。";
  const push = (n) =>
    evaluate(
      `(() => { window.__piDesktop.workbench.active.value.activeThread.transcript.pushUser(${JSON.stringify(`第 ${n} 条：${LINE}`)}, 0); return true; })()`,
    );
  /** 可见的滚动容器（前面几步可能留下隐藏项目视图，取clientHeight 最大的那个） */
  // 只认「画着我刚刚塞进去的那条内容」并且可见的那个 timeline：
  // 切换过工作区时 DOM 里可能同时存在旧视图（clientHeight 为 0），拿错了就会测到假结果。
  const scrollerExpr = `[...document.querySelectorAll(".timeline")]
    .filter((el) => el.clientHeight > 200 && el.textContent.includes("第 "))
    .pop() ?? document.querySelector(".timeline")`;
  const metrics = () =>
    evaluate(`(() => {
      const el = ${scrollerExpr};
      return JSON.stringify({
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: Math.round(el.scrollHeight),
        clientHeight: Math.round(el.clientHeight),
        distance: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        jump: Boolean(document.querySelector(".jump-latest")),
      });
    })()`);
  const wheelUp = (deltaY = -240) =>
    evaluate(`(() => {
      const el = ${scrollerExpr};
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: ${deltaY}, bubbles: true, cancelable: true }));
      return true;
    })()`);

  // 清掉当前会话已有内容，避免干扰
  const clear = () =>
    evaluate(`(() => {
      const thread = window.__piDesktop.workbench.active.value.activeThread;
      for (const block of [...thread.blocks]) thread.transcript.removeBlock(block.id);
      return true;
    })()`);

  // 前面几步可能把设置弹窗留在打开状态，先关掉再测滚动
  await evaluate(`(() => { window.__piDesktop.settings.close(); return true; })()`);
  // 确保「当前工作区」就是屏幕上渲染的那个视图：不然 push 到的是另一个线程的 blocks，
  // 页面上那条 .timeline 根本不会长高（独立跑这个检查时会遇到）。
  await evaluate(
    `window.__piDesktop.workbench.open(window.__piDesktop.workbench.state.activeCwd).then(() => true)`,
  ).catch(() => {});
  await wait(1200);
  await clear();
  await wait(250);

  // 1. 撑到超过两屏，并且应该自动贴底
  for (let i = 0; i < 18; i += 1) {
    await push(i);
    await wait(70);
  }
  await poll(
    `(() => { const el = ${scrollerExpr}; return Boolean(el) && el.scrollHeight > el.clientHeight + 220; })()`,
    "内容撑高",
  ).catch(async (error) => {
    const info = await evaluate(`(() => JSON.stringify({
      timelines: [...document.querySelectorAll(".timeline")].map((el) => ({ h: el.scrollHeight, c: el.clientHeight })),
      blocks: window.__piDesktop.workbench.active.value?.blocks?.length,
      modal: Boolean(document.querySelector(".settings-modal")),
      cwd: window.__piDesktop.workbench.state.activeCwd,
    }))()`);
    throw new Error(`${error.message}：${info}`);
  });
  await wait(250);
  const tall = JSON.parse(await metrics());
  assert.ok(tall.scrollHeight > tall.clientHeight + 200, `内容应明显超过一屏：${JSON.stringify(tall)}`);
  assert.ok(tall.distance <= 90, `输出时应该自动贴底，实际离底部 ${tall.distance}px`);

  // 2. 用户上滑：必须在「刚贴完底」的瞬间滑（流式输出时用户就是这么滑的）。
  //    旧实现会把这期间滚出来的 scroll 事件当成自己的滚动忽略掉，使上滑不生效。
  await push(90);
  await wait(40);
  await wheelUp(-240);
  await evaluate(`(() => {
    const el = ${scrollerExpr};
    el.scrollTop = Math.max(0, el.scrollTop - 320);
    return true;
  })()`);
  await wait(150);
  const paused = JSON.parse(await metrics());
  assert.ok(paused.distance > 200, `上滑后应停在历史位置，实际离底部 ${paused.distance}px`);
  assert.equal(paused.jump, true, "上滑后应出现「回到底部」提示");

  for (let i = 18; i < 28; i += 1) {
    await push(i);
    await wait(80);
  }
  await wait(300);
  const after = JSON.parse(await metrics());
  assert.ok(
    after.distance > 150,
    `继续输出时不该被拉回底部：上滑后离底部 ${paused.distance}px，之后只剩 ${after.distance}px`,
  );
  assert.equal(after.jump, true, "仍应显示「回到底部」");

  // 3. 点「回到底部」恢复跟随，之后继续贴底
  await evaluate(`(() => { document.querySelector(".jump-latest").click(); return true; })()`);
  await wait(300);
  const jumped = JSON.parse(await metrics());
  assert.ok(jumped.distance <= 90, `点「回到底部」后应贴底，实际离底部 ${jumped.distance}px`);
  await push(30);
  await wait(300);
  const following = JSON.parse(await metrics());
  assert.ok(following.distance <= 90, `恢复跟随后应继续贴底，实际离底部 ${following.distance}px`);

  // 4. 内容不到一屏时上滑不该出现「回到底部」（否则按钮会乱弹）
  await clear();
  await wait(200);
  await push(99);
  await wait(300);
  await wheelUp(-240);
  await wait(200);
  const shortList = JSON.parse(await metrics());
  assert.equal(shortList.jump, false, "内容不到一屏时上滑不该出现「回到底部」");

  await clear();

  console.log(
    "[autoscroll]",
    JSON.stringify({ tall: tall.distance, paused: paused.distance, after: after.distance, jumped: jumped.distance, following: following.distance }),
  );
}
