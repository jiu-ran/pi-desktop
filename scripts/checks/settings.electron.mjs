import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 设置界面回归（纯前端，不请求模型）：
 * - 左侧导航按分组展示、每项都有图标，当前项高亮
 * - 右侧标题栏显示当前分区的标题与说明
 * - 每个分区都能打开且不报错、不出现横向溢出
 * - 搜索会过滤导航；底部只保留「恢复默认 / 完成」
 */
export async function checkSettingsInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(120);
    }
    throw new Error(`设置界面检查超时：${label}`);
  };

  await evaluate("window.__piDesktop.settings.open(); true");
  await poll("Boolean(document.querySelector('.settings-modal'))", "设置弹窗应打开");
  await wait(300);

  // 导航：分组 + 图标 + 高亮
  const nav = JSON.parse(await evaluate(`(() => {
    const groups = [...document.querySelectorAll('.settings-nav-group')].map((n) => n.textContent.trim());
    const items = [...document.querySelectorAll('.settings-nav-item')].map((n) => ({
      label: n.querySelector('.settings-nav-label')?.textContent.trim() ?? '',
      tab: n.getAttribute('data-settings-tab') ?? '',
      icon: Boolean(n.querySelector('.settings-nav-icon svg')),
      active: n.classList.contains('active'),
    }));
    return JSON.stringify({ groups, items });
  })()`));
  assert.ok(nav.groups.length >= 3, `导航应分组显示，实际 ${nav.groups.length} 组`);
  assert.ok(nav.items.length >= 8, `导航项太少：${nav.items.length}`);
  assert.ok(nav.items.every((item) => item.icon), "每个导航项都要有图标");
  assert.equal(nav.items.filter((item) => item.active).length, 1, "只应有一个高亮项");
  assert.ok(nav.groups.includes("对话与 Agent") && nav.groups.includes("桌面端"), `分组标题不对：${nav.groups.join("/")}`);

  // 标题栏：标题 + 说明
  const head = JSON.parse(await evaluate(`(() => {
    const modal = document.querySelector('.settings-modal');
    return JSON.stringify({
      title: modal.querySelector('.settings-title')?.textContent.trim() ?? '',
      desc: modal.querySelector('.settings-desc')?.textContent.trim() ?? '',
      footer: [...modal.querySelectorAll('.settings-footer button')].map((n) => n.textContent.trim()),
      hint: modal.querySelector('.settings-footer-hint')?.textContent.trim() ?? '',
    });
  })()`));
  assert.ok(head.title.length > 0, "标题栏应显示分区标题");
  assert.ok(head.desc.length > 6, `标题栏应显示分区说明，实际「${head.desc}」`);
  assert.deepEqual(head.footer, ["恢复默认", "完成"], `底部按钮应精简为两项，实际 ${head.footer.join("/")}`);
  assert.ok(head.hint.length > 0, "底部应说明改动会保存");

  // 逐个分区打开，检查横向溢出与卡片化
  const tabs = nav.items.map((item) => item.tab);
  const problems = [];
  for (const tab of tabs) {
    await evaluate(`document.querySelector('[data-settings-tab="${tab}"]').click(); true`);
    await wait(220);
    const state = JSON.parse(await evaluate(`(() => {
      const body = document.querySelector('.settings-body');
      const modal = document.querySelector('.settings-modal');
      return JSON.stringify({
        title: document.querySelector('.settings-title')?.textContent.trim() ?? '',
        groups: document.querySelectorAll('.settings-body .settings-group').length,
        overflowX: body ? body.scrollWidth - body.clientWidth : -1,
        modalOverflow: modal ? modal.scrollWidth - modal.clientWidth : -1,
        rows: document.querySelectorAll('.settings-body .settings-row').length,
      });
    })()`));
    if (!state.title) problems.push(`${tab} 没有标题`);
    if (state.groups === 0) problems.push(`${tab} 没有配置分组`);
    if (state.overflowX > 2) problems.push(`${tab} 内容横向溢出 ${state.overflowX}px`);
    if (state.modalOverflow > 2) problems.push(`${tab} 弹窗横向溢出 ${state.modalOverflow}px`);
  }
  assert.deepEqual(problems, [], `分区渲染问题：${problems.join("；")}`);

  // 全局提示词页：编辑器必须按主题铺开（曾因为 CSS 丢了只剩两行白底，读不出来）
  await evaluate(`document.querySelector('[data-settings-tab="agents"]').click(); true`);
  await wait(400);
  const agents = JSON.parse(await evaluate(`(() => {
    const area = document.querySelector('.settings-body .agents-editor');
    const note = document.querySelector('.settings-body .settings-note');
    if (!area) return JSON.stringify({ missing: true });
    const style = getComputedStyle(area);
    const rect = area.getBoundingClientRect();
    const body = document.querySelector('.settings-body').getBoundingClientRect();
    return JSON.stringify({
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      bodyWidth: Math.round(body.width),
      bg: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius,
      font: style.fontFamily.slice(0, 24),
      note: note?.textContent.trim() ?? '',
      noteMono: note ? getComputedStyle(note).fontFamily.includes('Mono') || getComputedStyle(note).fontFamily.includes('mono') : false,
    });
  })()`));
  assert.ok(!agents.missing, "全局提示词页应有编辑器");
  assert.ok(agents.height >= 280, `编辑器高度太小：${agents.height}px`);
  assert.ok(agents.width >= agents.bodyWidth - 80, `编辑器应基本铺满宽度：${agents.width}/${agents.bodyWidth}`);
  assert.ok(!/rgb\(2[45]\d, 2[45]\d, 2[45]\d\)/.test(agents.bg), `深色主题下编辑器不该是白底：${agents.bg}`);
  assert.notEqual(agents.radius, "0px", "编辑器应带圆角（说明样式生效了）");
  assert.match(agents.note, /AGENTS\.md$/, `应显示配置文件路径：${agents.note}`);
  assert.equal(agents.noteMono, true, "路径要用等宽字体");
  console.log("[settings] agents", JSON.stringify(agents));

  // 搜索过滤
  await evaluate(`(() => {
    const input = document.querySelector('.settings-search input');
    input.value = "日志";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(250);
  const filtered = JSON.parse(await evaluate(`JSON.stringify({
    items: [...document.querySelectorAll('.settings-nav-item .settings-nav-label')].map((n) => n.textContent.trim()),
  })`));
  assert.deepEqual(filtered.items, ["运行日志"], `搜索「日志」应只剩运行日志：${filtered.items.join("/")}`);

  // 清空搜索后恢复
  await evaluate(`(() => {
    const input = document.querySelector('.settings-search input');
    input.value = "";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(200);
  assert.ok(
    (await evaluate("document.querySelectorAll('.settings-nav-item').length")) >= 8,
    "清空搜索后导航应恢复",
  );

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
  await evaluate(`document.querySelector('[data-settings-tab="appearance"]').click(); true`);
  await wait(300);
  console.log("[settings] shot", await shot("settings-dark.png"));
  await evaluate(`document.querySelector('[data-settings-tab="agents"]').click(); true`);
  await wait(300);
  console.log("[settings] shot", await shot("settings-dark-agents.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('light'); true");
  await wait(400);
  console.log("[settings] shot", await shot("settings-light.png"));
  await evaluate("window.__piDesktop.workbench.setTheme('dark'); true");
  await wait(200);

  await evaluate("window.__piDesktop.settings.close(); true");
  await wait(300);
  assert.equal(
    await evaluate("document.querySelectorAll('.settings-modal').length"),
    0,
    "关闭后设置弹窗应消失",
  );

  console.log("[settings] PASS 分组导航 / 图标 / 标题说明 / 全分区无溢出 / 搜索 / 精简底部");
}
