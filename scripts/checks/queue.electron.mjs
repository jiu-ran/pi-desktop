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

  await poll("document.querySelectorAll('.queue-card').length === 2", "两条排队消息都应列在输入框上方");

  const view = JSON.parse(await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.queue-card')];
    return JSON.stringify({
      // 队列里那条已经乐观渲染成气泡：上方既然列出来了，对话里就不能再显示
      hiddenBubble: Boolean(document.querySelector('[data-block-id="queue-a"]')),
      visibleBubbles: document.querySelectorAll('.msg-user-bubble').length,
      badges: cards.map((n) => n.querySelector('.queue-card-badge')?.textContent.trim() ?? ''),
      edits: cards.map((n) => Boolean(n.querySelector('.queue-card-edit'))),
      cards: cards.map((n) => ({
        tag: n.querySelector('.queue-card-tag')?.textContent.trim() ?? '',
        text: n.querySelector('.queue-card-text')?.textContent.trim() ?? '',
        title: n.getAttribute('title') ?? '',
      })),
      label: document.querySelector('.queue-label')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
      recall: Boolean(document.querySelector('.queue-recall')),
      // 附件 XML 绝不能出现在卡片上
      leaksMarkers: (document.querySelector('.queue-strip')?.textContent ?? '').includes('<file'),
    });
  })()`));

  assert.equal(view.hiddenBubble, false, "还排在队列里的消息不应同时出现在对话里");
  assert.equal(view.visibleBubbles, 1, `队列里没有对应气泡的那条照常显示，实际 ${view.visibleBubbles}`);
  assert.equal(view.cards.length, 2, `队列里的两条都应列在输入框上方，实际 ${view.cards.length}`);
  assert.deepEqual(view.badges, ["待发送", "待发送"], "每条都要带「待发送」标记");
  assert.deepEqual(view.edits, [true, true], "每条都要能点开编辑");
  assert.equal(view.cards[0].tag, "排队", "卡片要标出模式");
  assert.ok(
    view.cards.some((card) => card.text === "只存在于队列里的消息"),
    `队列里那条没有气泡的消息应显示在卡片上：${view.cards.map((c) => c.text).join(" | ")}`,
  );
  assert.ok(view.recall, "待发送区要有撤回按钮");
  assert.equal(view.leaksMarkers, false, "卡片上不能出现附件 XML");
  assert.match(view.label, /2 条待发送/, `标题应显示条数，实际「${view.label}」`);

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

  // ---- 编辑排队消息 ----
  // 真实编辑会调用 clearQueue / steer / followUp（可能真的开始一轮对话），
  // 这里只验证界面链路：把 editQueued 换成记录函数，断言参数正确。
  await evaluate(`(() => {
    window.__queueEditCalls = [];
    const workbench = window.__piDesktop.workbench;
    window.__queueEditOriginal = workbench.editQueued;
    workbench.editQueued = async (target, text) => {
      window.__queueEditCalls.push({ target, text });
      return true;
    };
    return true;
  })()`);

  // 1) 卡片上的文字就是编辑入口（第一条是气泡对应的那条）
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "点击卡片应展开编辑框");
  {
    const editor = JSON.parse(await evaluate(`(() => {
      const area = document.querySelector('.queue-editor textarea');
      return JSON.stringify({
        value: area.value,
        rows: area.rows,
        actions: [...document.querySelectorAll('.queue-editor-actions button')].map((n) => n.textContent.trim()),
        hint: document.querySelector('.queue-editor-hint')?.textContent.trim() ?? '',
      });
    })()`));
    assert.equal(editor.value, "只存在于队列里的消息", `编辑框应预填这条消息的实际内容，实际「${editor.value}」`);
    assert.ok(editor.actions.includes("保存并重新排队"), "要有保存按钮");
    assert.ok(editor.actions.includes("取消"), "要有取消按钮");
    assert.match(editor.hint, /排队/, "编辑框要标出模式");
  }

  // 2) 保存 → editQueued 收到「原来的完整提示词 + 新文字」
  await evaluate(`(() => {
    const area = document.querySelector('.queue-editor textarea');
    area.value = "改过之后的消息";
    area.dispatchEvent(new Event('input', { bubbles: true }));
    const save = [...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes("保存"));
    save.click();
    return true;
  })()`);
  await poll("!document.querySelector('.queue-editor')", "保存后编辑框应关闭");
  {
    const calls = JSON.parse(await evaluate("JSON.stringify(window.__queueEditCalls)"));
    assert.equal(calls.length, 1, `应只提交一次编辑，实际 ${calls.length}`);
    assert.equal(calls[0].text, "改过之后的消息", "保存的是新文字");
    assert.equal(calls[0].target.text, "只存在于队列里的消息", "要带上原来的队列项用于定位");
    assert.equal(calls[0].target.mode, "followUp", "模式要对");
  }

  // 3) Esc 取消不发请求
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "再次打开编辑框");
  await evaluate(`(() => {
    const area = document.querySelector('.queue-editor textarea');
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await wait(200);
  assert.equal(await evaluate("document.querySelectorAll('.queue-editor').length"), 0, "Esc 应关闭编辑框");
  assert.equal(
    JSON.parse(await evaluate("JSON.stringify(window.__queueEditCalls)")).length,
    1,
    "取消不应提交编辑",
  );

  // 4) 卡片右侧的「编辑」按钮同样能进入编辑
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-edit')?.click();
    return Boolean(card);
  })()`).then((ok) => assert.ok(ok, "待发送卡片上应有「编辑」按钮"));
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "卡片上的编辑应打开编辑框");
  {
    const value = await evaluate("document.querySelector('.queue-editor textarea').value");
    assert.equal(value, "只存在于队列里的消息", `编辑框应预填这条消息的内容，实际「${value}」`);
  }
  await evaluate("[...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes('取消'))?.click(); true");
  await wait(200);

  // 还原 editQueued
  await evaluate(`(() => {
    window.__piDesktop.workbench.editQueued = window.__queueEditOriginal;
    return true;
  })()`);

  // 截图：编辑态的排队消息（人工确认排版）
  await evaluate(`(() => {
    const card = [...document.querySelectorAll('.queue-card')]
      .find((n) => (n.querySelector('.queue-card-text')?.textContent ?? '').includes('只存在于队列里'));
    card?.querySelector('.queue-card-text')?.click();
    return Boolean(card);
  })()`);
  await poll("Boolean(document.querySelector('.queue-editor textarea'))", "截图用编辑框");
  {
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
        const nodePath = await import("node:path");
        const { tmpdir } = await import("node:os");
        await writeFile(nodePath.join(tmpdir(), name), Buffer.from(result.data, "base64"));
        return name;
      } catch (error) {
        return `${name}（失败：${error?.message ?? error}）`;
      } finally {
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      }
    };
    console.log("[queue] shot", await shot("queue-edit-dark.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
    await wait(400);
    console.log("[queue] shot", await shot("queue-edit-light.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
    await wait(200);
  }
  await evaluate("[...document.querySelectorAll('.queue-editor-actions button')].find((n) => n.textContent.includes('取消'))?.click(); true");
  await wait(200);
  // 队列被消费（清空）后：气泡标记与卡片都要消失
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    thread.queue = { steering: [], followUp: [] };
    return true;
  })()`);
  await poll("!document.querySelector('.queue-card')", "队列清空后「待发送」要消失");
  assert.equal(await evaluate("document.querySelectorAll('.queue-card').length"), 0, "队列清空后不应残留卡片");

  // 清理注入的块
  await evaluate(`(() => {
    const thread = window.__piDesktop.workbench.active.value.activeThread;
    thread.transcript.removeBlock("queue-a");
    thread.transcript.removeBlock("queue-b");
    return true;
  })()`);

  console.log("[queue] PASS 单次展示 / 气泡标记 / 卡片预览 / 编辑 / 撤回入口 / 清空回收", ids.a, ids.b);
}
