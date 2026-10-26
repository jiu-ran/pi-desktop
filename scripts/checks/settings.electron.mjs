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

  /** 二级 tab 只在所属分区里渲染，点它之前先切分区 */
  const SECTION_OF = { conversation: "chat", agents: "chat", skills: "power", mcp: "power", packages: "power", plugins: "power", appearance: "look", terminal: "desktop", environment: "desktop", logs: "desktop" };
  const openTab = async (id) => {
    await evaluate(`document.querySelector('[data-settings-section="${SECTION_OF[id]}"]')?.click() ?? null; true`);
    await wait(180);
    await evaluate(`document.querySelector('[data-settings-tab="${id}"]')?.click() ?? null; true`);
    await wait(220);
  };

  // 上次退出时停在哪一页是持久的，先归位到「对话」再读导航
  await evaluate(`document.querySelector('[data-settings-section="chat"]')?.click() ?? null; true`);
  await wait(250);

  // 导航：4 个一级分区（左栏）+ 二级 tab（内容区顶部）
  const nav = JSON.parse(await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.settings-nav-item')].map((n) => ({
      label: n.querySelector('.settings-nav-label')?.textContent.trim() ?? '',
      section: n.getAttribute('data-settings-section') ?? '',
      icon: Boolean(n.querySelector('.settings-nav-icon svg')),
      count: n.querySelector('.settings-nav-count')?.textContent.trim() ?? '',
      active: n.classList.contains('active'),
    }));
    const subtabs = [...document.querySelectorAll('.settings-subtabs .settings-subtab')].map((n) => ({
      label: n.textContent.trim(),
      tab: n.getAttribute('data-settings-tab') ?? '',
      active: n.classList.contains('active'),
    }));
    return JSON.stringify({ sections, subtabs });
  })()`));
  assert.deepEqual(
    nav.sections.map((item) => item.label),
    ["对话", "能力", "外观", "桌面"],
    `左栏只留四个一级分区，实际 ${nav.sections.map((item) => item.label).join("/")}`,
  );
  assert.ok(nav.sections.every((item) => item.icon), "每个分区都要有图标");
  assert.equal(nav.sections.filter((item) => item.active).length, 1, "只应有一个分区高亮");
  assert.equal(nav.sections.map((item) => item.count).join(""), "2413", "分区右侧标出二级 tab 数量");
  assert.ok(nav.subtabs.length >= 2, "对话分区下应有二级 tab");
  assert.equal(nav.subtabs.filter((item) => item.active).length, 1, "只应有一个二级 tab 高亮");

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
  const problems = [];
  const sections = nav.sections.map((item) => item.section);
  const visited = [];
  for (const section of sections) {
    await evaluate(`document.querySelector('[data-settings-section="${section}"]').click(); true`);
    await wait(200);
    const tabs = JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('.settings-subtab')].map((n) => n.getAttribute('data-settings-tab')))`),
    );
    // 只有一个页的分区不画二级 tab 条，这时点分区本身就够了
    for (const tab of tabs.length ? tabs : [null]) {
      visited.push(tab ?? `section:${section}`);
      if (tab) {
        await evaluate(`document.querySelector('[data-settings-tab="${tab}"]').click(); true`);
        await wait(220);
      }
      const state = JSON.parse(await evaluate(`(() => {
        const body = document.querySelector('.settings-body');
        const modal = document.querySelector('.settings-modal');
        return JSON.stringify({
          title: document.querySelector('.settings-title')?.textContent.trim() ?? '',
          groups: document.querySelectorAll('.settings-body .settings-group').length,
          overflowX: body ? body.scrollWidth - body.clientWidth : -1,
          modalOverflow: modal ? modal.scrollWidth - modal.clientWidth : -1,
          rows: document.querySelectorAll('.settings-body .settings-row').length,
        // 行标题被挤成一条竖排的表现是宽度只剩一两个字，高度却很大
        squeezed: [...document.querySelectorAll('.settings-body .settings-row')]
          .map((row) => {
            const strong = row.querySelector('.settings-row-info > strong');
            if (!strong) return null;
            const rect = strong.getBoundingClientRect();
            return { text: strong.textContent.trim().slice(0, 20), width: Math.round(rect.width), height: Math.round(rect.height) };
          })
          .filter((item) => item && item.text.length > 3 && item.width < 60),
        });
      })()`));
      const label = tab ?? section;
      if (!state.title) problems.push(`${label} 没有标题`);
      if (state.groups === 0) problems.push(`${label} 没有配置分组`);
      if (state.overflowX > 2) problems.push(`${label} 内容横向溢出 ${state.overflowX}px`);
      if (state.squeezed.length) {
        problems.push(`${label} 的行标题被挤成竖排：${state.squeezed.map((item) => item.text).join(" / ")}`);
      }
      if (state.modalOverflow > 2) problems.push(`${label} 弹窗横向溢出 ${state.modalOverflow}px`);
    }
  }
  assert.deepEqual(problems, [], `分区渲染问题：${problems.join("；")}`);
  assert.deepEqual(
    visited.slice().sort(),
    ["agents", "conversation", "environment", "logs", "mcp", "packages", "plugins", "section:look", "skills", "terminal"],
    `四个分区要覆盖全部 10 个设置页，实际 ${visited.join("/")}`,
  );

  // 全局提示词页：编辑器必须按主题铺开（曾因为 CSS 丢了只剩两行白底，读不出来）
  await openTab("agents");
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

  // 环境页：Pi 状态/路径/更新应该在同一张卡里（以前分成两张，内容还重复）
  await openTab("environment");
  await wait(350);
  const env = JSON.parse(await evaluate(`(() => {
    const groups = [...document.querySelectorAll('.settings-body .settings-group')].map((group) => ({
      title: group.querySelector('.settings-group-title')?.textContent.trim() ?? '',
      rows: [...group.querySelectorAll('.settings-row strong')].map((n) => n.textContent.trim()),
    }));
    const pi = groups.find((group) => group.title.includes('Pi CLI'));
    return JSON.stringify({ titles: groups.map((g) => g.title), piRows: pi?.rows ?? [] });
  })()`));
  assert.ok(!env.titles.includes("Pi CLI 更新"), `不应再有单独的「Pi CLI 更新」卡：${env.titles.join("/")}`);
  assert.ok(env.titles.includes("本机 Pi CLI"), `应有合并后的「本机 Pi CLI」卡：${env.titles.join("/")}`);
  for (const label of ["Pi Coding Agent CLI", "Pi 路径", "检查并更新 Pi", "Pi 自动更新", "当前活动项目目录"]) {
    assert.ok(env.piRows.includes(label), `合并后的卡片应包含「${label}」，实际：${env.piRows.join("/")}`);
  }
  console.log("[settings] environment", JSON.stringify({ titles: env.titles }));

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
  const hitHint = await evaluate(`document.querySelector('.settings-nav-item .settings-nav-hint')?.textContent.trim() ?? ''`);
  assert.equal(hitHint, "桌面", `搜索命中要标出所属分区，实际「${hitHint}」`);

  // 清空搜索后恢复
  await evaluate(`(() => {
    const input = document.querySelector('.settings-search input');
    input.value = "";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(200);
  assert.equal(
    await evaluate("document.querySelectorAll('.settings-nav-item').length"),
    4,
    "清空搜索后左栏应恢复成四个分区",
  );

  // ---- 搜索：关键字命中 / ↑↓ + Enter / 空结果提示 ----
  const typeSearch = async (text) => {
    await evaluate(`(() => {
      const input = document.querySelector('.settings-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await wait(240);
  };
  const pressKey = async (key) => {
    await evaluate(`document.querySelector('.settings-search input').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true`);
    await wait(180);
  };

  await typeSearch("深色");
  const keywordHits = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.settings-result-item')].map((node) => ({
    tab: node.getAttribute('data-settings-result') ?? '',
    label: node.querySelector('.settings-nav-label')?.textContent?.trim() ?? '',
    keyword: node.querySelector('.settings-nav-keyword')?.textContent?.trim() ?? '',
  })))`));
  assert.equal(keywordHits[0]?.tab, "appearance", `搜「深色」应命中外观页：${JSON.stringify(keywordHits)}`);
  assert.equal(keywordHits[0]?.keyword, "深色", "命中关键字的行要标出关键字");
  assert.ok(keywordHits.every((item) => item.label.length > 0), "搜索结果要能读出页名");

  // ↑↓ 换选中项，Enter 打开并收搜索
  await pressKey("ArrowDown");
  const keyboardSelected = await evaluate("document.querySelector('.settings-result-item.keyboard')?.getAttribute('data-settings-result') ?? ''");
  assert.ok(keyboardSelected.length > 0, "↑↓ 要能选中结果");
  await pressKey("Enter");
  await wait(320);
  const afterEnter = JSON.parse(await evaluate(`JSON.stringify({
    query: document.querySelector('.settings-search input').value,
    title: document.querySelector('.settings-title')?.textContent.trim() ?? '',
    section: document.querySelector('.settings-nav-item.active')?.getAttribute('data-settings-section') ?? '',
  })`));
  assert.equal(afterEnter.query, "", "Enter 打开结果后要清空搜索，回到正常导航");
  assert.ok(afterEnter.title.length > 0, "Enter 之后要停在被打开的那一页");
  assert.equal(afterEnter.section, "look", `「深色」打开的是外观分区，实际 ${afterEnter.section}`);

  // 空结果：给出可试的关键字，而不是一句「没有」
  await typeSearch("不存在的设置项");
  const empty = JSON.parse(await evaluate(`JSON.stringify({
    count: document.querySelectorAll('.settings-result-item').length,
    text: document.querySelector('.settings-nav-empty')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  })`));
  assert.equal(empty.count, 0, "不存在的关键字不应有结果");
  assert.ok(empty.text.includes("试试"), `空结果要给出可试的关键字：${empty.text}`);

  // Esc：先清搜索，再关窗口
  await pressKey("Escape");
  assert.equal(await evaluate("document.querySelector('.settings-search input').value"), "", "Esc 先清空搜索");
  assert.ok(await evaluate("Boolean(document.querySelector('.settings-modal'))"), "第一次 Esc 不应该关掉窗口");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await wait(420);
  assert.equal(await evaluate("Boolean(document.querySelector('.settings-modal'))"), false, "第二次 Esc 关闭设置");
  await evaluate("window.__piDesktop.settings.open(); true");
  await wait(320);

  // ---- 底部：改动计数 + 恢复默认的可用状态 ----
  const footerState = async () =>
    JSON.parse(await evaluate(`JSON.stringify({
      hint: document.querySelector('.settings-footer-hint')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      disabled: document.querySelector('.settings-footer .btn.ghost')?.disabled ?? null,
    })`));
  const beforeChange = await footerState();
  assert.equal(
    beforeChange.disabled,
    !beforeChange.hint.includes("已改动"),
    `「恢复默认」的可用状态要和改动计数一致：${beforeChange.hint} / disabled=${beforeChange.disabled}`,
  );
  await evaluate("window.__piDesktop.settings.settings.uiFontSize = 15; true");
  await wait(280);
  const changed = await footerState();
  assert.ok(changed.hint.includes("已改动"), `改过设置后底部要显示改动数：${changed.hint}`);
  assert.equal(changed.disabled, false, "有改动时「恢复默认」要可点");
  await evaluate("document.querySelector('.settings-footer .btn.ghost').click(); true");
  await wait(320);
  const afterReset = await footerState();
  assert.ok(!afterReset.hint.includes("已改动"), `恢复默认后计数要消失：${afterReset.hint}`);
  assert.equal(afterReset.disabled, true, "恢复默认之后按钮要重新禁用");

  // ---- 换页后滚动位置要归零（否则会停在上一页滚到的地方）----
  await openTab("appearance");
  await wait(360);
  const scrolled = JSON.parse(await evaluate(`(() => {
    const body = document.querySelector('.settings-body');
    body.scrollTo({ top: 600, behavior: 'auto' });
    return JSON.stringify({ before: Math.round(body.scrollTop), max: Math.round(body.scrollHeight - body.clientHeight) });
  })()`));
  assert.ok(scrolled.max > 0 && scrolled.before > 0, `外观页应该足够长以便测试滚动：${JSON.stringify(scrolled)}`);
  await evaluate(`document.querySelector('[data-settings-section="desktop"]').click(); true`);
  await wait(420);
  assert.equal(await evaluate("Math.round(document.querySelector('.settings-body').scrollTop)"), 0, "换分区后滚动位置要归零");

  // 回到默认分区，后面的断言按原顺序继续
  await evaluate(`document.querySelector('[data-settings-section="chat"]').click(); true`);
  await wait(220);

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
  // 自动更新默认开启：环境页两个开关都在、都开着，且手动「检查更新」会自动下载
  await openTab("environment");
  await wait(400);
  const updateRows = JSON.parse(await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.settings-row')].map((row) => ({
      label: row.querySelector('.settings-row-info strong')?.textContent.trim() ?? '',
      hint: row.querySelector('.settings-row-info > span')?.textContent.trim() ?? '',
      on: row.querySelector('input.settings-switch')?.checked ?? null,
    }));
    return JSON.stringify(rows.filter((row) => row.on !== null));
  })()`));
  const autoRow = updateRows.find((row) => row.label === "自动下载更新");
  const checkRow = updateRows.find((row) => row.label === "启动时检查更新");
  assert.ok(autoRow, "设置页要有「自动下载更新」开关");
  assert.equal(autoRow.on, true, "自动下载更新必须默认开启");
  assert.ok(checkRow, "设置页要有「启动时检查更新」开关");
  assert.equal(checkRow.on, true, "启动时检查更新必须默认开启");

  // 手动检查也要触发下载：换掉 workbench 的检查和下载（宿主对象被 contextBridge 冻结，
  // 改 window.piDesktop 上的方法不会生效），看调用链有没有连上
  const wired = JSON.parse(await evaluate(`(async () => {
    const workbench = window.__piDesktop.workbench;
    const original = { check: workbench.checkAppUpdate, download: workbench.downloadAppUpdate };
    const calls = [];
    workbench.checkAppUpdate = async () => {
      calls.push("check");
      Object.assign(workbench.state.appUpdate, {
        current: "0.3.2",
        latest: "0.4.0",
        updateAvailable: true,
        url: "https://example.com/pi-desktop",
        assetName: "Pi-Desktop-0.4.0.exe",
        phase: "available",
        error: "",
      });
      return { current: "0.3.2", latest: "0.4.0", updateAvailable: true, url: "https://example.com/pi-desktop" };
    };
    workbench.downloadAppUpdate = async () => {
      calls.push("download");
      workbench.state.appUpdate.phase = "ready";
      return { version: "0.4.0", assetName: "Pi-Desktop-0.4.0.exe", url: "https://example.com/pi-desktop" };
    };
    // 必须点「检查软件更新」那一行的按钮：同页 Pi CLI 也有个「检查更新」
    const checkRow = [...document.querySelectorAll('.settings-row')]
      .find((row) => row.querySelector('.settings-row-info strong')?.textContent.trim() === "检查软件更新");
    const checkButton = checkRow && [...checkRow.querySelectorAll('button')].find((b) => b.textContent.trim() === "检查更新");
    if (!checkButton) return JSON.stringify({ error: "找不到检查更新按钮" });
    checkButton.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !calls.includes("download")) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400));
    const installButton = [...document.querySelectorAll('button')].some((b) => b.textContent.includes("安装并重启"));
    // 复位：别把假状态留在界面上
    Object.assign(workbench.state.appUpdate, { phase: "idle", updateAvailable: false, latest: "", url: "", current: "" });
    workbench.checkAppUpdate = original.check;
    workbench.downloadAppUpdate = original.download;
    await new Promise((r) => setTimeout(r, 300));
    return JSON.stringify({ calls, installButton: Boolean(installButton) });
  })()`));
  assert.deepEqual(wired.calls, ["check", "download"], `手动检查更新后要自动下载，实际调用 ${JSON.stringify(wired.calls)}`);
  assert.equal(wired.installButton, true, "下载完成后要出现「安装并重启」，安装仍需手动确认");

  // 开关能持久化
  const persisted = JSON.parse(await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.settings-row')]
      .find((item) => item.querySelector('.settings-row-info strong')?.textContent.trim() === "自动下载更新");
    const input = row.querySelector('input.settings-switch');
    input.click();
    await new Promise((r) => setTimeout(r, 250));
    const off = JSON.parse(localStorage.getItem("pi-desktop.settings") || "{}").appUpdateAuto;
    input.click();
    await new Promise((r) => setTimeout(r, 250));
    const back = JSON.parse(localStorage.getItem("pi-desktop.settings") || "{}").appUpdateAuto;
    return JSON.stringify({ off, back });
  })()`));
  assert.equal(persisted.off, false, "关掉自动下载要写进 localStorage");
  assert.equal(persisted.back, true, "重新打开要写回 true");

  await openTab("appearance");
  await wait(300);
  console.log("[settings] shot", await shot("settings-dark.png"));
  await openTab("agents");
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

  console.log("[settings] PASS 四个一级分区 / 二级 tab / 图标 / 全页面无溢出 / 搜索 / 精简底部");
}
