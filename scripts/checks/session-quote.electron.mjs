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

    // ---- 编辑引用：改名称与注入的上下文 ----
    await evaluate("document.querySelector('.attachment-chip.session').click(); true");
    await poll("Boolean(document.querySelector('[data-quote-modal]'))", "点击对话附件应打开编辑对话框");
    const quote = JSON.parse(await evaluate(`(() => {
      const dialog = document.querySelector('.quote-dialog');
      const area = dialog.querySelector('.quote-textarea');
      const name = dialog.querySelector('.quote-input');
      return JSON.stringify({
        name: name?.value ?? '',
        body: area?.value ?? '',
        meta: dialog.querySelector('.quote-meta')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        actions: [...dialog.querySelectorAll('.quote-actions button')].map((n) => n.textContent.trim()),
        restoreDisabled: dialog.querySelector('.quote-actions .btn.ghost')?.disabled ?? null,
      });
    })()`));
    assert.match(quote.name, /报表/, `对话框应带出会话名称，实际「${quote.name}」`);
    assert.ok(quote.body.includes("报表导出的表头错位"), "上下文正文应预填自动摘要");
    assert.match(quote.meta, /\d+ 条消息/, `应显示消息条数，实际「${quote.meta}」`);
    assert.ok(quote.actions.includes("保存"), "要有保存按钮");
    assert.equal(quote.restoreDisabled, true, "还没改成自定义时「恢复自动摘要」应禁用");

    await evaluate(`(() => {
      const dialog = document.querySelector('.quote-dialog');
      const name = dialog.querySelector('.quote-input');
      name.value = "报表会话（我的备注）";
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const area = dialog.querySelector('.quote-textarea');
      area.value = "只保留结论：表头错位的原因是对齐时取了错的列宽。";
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    // Vue 要等一拍才会把「保存」从 disabled 状态放开，所以单独点
    await evaluate(`(() => {
      const dialog = document.querySelector('.quote-dialog');
      const save = [...dialog.querySelectorAll('.quote-actions button')].find((n) => n.textContent.trim() === "保存");
      if (!save || save.disabled) return false;
      save.click();
      return true;
    })()`).then((ok) => assert.ok(ok, "「保存」按钮应可用"));
await poll("!document.querySelector('[data-quote-modal]')", "保存后对话框应关闭");
    const edited = JSON.parse(await evaluate(`(() => {
      const chip = document.querySelector('.attachment-chip.session');
      const item = window.__piDesktop.workbench.active.value.attachments.find((a) => a.kind === "session");
      return JSON.stringify({
        label: chip.querySelector('span:nth-child(2)')?.textContent.trim() ?? '',
        badge: chip.querySelector('.attachment-chip-edited')?.textContent.trim() ?? '',
        chipEdited: chip.classList.contains('edited'),
        customText: item?.customText ?? '',
        name: item?.name ?? '',
      });
    })()`));
    assert.equal(edited.label, "报表会话（我的备注）", "名称应更新到附件上");
    assert.equal(edited.badge, "已编辑", "改过的引用应有「已编辑」标记");
    assert.ok(edited.chipEdited, "改过的引用应有虚线边框样式");
    assert.ok(edited.customText.includes("只保留结论"), `自定义正文应保存下来，实际「${edited.customText}」`);

    // 发送时用自定义正文，不再走自动摘要
    {
      const { buildCustomSessionBlocks } = await import("../../packages/ui/src/shared/session-block.ts");
      const text = buildCustomSessionBlocks([
        { path: "quote-report.jsonl", name: edited.name, customText: edited.customText, messages: 2 },
      ]);
      assert.ok(text.includes("只保留结论"), "自定义正文应进入上下文块");
      assert.ok(text.startsWith('<session name="'), "仍是标准的会话块格式");
      assert.ok(!text.includes("已经改成 JWT"), "不应再带上自动摘要");
    }

    // 恢复自动摘要 → 「已编辑」消失
    await evaluate("document.querySelector('.attachment-chip.session').click(); true");
    await poll("Boolean(document.querySelector('[data-quote-modal]'))", "再次打开编辑对话框");
    await evaluate(`(() => {
      const dialog = document.querySelector('.quote-dialog');
      [...dialog.querySelectorAll('.quote-actions button')].find((n) => n.textContent.includes("恢复自动")).click();
      return true;
    })()`);
    await poll("!document.querySelector('[data-quote-modal]')", "恢复自动后对话框应关闭");
    const restored = JSON.parse(await evaluate(`(() => {
      const chip = document.querySelector('.attachment-chip.session');
      const item = window.__piDesktop.workbench.active.value.attachments.find((a) => a.kind === "session");
      return JSON.stringify({
        badge: Boolean(chip.querySelector('.attachment-chip-edited')),
        customText: item?.customText ?? null,
      });
    })()`));
    assert.equal(restored.badge, false, "恢复自动后不应再有「已编辑」标记");
    assert.equal(restored.customText, null, "恢复自动后应清掉自定义正文");

    // 截图：引用编辑对话框（人工确认排版）
    await evaluate("document.querySelector('.attachment-chip.session').click(); true");
    await poll("Boolean(document.querySelector('[data-quote-modal]'))", "截图用引用编辑对话框");
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
      console.log("[session-quote] shot", await shot("quote-dialog-dark.png"));
      await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
      await wait(400);
      console.log("[session-quote] shot", await shot("quote-dialog-light.png"));
      await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
      await wait(200);
    }
    await evaluate("document.querySelector('.quote-dialog .quote-actions .btn.ghost')?.click(); true");
    await wait(250);
    // 把名称改回真实标题：后面的键盘/去重用例按标题匹配候选
    await evaluate("document.querySelector('.attachment-chip.session').click(); true");
    await poll("Boolean(document.querySelector('[data-quote-modal]'))", "改回名称前打开对话框");
    await evaluate(`(() => {
      const name = document.querySelector('.quote-dialog .quote-input');
      name.value = "修一下报表导出的表头错位";
      name.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await evaluate(`(() => {
      const save = [...document.querySelectorAll('.quote-dialog .quote-actions button')].find((n) => n.textContent.trim() === "保存");
      if (!save || save.disabled) return false;
      save.click();
      return true;
    })()`).then((ok) => assert.ok(ok, "改回名称后应能保存"));
    await poll("!document.querySelector('[data-quote-modal]')", "改回名称后对话框应关闭");

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

    console.log("[session-quote] PASS 分组 / 选择 / 去重 / 键盘 / 搜索 / 编辑引用 / 移除 / 发送上下文");
  } finally {
    // 临时工作区不能留在「最近项目」里：下次启动会去加载已被删掉的会话，
    // 界面会一直弹「会话无效」。会话文件也一并清掉。
    await evaluate("window.__piDesktop.workbench.forget(" + literal + ").catch(() => true)").catch(() => {});
    for (const file of seeds) await rm(file, { force: true }).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
