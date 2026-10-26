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
  const SECTION_OF = { conversation: "chat", agents: "chat", skills: "power", mcp: "power", packages: "power", plugins: "power", appearance: "look", "pi-cli": "pi-cli-section", "pi-desktop": "pi-desktop-section", terminal: "desktop", environment: "desktop", logs: "desktop" };
  const TAB_LABEL = {
    conversation: "对话与并发",
    appearance: "外观与布局",
    terminal: "终端",
    mcp: "MCP 服务配置",
    packages: "Pi 软件包管理",
    agents: "全局提示词",
    skills: "Skills",
    plugins: "插件",
    environment: "环境与快捷键",
    logs: "运行日志",
    "pi-cli": "Pi CLI",
    "pi-desktop": "Pi Desktop",
  };
  /**
   * 切到某一页并**确认真的到了**：只点一次然后 sleep 会让后面的断言读到上一页，
   * 表现出来就是「明明没改过的东西突然报错」，很难查。
   */
  const openTab = async (id) => {
    await evaluate(`document.querySelector('[data-settings-section="${SECTION_OF[id]}"]')?.click() ?? null; true`);
    await wait(160);
    await evaluate(`document.querySelector('[data-settings-tab="${id}"]')?.click() ?? null; true`);
    const expected = TAB_LABEL[id];
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const title = await evaluate("document.querySelector('.settings-title')?.textContent?.trim() ?? ''");
      if (title === expected) return;
      await wait(120);
    }
    throw new Error(`切页失败：期望「${expected}」，实际停在「${await evaluate("document.querySelector('.settings-title')?.textContent?.trim() ?? ''")}」`);
  };

  // 上次退出时停在哪一页是持久的，先归位到「对话」再读导航
  await evaluate(`document.querySelector('[data-settings-section="chat"]')?.click() ?? null; true`);
  await wait(250);

  // 导航：6 个一级分区（左栏）+ 二级 tab（内容区顶部）
  const nav = JSON.parse(await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.settings-nav-item')].map((n) => ({
      label: n.querySelector('.settings-nav-label')?.textContent.trim() ?? '',
      section: n.getAttribute('data-settings-section') ?? '',
      icon: Boolean(n.querySelector('.settings-nav-icon svg')),
      count: n.querySelector('.settings-nav-count')?.textContent.trim() ?? '',
      active: n.classList.contains('active'),
      current: n.getAttribute('aria-current') ?? '',
      title: n.getAttribute('title') ?? '',
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
    ["对话", "扩展", "外观", "Pi CLI", "Pi Desktop", "系统"],
    `左栏只留四个一级分区，实际 ${nav.sections.map((item) => item.label).join("/")}`,
  );
  assert.ok(nav.sections.every((item) => item.icon), "每个分区都要有图标");
  assert.equal(nav.sections.filter((item) => item.active).length, 1, "只应有一个分区高亮");
  assert.equal(nav.sections.filter((item) => item.current === "page").length, 1, "高亮的分区要带 aria-current=page");
  assert.ok(nav.sections.every((item) => item.title.length > 4), `分区项要有 title（悬停能看到说明），实际：${JSON.stringify(nav.sections.map((item) => item.title))}`);
  assert.equal(nav.sections.map((item) => item.count).join(""), "241113", "分区右侧标出二级 tab 数量");
  assert.ok(nav.subtabs.length >= 2, "对话分区下应有二级 tab");
  // Pi CLI / Pi Desktop 是平级的一级分区，且只有一页 —— 所以没有二级 tab
  const piSections = nav.sections.filter((item) => ["Pi CLI", "Pi Desktop"].includes(item.label));
  assert.equal(piSections.length, 2, "Pi CLI 与 Pi Desktop 要各自出现在一级分区");
  assert.ok(piSections.every((item) => item.count === "1"), "两个 Pi 分区各只有 1 页");
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
    ["agents", "conversation", "environment", "logs", "mcp", "packages", "plugins", "section:look", "section:pi-cli-section", "section:pi-desktop-section", "skills", "terminal"],
    `六个分区要覆盖全部 12 个设置页，实际 ${visited.join("/")}`,
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

  // Pi CLI 与 Pi Desktop 升为一级分区后：各自一页，内容不重叠
  const readGroups = async () =>
    JSON.parse(await evaluate(`(() => {
      const groups = [...document.querySelectorAll('.settings-body .settings-group')].map((group) => ({
        title: group.querySelector('.settings-group-title')?.textContent.trim() ?? '',
        rows: [...group.querySelectorAll('.settings-row strong')].map((n) => n.textContent.trim()),
      }));
      return JSON.stringify({ titles: groups.map((g) => g.title), rows: groups.flatMap((g) => g.rows) });
    })()`));

  await openTab("pi-cli");
  await wait(400);
  const piCli = await readGroups();
  assert.ok(piCli.titles.includes("本机 Pi CLI"), `Pi CLI 页要有「本机 Pi CLI」分组：${piCli.titles.join("/")}`);
  for (const label of ["Pi Coding Agent CLI", "Pi 路径", "检查并更新 Pi", "Pi 自动更新"]) {
    assert.ok(piCli.rows.includes(label), `Pi CLI 页应包含「${label}」，实际：${piCli.rows.join("/")}`);
  }
  assert.ok(!piCli.rows.includes("当前活动项目目录"), "项目目录属于「环境与快捷键」，不该混进 Pi CLI 页");

  // 自绘下拉：设置页里不能再出现原生 <select>（系统弹出层是浅色系统菜单，和主题割裂）
  assert.equal(await evaluate("document.querySelectorAll('.settings-body select').length"), 0, "设置页不该再用原生 select");
  const dropdown = JSON.parse(await evaluate(`(async () => {
    const trigger = [...document.querySelectorAll('.select-menu-trigger')].find((node) => node.textContent.includes('pi update'));
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const popup = document.querySelector('.select-menu-popup');
    const rect = popup?.getBoundingClientRect();
    const styles = popup ? getComputedStyle(popup) : null;
    return JSON.stringify({
      triggerExpanded: trigger.getAttribute("aria-expanded"),
      open: Boolean(popup),
      parent: popup?.parentElement?.tagName ?? "",
      bg: styles?.backgroundColor ?? "",
      radius: styles?.borderRadius ?? "",
      inViewport: rect ? rect.left >= 0 && rect.bottom <= innerHeight && rect.top >= 0 : false,
      items: [...(popup?.querySelectorAll('.select-menu-item') ?? [])].map((node) => ({
        label: node.querySelector('.select-menu-item-label')?.textContent?.trim() ?? '',
        hint: node.querySelector('.select-menu-item-hint')?.textContent?.trim() ?? '',
        active: node.classList.contains('active'),
        selected: node.getAttribute('aria-selected'),
      })),
    });
  })()`));
  assert.equal(dropdown.triggerExpanded, "true", "点开后触发器要带 aria-expanded");
  assert.equal(dropdown.open, true, "点触发器要弹出下拉");
  assert.equal(dropdown.parent, "BODY", "下拉浮层要传送到 body（不被滚动容器裁掉）");
  assert.notEqual(dropdown.bg, "rgba(0, 0, 0, 0)", `下拉浮层要自己有主题底色，实际 ${dropdown.bg}`);
  assert.notEqual(dropdown.radius, "0px", "下拉浮层要有圆角（说明走的是设置页样式而不是系统菜单）");
  assert.ok(dropdown.inViewport, "下拉必须落在视口内");
  assert.deepEqual(dropdown.items.map((item) => item.label), ["pi update", "update --all"], `下拉选项不对：${JSON.stringify(dropdown.items)}`);
  assert.equal(dropdown.items.filter((item) => item.active).length, 1, "当前值只能有一项高亮");
  assert.equal(dropdown.items[0].selected, "true", "当前值要带 aria-selected");
  assert.ok(dropdown.items[0].hint.length > 0, "选项要带补充说明");

  // 选第二项：值要真的写进设置，浮层要收起
  const picked = JSON.parse(await evaluate(`(async () => {
    const items = [...document.querySelectorAll('.select-menu-item')];
    items[1].click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return JSON.stringify({
      value: window.__piDesktop.settings.settings.piUpdateScope,
      text: [...document.querySelectorAll('.select-menu-trigger')].find((node) => node.textContent.includes('update'))?.textContent?.trim() ?? '',
      closed: !document.querySelector('.select-menu-popup'),
    });
  })()`));
  assert.equal(picked.value, "all", `选「update --all」后设置要变成 all，实际 ${picked.value}`);
  assert.ok(picked.text.includes("update --all"), `触发器要显示新值，实际 ${picked.text}`);
  assert.equal(picked.closed, true, "选完要收起浮层");
  await evaluate("window.__piDesktop.settings.settings.piUpdateScope = 'self'; true");

  await openTab("pi-desktop");
  await wait(400);
  const piDesktop = await readGroups();
  assert.ok(piDesktop.titles.some((title) => title.includes("Pi Desktop 更新")), `Pi Desktop 页要有更新分组：${piDesktop.titles.join("/")}`);
  for (const label of ["软件版本", "检查软件更新", "启动时检查更新", "自动下载更新"]) {
    assert.ok(piDesktop.rows.includes(label), `Pi Desktop 页应包含「${label}」，实际：${piDesktop.rows.join("/")}`);
  }
  assert.ok(!piDesktop.rows.includes("检查并更新 Pi"), "Pi 命令行工具的更新不该和桌面应用混在一页");

  await openTab("environment");
  await wait(400);
  const env = await readGroups();
  assert.ok(env.titles.includes("当前工作区"), `环境页要保留工作区分组：${env.titles.join("/")}`);
  assert.ok(env.titles.includes("全局快捷键速查"), `环境页要保留快捷键速查：${env.titles.join("/")}`);
  assert.ok(!env.rows.includes("检查并更新 Pi"), "Pi CLI 已独立成页，环境页不该再有它");
  assert.ok(!env.rows.includes("启动时检查更新"), "Pi Desktop 更新已独立成页，环境页不该再有它");
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
  assert.equal(hitHint, "系统", `搜索命中要标出所属分区，实际「${hitHint}」`);

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
    6,
    "清空搜索后左栏应恢复成六个分区（对话 / 能力 / 外观 / Pi CLI / Pi Desktop / 桌面）",
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

  // ---- 细节：页头滚动态阴影 + 二级 tab 方向键 ----
  await openTab("appearance");
  await wait(320);
  assert.equal(
    await evaluate("document.querySelector('.settings-head')?.classList.contains('scrolled') ?? null"),
    false,
    "没滚动时页头不应有滚动态",
  );
  await evaluate(`(() => {
    const body = document.querySelector('.settings-body');
    body.scrollTo({ top: 260, behavior: 'auto' });
    body.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await wait(200);
  assert.equal(
    await evaluate("document.querySelector('.settings-head')?.classList.contains('scrolled') ?? null"),
    true,
    "内容滚动后页头要进入滚动态（补阴影，避免和内容糊在一起）",
  );
  // 换分区同样算「换页」，滚动状态要跟着复位
  await evaluate(`document.querySelector('[data-settings-section="desktop"]')?.click() ?? null; true`);
  await wait(320);
  assert.equal(
    await evaluate("document.querySelector('.settings-head')?.classList.contains('scrolled') ?? null"),
    false,
    "换页后滚动状态要复位",
  );

  await openTab("terminal");
  const tabRole = await evaluate("document.querySelector('.settings-subtabs')?.getAttribute('role') ?? ''");
  assert.equal(tabRole, "tablist", "二级 tab 条要有 role=tablist");
  const beforeKey = await evaluate("document.querySelector('.settings-subtab.active')?.getAttribute('data-settings-tab') ?? ''");
  await evaluate(`(() => {
    const first = document.querySelector('.settings-subtab');
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return true;
  })()`);
  await wait(240);
  const afterKey = await evaluate("document.querySelector('.settings-subtab.active')?.getAttribute('data-settings-tab') ?? ''");
  assert.notEqual(afterKey, beforeKey, `←/→ 要能切换二级 tab（${beforeKey} → ${afterKey}）`);
  assert.equal(
    await evaluate("document.querySelector('.settings-subtab.active')?.getAttribute('aria-selected') ?? ''"),
    "true",
    "当前 tab 要带 aria-selected",
  );

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
  // 自动更新默认开启：Pi Desktop 页两个开关都在、都开着，且手动「检查更新」会自动下载
  await openTab("pi-desktop");
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

  console.log("[settings] PASS 6 个一级分区（含 Pi CLI / Pi Desktop）/ 12 个页面 / 二级 tab 方向键 / 页头滚动态 / 搜索关键字 / 改动计数");
}
