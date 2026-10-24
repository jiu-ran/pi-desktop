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
  // 草稿现在存成 JSON（正文 + 附件），按 text 字段判断是否落盘。
  const storedValue = (text) => `(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('pi-desktop.composer-draft:')) continue;
      const raw = localStorage.getItem(key) ?? '';
      let value = null;
      try { value = JSON.parse(raw); } catch { value = raw; }
      const stored = typeof value === 'string' ? value : (value?.text ?? '');
      if (stored === ${JSON.stringify(text)}) return true;
    }
    return false;
  })()`;
  const stored = storedValue(draft);
  const hasAttachmentDraft = `(() => {
    const target = 'README.md';
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('pi-desktop.composer-draft:')) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? '');
        if ((value?.attachments ?? []).some((item) => String(item?.path ?? '').includes(target))) return true;
      } catch { /* 忽略旧格式 */ }
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

  // 附件也要进草稿：写一个真实文件并加入附件，等它落到 localStorage。
  // 用仓库里已有的 README.md 当附件，避免在真实工作区里新建文件。
  const addedAttachment = await evaluate(`(async () => {
    const ws = window.__piDesktop.workbench.active.value;
    const sep = ws.cwd.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : '/';
    await window.__piDesktop.workbench.addFiles([ws.cwd + sep + 'README.md']);
    return true;
  })()`);
  assert(addedAttachment, "应能加入附件");
  await poll(hasAttachmentDraft, "附件写入草稿");
  console.log("[composer-draft] 附件已写入草稿");

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

  // 重启后附件也要回来（草稿不只保存文字）。
  await poll(
    `[...document.querySelectorAll('.attachment-chip')].some((chip) => chip.textContent.includes('README.md'))`,
    "重启后应恢复附件",
  );
  console.log("[composer-draft] 重启后已恢复附件");

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
  // 附件也要清掉，否则草稿键会保留（本次测试用的是临时会话）
  await evaluate(`(async () => {
    const ws = window.__piDesktop.workbench.active.value;
    for (const item of [...(ws?.attachments ?? [])]) {
      window.__piDesktop.workbench.removeAttachment(item.path);
    }
    return true;
  })()`);
  await wait(900);
  assert.equal(await evaluate(stored), false, "清空输入后应删除草稿");

  console.log("[composer-draft] PASS 落盘 / 重启恢复正文与附件 / 清空删除 / 无空工具卡片");
}
