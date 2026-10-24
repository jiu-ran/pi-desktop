import assert from "node:assert/strict";

/**
 * 输入框草稿持久化回归：写入 → 重新加载渲染进程（等同重启）→ 恢复。
 * 同时校验会话里不存在无名占位工具块（空「工具」卡片）。
 */
export async function checkComposerDraftInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(150);
    }
    throw new Error(`草稿持久化检查超时：${label}`);
  };

  const context = await evaluate(`(() => {
    const ws = window.__piDesktop.workbench.active.value;
    return ws && ws.status === "ready" ? { cwd: ws.cwd, sessionFile: ws.sessionFile } : null;
  })()`);
  if (!context) {
    console.log("[composer-draft] 跳过：工作区未就绪");
    return;
  }

  const draft = `草稿恢复测试 ${Date.now()}`;
  const stored = `(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && localStorage.getItem(key) === ${JSON.stringify(draft)}) return true;
    }
    return false;
  })()`;

  await evaluate(`(() => {
    const el = document.querySelector('.composer-field textarea');
    if (!el) return false;
    el.value = ${JSON.stringify(draft)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // 写入是防抖的（400ms），等它真正落到 localStorage
  await poll(stored, "草稿写入 localStorage");
  console.log("[composer-draft] 草稿已落盘");

  // 重新加载渲染进程：等同关闭再打开应用（localStorage 保留）
  await win.webContents.reload();
  await poll("Boolean(window.__piDesktop)", "重载后内核可用", 30000);
  await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(context.cwd)}).then(()=>true)`);
  await poll("window.__piDesktop.workbench.active.value?.status === 'ready'", "重载后工作区就绪");

  await poll(
    `document.querySelector('.composer-field textarea')?.value === ${JSON.stringify(draft)}`,
    "重启后输入框应恢复上次内容",
  );
  console.log("[composer-draft] 重启后已恢复输入内容");

  // 会话里不允许出现无名工具块（空「工具」卡片）
  const ghostTools = await evaluate(`(() => {
    const ws = window.__piDesktop.workbench.active.value;
    const threads = Object.values(ws?.threads ?? {});
    const ghosts = [];
    for (const thread of threads) {
      for (const block of thread.blocks ?? []) {
        if (block.kind === "tool" && !String(block.name ?? "").trim()) ghosts.push(block.id);
      }
    }
    return ghosts;
  })()`);
  assert.equal(ghostTools.length, 0, `不应存在无名工具块：${ghostTools.join(", ")}`);

  // 清理测试草稿，避免污染真实输入框
  await evaluate(`(() => {
    const el = document.querySelector('.composer-field textarea');
    if (!el) return false;
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(700);
  assert.equal(await evaluate(stored), false, "清空输入后应删除草稿");

  console.log("[composer-draft] PASS 落盘 / 重启恢复 / 清空删除 / 无空工具卡片");
}
