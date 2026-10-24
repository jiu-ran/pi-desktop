import assert from "node:assert/strict";

/**
 * 排队展示回归（纯渲染侧，不请求模型）：
 * - 排队中的消息只在对话里出现一次（气泡带「待发送」），输入框上方不再重复列出
 * - 队列里对不上气泡的条目才显示成待发送卡片（带模式标签与截断预览）
 * - 队列清空后气泡上的「待发送」消失
 */
export async function checkQueueInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 6000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(100);
    }
    throw new Error(`排队展示检查超时：${label}`);
  };

  const ids = JSON.parse(await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    const prompt = '<file name="C:\\\\tmp\\\\note.txt">\\n内容\\n</file>\\n顺便看下日志';
    thread.transcript.removeBlock("queue-a");
    thread.transcript.removeBlock("queue-b");
    const a = thread.transcript.pushUser("顺便看下日志", 0, { queueText: prompt });
    a.id = "queue-a";
    const b = thread.transcript.pushUser("这条没有气泡对应", 0, { queueText: "另一条完整提示词" });
    b.id = "queue-b";
    // 只把 a 的那条放进队列：b 用另一个文本，模拟「别人的队列项」
    thread.queue = { steering: [], followUp: [prompt, "只存在于队列里的消息"] };
    return JSON.stringify({ a: a.id, b: b.id });
  })()`));

  await poll("Boolean(document.querySelector('.msg-user-queued'))", "气泡上应出现「待发送」标记");

  const view = JSON.parse(await evaluate(`(() => {
    const badge = document.querySelector('.msg-user-queued');
    const bubble = badge?.closest('.msg-user-bubble');
    const cards = [...document.querySelectorAll('.queue-card')];
    return JSON.stringify({
      bubblesWithBadge: document.querySelectorAll('.msg-user-bubble.queued').length,
      badgeText: badge?.textContent.trim() ?? '',
      cards: cards.map((n) => ({
        tag: n.querySelector('.queue-card-tag')?.textContent.trim() ?? '',
        text: n.querySelector('.queue-card-text')?.textContent.trim() ?? '',
        title: n.getAttribute('title') ?? '',
      })),
      label: document.querySelector('.queue-label')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
      recall: Boolean(document.querySelector('.queue-recall')),
      // 附件 XML 绝不能出现在卡片上
      leaksMarkers: (document.querySelector('.queue-strip')?.textContent ?? '').includes('<file'),
      badgeInsideUser: Boolean(bubble),
    });
  })()`));

  assert.equal(view.bubblesWithBadge, 1, `只应有一个气泡标成待发送，实际 ${view.bubblesWithBadge}`);
  assert.equal(view.badgeText, "待发送", "气泡上的标记文案不对");
  assert.ok(view.badgeInsideUser, "标记要在用户气泡里");
  assert.equal(view.cards.length, 1, `队列里只有没对上气泡的那条才显示，实际 ${view.cards.length}`);
  assert.equal(view.cards[0].tag, "排队", "卡片要标出模式");
  assert.equal(view.cards[0].text, "只存在于队列里的消息", `卡片预览不对：${view.cards[0].text}`);
  assert.ok(view.recall, "待发送区要有撤回按钮");
  assert.equal(view.leaksMarkers, false, "卡片上不能出现附件 XML");
  assert.match(view.label, /1 条待发送/, `标题应显示条数，实际「${view.label}」`);

  // 截图留档：人工确认排版（调试协议截图，避免拿到旧帧）
  const shot = async (name) => {
    try {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) await dbg.attach("1.3");
      const result = await Promise.race([
        dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!result?.data) return `${name}（跳过）`;
      const { writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const { tmpdir } = await import("node:os");
      await writeFile(path.join(tmpdir(), name), Buffer.from(result.data, "base64"));
      return name;
    } catch (error) {
      return `${name}（失败：${error?.message ?? error}）`;
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
  };
  console.log("[queue] shot", await shot("queue-dark.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
  await wait(400);
  console.log("[queue] shot", await shot("queue-light.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
  await wait(200);

  // 队列被消费（清空）后：气泡标记与卡片都要消失
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    thread.queue = { steering: [], followUp: [] };
    return true;
  })()`);
  await poll("!document.querySelector('.msg-user-queued')", "队列清空后「待发送」要消失");
  assert.equal(await evaluate("document.querySelectorAll('.queue-card').length"), 0, "队列清空后不应残留卡片");

  // 清理注入的块
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    thread.transcript.removeBlock("queue-a");
    thread.transcript.removeBlock("queue-b");
    return true;
  })()`);

  console.log("[queue] PASS 单次展示 / 气泡标记 / 卡片预览 / 撤回入口 / 清空回收", ids.a, ids.b);
}
