import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * `@` 引用对话回归（隔离临时工作区，不碰真实会话）：
 * - `@` 选择器里出现「引用对话」分组，不列当前会话
 * - 选中后变成一枚「对话」附件（名称 + 消息条数），输入框里的 @query 被清掉
 * - 键盘 ↓ / Enter 也能选；同一会话不会重复添加
 * - 按标题搜索能收敛到目标对话；点 × 可移除
 *
 * 被引用的会话直接写成 JSONL 放在本项目的会话目录里：这里只需要「读取」路径，
 * 不经过 Pi 的会话加载，避免和真实 worker 抢同一个会话文件。
 */
export async function checkSessionQuoteInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 10_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`引用对话检查超时：${label}`);
  };

  const dir = await mkdtemp(path.join(tmpdir(), "pi-quote-"));
  const seeds = [];
  const literal = JSON.stringify(dir);
  await writeFile(path.join(dir, "readme.txt"), "session quote check\n");

  /** 造一个可引用的会话文件：会话头 + 几条消息（标题取第一段用户文字）。 */
  const seedSession = async (sessionDir, name, title, reply) => {
    const file = path.join(sessionDir, `${name}.jsonl`);
    seeds.push(file);
    const rows = [
      { type: "session", version: 3, id: name, timestamp: new Date().toISOString(), cwd: dir },
      { type: "message", id: `${name}-1`, parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: title }] } },
      { type: "message", id: `${name}-2`, parentId: `${name}-1`, timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: reply }] } },
    ];
    await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    return file;
  };

  try {
    await evaluate(`window.__piDesktop.workbench.open(${literal}).then(() => true)`);
    await poll("window.__piDesktop.workbench.active.value?.status === 'ready'", "临时工作区就绪");

    const current = await evaluate("window.__piDesktop.workbench.active.value?.sessionFile");
    assert.ok(current, "应该有当前会话文件");
    const sessionDir = path.dirname(current);
    seeds.push(current);
    // 标题里带关键词，用于验证搜索
    await seedSession(sessionDir, "quote-jwt", "把登录改成 JWT，先看看现有实现", "已经改成 JWT 了");
    await seedSession(sessionDir, "quote-report", "修一下报表导出的表头错位", "表头对齐已经修好");
    await evaluate("window.__piDesktop.workbench.refreshSessions().then(() => true)");
    await poll(
      "window.__piDesktop.workbench.active.value?.sessions.filter(s => !s.empty).length >= 2",
      "会话列表里应有两个可引用会话",
    );

    /** 在输入框里打一个 `@`：走真实事件路径（选择器挂在 keyup 上）。 */
    const typeAt = async (text = "@") => {
      await evaluate(`(() => {
        const el = document.querySelector('.composer-field textarea');
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: '@', bubbles: true }));
        return true;
      })()`);
      await poll("Boolean(document.querySelector('.path-picker'))", "@ 选择器应打开");
    };

    await typeAt();
    await poll("Boolean(document.querySelector('.path-picker-session'))", "选择器里应出现「引用对话」候选");

    const picker = JSON.parse(await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.path-picker-session')];
      return JSON.stringify({
        sections: [...document.querySelectorAll('.path-picker-section')].map((n) => n.textContent.trim()),
        sessions: rows.map((n) => ({
          title: n.querySelector('.path-item-name')?.textContent.trim() ?? '',
          time: n.querySelector('.path-item-relative')?.textContent.trim() ?? '',
          icon: Boolean(n.querySelector('.path-item-icon.session svg')),
        })),
        currentListed: rows.some((n) => (n.title || '').length === 0),
      });
    })()`));
    // 选择器必须真的画在可视区域里（存在但被挤出视口 / 高度为 0 也是坏体验）
    const box = JSON.parse(await evaluate(`(() => {
      const node = document.querySelector('.path-picker');
      const rect = node.getBoundingClientRect();
      return JSON.stringify({
        width: Math.round(rect.width), height: Math.round(rect.height),
        top: Math.round(rect.top), bottom: Math.round(rect.bottom),
        viewport: window.innerHeight,
        visibleRows: [...document.querySelectorAll('.path-picker-item')].filter((n) => n.getBoundingClientRect().height > 0).length,
      });
    })()`));
    assert.ok(box.width > 240, `选择器太窄：${box.width}px`);
    assert.ok(box.height > 80, `选择器太矮：${box.height}px（可见候选 ${box.visibleRows} 行）`);
    assert.ok(box.top >= 0 && box.bottom <= box.viewport, `选择器应在视口内：top=${box.top} bottom=${box.bottom} viewport=${box.viewport}`);
    assert.ok(box.visibleRows >= 2, `至少要有 2 行可见候选，实际 ${box.visibleRows}`);

    assert.ok(picker.sections.includes("引用对话"), `缺少「引用对话」分组：${picker.sections.join("/")}`);
    assert.ok(picker.sessions.length >= 2, `应至少有两个可引用对话，实际 ${picker.sessions.length}`);
    assert.ok(picker.sessions.every((item) => item.title.length > 0), "对话候选必须显示名称");
    assert.ok(picker.sessions.every((item) => item.icon), "对话候选要有图标");
    assert.ok(picker.sessions.every((item) => item.time.length > 0), "对话候选要有时间");
    assert.ok(
      picker.sessions.some((item) => item.title.includes("JWT")) && picker.sessions.some((item) => item.title.includes("报表")),
      `对话候选的名称应来自会话内容：${picker.sessions.map((item) => item.title).join("/")}`,
    );

    // 点击选中 → 变成附件
    await evaluate("document.querySelector('.path-picker-session').click(); true");
    await poll("Boolean(document.querySelector('.attachment-chip.session'))", "选中后应出现对话附件");
    const chip = JSON.parse(await evaluate(`(() => {
      const node = document.querySelector('.attachment-chip.session');
      const el = document.querySelector('.composer-field textarea');
      return JSON.stringify({
        text: node.querySelector('span:nth-child(2)')?.textContent.trim() ?? '',
        meta: node.querySelector('.attachment-chip-meta')?.textContent.trim() ?? '',
        icon: Boolean(node.querySelector('.attachment-chip-icon svg')),
        draft: el.value,
        pickerOpen: Boolean(document.querySelector('.path-picker')),
      });
    })()`));
    assert.ok(chip.text.length > 0, "对话附件要显示会话名称");
    assert.equal(chip.meta, "2 条", `对话附件要显示消息条数，实际「${chip.meta}」`);
    assert.ok(chip.icon, "对话附件要有图标");
    assert.equal(chip.draft, "", "选中对话后输入框里的 @query 应被清掉");
    assert.equal(chip.pickerOpen, false, "选中后选择器应关闭");

    // 重复添加同一会话不会产生第二枚
    await typeAt();
    await evaluate("document.querySelector('.path-picker-session').click(); true");
    await wait(400);
    assert.equal(
      await evaluate("document.querySelectorAll('.attachment-chip.session').length"),
      1,
      "同一会话不应重复添加",
    );

    // 键盘：↓ 移动光标、Enter 选中。
    // 候选顺序依赖会话时间戳，不能假设「第二行就是另一个会话」——
    // 按标题找到还没引用过的那一行，再按对应次数移动光标。
    await typeAt();
    const steps = await evaluate(`(() => {
      const attached = new Set([...document.querySelectorAll('.attachment-chip.session span:nth-child(2)')]
        .map((n) => n.textContent.trim()));
      const titles = [...document.querySelectorAll('.path-picker-session .path-item-name')]
        .map((n) => n.textContent.trim());
      const target = titles.findIndex((title) => title && !attached.has(title));
      return target < 0 ? -1 : target;
    })()`);
    assert.ok(steps >= 0, "应有一个还没被引用的对话可用于键盘选择");
    await evaluate(`(() => {
      const el = document.querySelector('.composer-field textarea');
      for (let i = 0; i < ${steps}; i += 1) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    await poll("document.querySelectorAll('.attachment-chip.session').length === 2", "键盘选中应加第二枚对话附件");
    const titles = JSON.parse(await evaluate(
      `JSON.stringify([...document.querySelectorAll('.attachment-chip.session')].map((n) => n.querySelector('span:nth-child(2)')?.textContent.trim() ?? ''))`,
    ));
    assert.equal(new Set(titles).size, 2, `键盘选中的应是另一个会话：${titles.join("/")}`);

    // 渲染进程 → 主进程的真实链路：附件里的会话路径能被压成上下文块
    const attachedPath = await evaluate("window.__piDesktop.workbench.active.value.attachments.find((a) => a.kind === 'session')?.path ?? ''");
    assert.ok(attachedPath, "对话附件里应带着会话文件路径");
    const prepared = JSON.parse(await evaluate(`window.piDesktop
      .prepareSessionAttachments(window.__piDesktop.workbench.active.value.cwd, [${JSON.stringify(attachedPath)}])
      .then((r) => JSON.stringify({ chars: r.text.length, items: r.items.length, block: r.text.startsWith("<session name=") }))`));
    assert.equal(prepared.items, 1, "应回传一个会话条目");
    assert.ok(prepared.block, "上下文块应以 <session name= 开头");
    assert.ok(prepared.chars > 40 && prepared.chars < 30_000, `上下文长度异常：${prepared.chars}`);

    // 搜索：标题里的词应收敛候选；已引用的会话不会重复出现
    await typeAt("@报表");
    await poll("Boolean(document.querySelector('.path-picker-session'))", "按标题搜索应命中对话");
    const searched = JSON.parse(await evaluate(`JSON.stringify({
      sessions: [...document.querySelectorAll('.path-picker-session')].map((n) => n.querySelector('.path-item-name')?.textContent.trim() ?? ''),
      paths: document.querySelectorAll('.path-picker-item:not(.path-picker-session)').length,
    })`));
    assert.equal(searched.sessions.length, 1, `搜索「报表」应只剩一个对话候选：${searched.sessions.join("/")}`);
    assert.match(searched.sessions[0], /报表/, "搜索命中的对话标题应含关键词");

    // 视觉：暗色 / 亮色各截一张，人工确认排版。
    // 用调试协议截图：窗口被遮挡时 capturePage 会拿到旧画面（检查刚加上的浮层看不到）。
    const shot = async (name) => {
      try {
        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) await dbg.attach("1.3");
        const result = await Promise.race([
          dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (!result?.data) return `${name}（截图超时，跳过）`;
        await writeFile(path.join(tmpdir(), name), Buffer.from(result.data, "base64"));
        return name;
      } catch (error) {
        return `${name}（截图失败：${error?.message ?? error}）`;
      } finally {
        // 调试协议用完就断，别影响后面的检查
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      }
    };
    console.log("[session-quote] shot", await shot("quote-picker-dark.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
    await wait(500);
    console.log("[session-quote] shot", await shot("quote-picker-light.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
    await wait(300);

    // 移除全部对话附件
    while (await evaluate("document.querySelectorAll('.attachment-chip.session').length")) {
      await evaluate("document.querySelector('.attachment-chip.session button').click(); true");
      await wait(200);
    }
    assert.equal(
      await evaluate("document.querySelectorAll('.attachment-chip.session').length"),
      0,
      "点击 × 应移除对话附件",
    );
    await evaluate(`(() => {
      const el = document.querySelector('.composer-field textarea');
      el.value = "";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`);

    console.log("[session-quote] PASS 分组 / 选择 / 去重 / 键盘 / 搜索 / 移除 / 发送上下文");
  } finally {
    // 临时工作区不能留在「最近项目」里：下次启动会去加载已被删掉的会话，
    // 界面会一直弹「会话无效」。会话文件也一并清掉。
    await evaluate("window.__piDesktop.workbench.forget(" + literal + ").catch(() => true)").catch(() => {});
    for (const file of seeds) await rm(file, { force: true }).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
