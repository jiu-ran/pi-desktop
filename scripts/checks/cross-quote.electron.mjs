import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * 「@ 引用其它项目对话」插件回归（隔离临时工作区）：
 * - 插件注册在对话区域、可停用
 * - 启用时 `@` 选择器多出「其它项目的对话」分组，列出别的项目的会话
 * - 选中后变成一枚对话附件，输入框里的 @query 被清掉
 * - 停用插件后分组消失（核心的当前项目候选不受影响）
 */
export async function checkCrossProjectQuoteInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 12_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`引用其它项目对话检查超时：${label}`);
  };

  const dirA = await mkdtemp(path.join(tmpdir(), "pi-cross-a-"));
  const dirB = await mkdtemp(path.join(tmpdir(), "pi-cross-b-"));
  const seeds = [];
  const literalA = JSON.stringify(dirA);
  const literalB = JSON.stringify(dirB);
  await writeFile(path.join(dirA, "readme.txt"), "project a\n");
  await writeFile(path.join(dirB, "readme.txt"), "project b\n");

  const openProject = async (literal, label) => {
    await evaluate(`window.__piDesktop.workbench.open(${literal}).then(() => true)`);
    await poll("window.__piDesktop.workbench.active.value?.status === 'ready'", label);
    await wait(500);
    return evaluate("window.__piDesktop.workbench.active.value?.sessionFile");
  };

  try {
    // 插件应当是「对话区域 + 可停用」
    const plugin = JSON.parse(await evaluate(`(() => {
      const record = window.__piDesktop.plugins.records.find((r) => r.id === "session-quote");
      return JSON.stringify(record ? { area: record.area, core: record.core, enabled: record.enabled, name: record.name } : null);
    })()`));
    assert.ok(plugin, "「@ 引用其它项目对话」应作为插件注册");
    assert.equal(plugin.area, "conversation", "插件应属于对话区域");
    assert.equal(plugin.core, false, "插件应允许停用");

    // 先打开 B，拿到它的会话目录，塞一个「B 项目的对话」
    const sessionB = await openProject(literalB, "B 项目就绪");
    assert.ok(sessionB, "B 项目应有会话文件");
    const sessionDirB = path.dirname(sessionB);
    const seeded = path.join(sessionDirB, "cross-quote-0001.jsonl");
    seeds.push(seeded);
    await writeFile(
      seeded,
      [
        JSON.stringify({ type: "session", version: 3, id: "cross-1", timestamp: new Date().toISOString(), cwd: dirB }),
        JSON.stringify({
          type: "message",
          id: "cross-1-1",
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: "user", content: [{ type: "text", text: "B 项目里那件事：报表导出表头错位" }] },
        }),
        JSON.stringify({
          type: "message",
          id: "cross-1-2",
          parentId: "cross-1-1",
          timestamp: new Date().toISOString(),
          message: { role: "assistant", content: [{ type: "text", text: "已经修好了" }] },
        }),
      ].join("\n") + "\n",
    );

    // 回到 A 项目，在输入框里打 @
    await openProject(literalA, "A 项目就绪");
    await evaluate(`(() => {
      const el = document.querySelector('.composer-field textarea');
      el.focus();
      el.value = "@报表";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: '@', bubbles: true }));
      return true;
    })()`);
    await poll("Boolean(document.querySelector('.path-picker'))", "@ 选择器应打开");
    await poll("Boolean(document.querySelector('.path-picker-plugin'))", "应出现其它项目的对话候选");

    const view = JSON.parse(await evaluate(`(() => {
      const groups = [...document.querySelectorAll('.path-picker-section')].map((n) => n.textContent.trim());
      const rows = [...document.querySelectorAll('[data-mention-source="session-quote.other-projects"]')].map((n) => ({
        label: n.querySelector('.path-item-name')?.textContent.trim() ?? '',
        hint: n.querySelector('.path-item-relative')?.textContent.trim() ?? '',
        icon: Boolean(n.querySelector('.path-item-icon.session svg')),
      }));
      return JSON.stringify({ groups, rows });
    })()`));
    assert.ok(view.groups.includes("其它项目的对话"), `应有「其它项目的对话」分组：${view.groups.join("/")}`);
    assert.equal(view.rows.length, 1, `搜索「报表」应只剩 B 项目那条，实际 ${view.rows.map((row) => row.label).join("/")}`);
    assert.match(view.rows[0].label, /报表/, "候选标题应来自会话内容");
    assert.match(view.rows[0].hint, new RegExp(path.basename(dirB).split("-").slice(0, 2).join("-")), `候选应标出所属项目：${view.rows[0].hint}`);
    assert.ok(view.rows[0].icon, "候选要有图标");

    // 截图留档（调试协议，避免拿到旧帧）
    const shot = async (name) => {
      try {
        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) await dbg.attach("1.3");
        const result = await Promise.race([
          dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (!result?.data) return `${name}（跳过）`;
        await writeFile(path.join(tmpdir(), name), Buffer.from(result.data, "base64"));
        return name;
      } catch (error) {
        return `${name}（失败：${error?.message ?? error}）`;
      } finally {
        if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      }
    };
    console.log("[cross-quote] shot", await shot("cross-quote-dark.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
    await wait(400);
    console.log("[cross-quote] shot", await shot("cross-quote-light.png"));
    await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
    await wait(200);

    // 选中 → 变成对话附件，@query 清掉
    await evaluate(`document.querySelector('[data-mention-source="session-quote.other-projects"]').click(); true`);
    await poll("Boolean(document.querySelector('.attachment-chip.session'))", "选中后应出现对话附件");
    const chip = JSON.parse(await evaluate(`(() => {
      const node = document.querySelector('.attachment-chip.session');
      const el = document.querySelector('.composer-field textarea');
      return JSON.stringify({
        text: node.querySelector('span:nth-child(2)')?.textContent.trim() ?? '',
        draft: el.value,
        pickerOpen: Boolean(document.querySelector('.path-picker')),
      });
    })()`));
    assert.match(chip.text, /报表/, "附件应显示会话标题");
    assert.equal(chip.draft, "", "选中后输入框里的 @query 应被清掉");
    assert.equal(chip.pickerOpen, false, "选中后选择器应关闭");

    // 主进程能把这条别的项目的会话压成上下文块
    const prepared = JSON.parse(
      await evaluate(
        `window.piDesktop.prepareSessionAttachments(window.__piDesktop.workbench.active.value.cwd, [${JSON.stringify(seeded)}])
          .then((r) => JSON.stringify({ items: r.items.length, block: r.text.startsWith("<session name="), has: r.text.includes("报表导出表头错位") }))`,
      ),
    );
    assert.equal(prepared.items, 1, "别的项目的会话也应能引用");
    assert.ok(prepared.block, "应生成 <session> 上下文块");
    assert.ok(prepared.has, "上下文块里应有会话内容");

    // 清掉附件，停用插件后分组应消失
    await evaluate("document.querySelector('.attachment-chip.session button')?.click(); true");
    await wait(200);
    await evaluate("window.__piDesktop.plugins.toggle('session-quote').then(() => true)");
    await poll("!window.__piDesktop.plugins.records.find((r) => r.id === 'session-quote')?.enabled", "插件应已停用");
    await evaluate(`(() => {
      const el = document.querySelector('.composer-field textarea');
      el.value = "";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      el.value = "@报表";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: '@', bubbles: true }));
      return true;
    })()`);
    await poll("Boolean(document.querySelector('.path-picker'))", "停用后选择器仍应能打开");
    await wait(600);
    const after = JSON.parse(await evaluate(`(() => JSON.stringify({
      rows: document.querySelectorAll('[data-mention-source="session-quote.other-projects"]').length,
      groups: [...document.querySelectorAll('.path-picker-section')].map((n) => n.textContent.trim()),
    }))()`));
    assert.equal(after.rows, 0, "停用插件后不应再列出其它项目的对话");
    assert.ok(!after.groups.includes("其它项目的对话"), `停用后分组应消失：${after.groups.join("/")}`);

    // 恢复启用，避免影响后续检查/用户状态
    await evaluate("window.__piDesktop.plugins.toggle('session-quote').then(() => true)");
    await poll("Boolean(window.__piDesktop.plugins.records.find((r) => r.id === 'session-quote')?.enabled)", "插件应恢复启用");
    await evaluate(`(() => {
      const el = document.querySelector('.composer-field textarea');
      el.value = "";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`);

    console.log("[cross-quote] PASS 插件注册 / 其它项目候选 / 选择成附件 / 上下文块 / 停用后消失");
  } finally {
    for (const file of seeds) await rm(file, { force: true }).catch(() => {});
    await evaluate(`window.__piDesktop.workbench.forget(${literalA}).catch(() => true)`).catch(() => {});
    await evaluate(`window.__piDesktop.workbench.forget(${literalB}).catch(() => true)`).catch(() => {});
    await rm(dirA, { recursive: true, force: true }).catch(() => {});
    await rm(dirB, { recursive: true, force: true }).catch(() => {});
  }
}
