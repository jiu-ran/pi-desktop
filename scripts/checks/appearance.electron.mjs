import assert from "node:assert/strict";

/**
 * 外观设置回归：主题模式 / 强调色 / 圆角 / 对话列宽 / 动效。
 *
 * 每项都要落到 `<html>` 上（CSS 变量或 data 属性），并且能持久化到 localStorage；
 * 「恢复默认外观」只还原外观项，不能顺手把终端、Agent 设置一起清掉。
 */
export async function checkAppearanceInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const snapshot = () =>
    evaluate(`(() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const settings = JSON.parse(localStorage.getItem("pi-desktop.settings") || "{}");
      return JSON.stringify({
        accent: style.getPropertyValue("--accent").trim(),
        accentSoft: style.getPropertyValue("--accent-soft").trim(),
        radius: style.getPropertyValue("--radius").trim(),
        radiusSm: style.getPropertyValue("--radius-sm").trim(),
        column: style.getPropertyValue("--chat-column").trim(),
        theme: root.dataset.theme,
        motion: root.dataset.motion,
        accentId: root.dataset.accent,
        radiusId: root.dataset.radius,
        columnId: root.dataset.column,
        stored: {
          themeMode: settings.themeMode,
          accent: settings.accent,
          radius: settings.radius,
          columnWidth: settings.columnWidth,
          reduceMotion: settings.reduceMotion,
        },
      });
    })()`);

  const clickSwatch = (label) =>
    evaluate(`(() => {
      const node = [...document.querySelectorAll(".settings-swatch")].find((item) => item.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!node) return false;
      node.click();
      return true;
    })()`);

  const clickSegment = (text) =>
    evaluate(`(() => {
      const nodes = [...document.querySelectorAll(".settings-segment")];
      const node = nodes.find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!node) return false;
      node.click();
      return true;
    })()`);

  await evaluate(`window.__piDesktop.settings.open("appearance"); true`);
  await wait(500);

  // 控件齐不齐：三张主题卡、七个强调色、分段选择若干、预览块
  const controls = JSON.parse(
    await evaluate(`(() => JSON.stringify({
      tiles: [...document.querySelectorAll(".settings-theme-tile")].map((n) => n.textContent.trim()),
      swatches: document.querySelectorAll(".settings-swatch").length,
      segments: document.querySelectorAll(".settings-segment").length,
      preview: Boolean(document.querySelector(".settings-preview")),
      reset: [...document.querySelectorAll(".settings-group-head .btn")].some((n) => n.textContent.includes("恢复默认外观")),
    }))()`),
  );
  assert.deepEqual(controls.tiles, ["跟随系统", "深色", "浅色"], `主题卡不对：${controls.tiles.join("/")}`);
  assert.equal(controls.swatches, 7, `强调色应有 7 个预设，实际 ${controls.swatches}`);
  assert.ok(controls.segments >= 15, `分段选项太少：${controls.segments}`);
  assert.ok(controls.preview, "外观页应有实时预览块");
  assert.ok(controls.reset, "外观页应有「恢复默认外观」");

  // 先把外观恢复成默认，避免上一次运行留下的 localStorage 影响基线
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-group-head .btn")].find((n) => n.textContent.includes("恢复默认外观")).click();
    return true;
  })()`);
  await wait(300);

  // 强调色：紫罗兰
  const before = JSON.parse(await snapshot());
  assert.equal(before.stored.accent, "default", "基线应是默认强调色（先恢复过一次）");
  assert.ok(await clickSwatch("紫罗兰"), "找不到紫罗兰色板");
  await wait(250);
  const violet = JSON.parse(await snapshot());
  assert.notEqual(violet.accent, before.accent, "切强调色后 --accent 应变化");
  assert.equal(violet.accent.toLowerCase(), "#8b5cf6", `--accent 应为紫罗兰色，实际 ${violet.accent}`);
  assert.match(violet.accentSoft, /^rgba\(139, 92, 246/, `--accent-soft 应跟着变，实际 ${violet.accentSoft}`);
  assert.equal(violet.accentId, "violet", "data-accent 应同步");
  assert.equal(violet.stored.accent, "violet", "强调色应持久化");

  // 圆角：圆润 → 12px / 9px
  assert.ok(await clickSegment("圆润"), "找不到「圆润」分段");
  await wait(200);
  const round = JSON.parse(await snapshot());
  assert.equal(round.radius, "12px", `--radius 应为 12px，实际 ${round.radius}`);
  assert.equal(round.radiusSm, "9px", `--radius-sm 应为 9px，实际 ${round.radiusSm}`);
  assert.equal(round.radiusId, "round");

  // 列宽：铺满 → --chat-column 100%
  assert.ok(await clickSegment("铺满"), "找不到「铺满」分段");
  await wait(200);
  const full = JSON.parse(await snapshot());
  assert.equal(full.column, "100%", `--chat-column 应为 100%，实际 ${full.column}`);
  assert.ok(full.stored.columnWidth === "full", "列宽应持久化");

  // 动效：关掉 → data-motion=off，且过渡时长归零
  await evaluate(`(() => {
    const box = [...document.querySelectorAll(".settings-row.clickable")].find((row) => row.textContent.includes("关闭界面动效"));
    box.querySelector("input.settings-switch").click();
    return true;
  })()`);
  await wait(250);
  const still = JSON.parse(await snapshot());
  assert.equal(still.motion, "off", "关闭动效后 data-motion 应为 off");
  assert.ok(still.stored.reduceMotion === true, "动效开关应持久化");
  const transition = await evaluate(`(() => {
    const node = document.querySelector(".settings-group");
    return getComputedStyle(node).transitionDuration;
  })()`);
  // 浏览器把 0.001ms 报成 1e-06s
  const duration = Number.parseFloat(String(transition)) || 0;
  assert.ok(duration <= 0.001, `关闭动效后过渡时长应接近 0，实际 ${transition}`);

  // 主题模式：切浅色，根节点配色要跟着变
  const lightTile = await evaluate(`(() => {
    const node = [...document.querySelectorAll(".settings-theme-tile")].find((n) => n.textContent.trim() === "浅色");
    node.click();
    return true;
  })()`);
  assert.ok(lightTile, "找不到「浅色」主题卡");
  await wait(350);
  const light = JSON.parse(await snapshot());
  assert.equal(light.theme, "light", `切浅色后 data-theme 应为 light，实际 ${light.theme}`);
  assert.equal(light.stored.themeMode, "light", "主题模式应持久化");

  // 跟随系统：模拟系统深色/浅色偏好，界面配色要跟着切（不需要重启）
  const follow = async (value) => {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value }],
    });
    // 跟随系统有 1.5s 兜底轮询（部分环境下 change 事件不触发），这里等它一轮
    await wait(2200);
    return JSON.parse(await snapshot());
  };
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-theme-tile")].find((n) => n.textContent.trim() === "跟随系统").click();
    return true;
  })()`);
  await wait(300);
  const sysDark = await follow("dark");
  assert.equal(sysDark.theme, "dark", `跟随系统 + 系统深色 → data-theme 应为 dark，实际 ${sysDark.theme}`);
  const sysLight = await follow("light");
  assert.equal(sysLight.theme, "light", `跟随系统 + 系统浅色 → data-theme 应为 light，实际 ${sysLight.theme}`);
  await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});

  // 恢复默认外观：外观项回到默认，其它设置不能被清掉
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.settings-group-head .btn')];
    rows.find((n) => n.textContent.includes("恢复默认外观")).click();
    return true;
  })()`);
  await wait(300);
  const reset = JSON.parse(await snapshot());
  assert.equal(reset.stored.themeMode, "dark", "恢复默认后主题模式应回深色（默认不是跟随系统）");
  assert.equal(reset.stored.accent, "default", "恢复默认后强调色应回默认蓝");
  assert.equal(reset.stored.radius, "default");
  assert.equal(reset.stored.columnWidth, "default");
  assert.equal(reset.stored.reduceMotion, false);
  assert.equal(reset.accent.toLowerCase(), "#2a7deb", "恢复默认后 --accent 应回默认蓝");
  assert.equal(reset.radius, "8px", "恢复默认后 --radius 应回 8px");
  const keptOthers = await evaluate(`(() => {
    const settings = JSON.parse(localStorage.getItem("pi-desktop.settings") || "{}");
    return JSON.stringify({ send: settings.sendShortcut, save: settings.autoSave, term: settings.terminalProfile });
  })()`);
  const others = JSON.parse(keptOthers);
  assert.ok(others.send && others.save && others.term !== undefined, "恢复默认外观不应清掉其它设置");

  // 对话里的「强调」（行内代码）必须用用户选的强调色，而不是固定橙色
  const inlineCode = JSON.parse(await evaluate(`(async () => {
    const api = window.__piDesktop;
    const tick = String.fromCharCode(96);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    api.settings.close();
    await wait(400);
    const thread = api.workbench.active.value.activeThread;
    thread.transcript.blocks.splice(0);
    thread.transcript.blocks.push({ kind: "text", id: "accent-probe", text: "这一句里有 " + tick + "强调" + tick + " 行内代码", status: "done" });
    await wait(600);
    const read = () => {
      const code = document.querySelector(".md-body code");
      return code ? getComputedStyle(code).color : "";
    };
    const readAccent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    api.settings.settings.accent = "default";
    await wait(450);
    const withDefault = read();
    const defaultAccent = readAccent();
    api.settings.settings.accent = "violet";
    await wait(450);
    const withViolet = read();
    const violetAccent = readAccent();
    api.settings.settings.accent = "default";
    await wait(300);
    thread.transcript.blocks.splice(0);
    return JSON.stringify({ withDefault, defaultAccent, withViolet, violetAccent });
  })()`));
  const rgbOf = (hex) => {
    const value = Number.parseInt(String(hex).replace("#", ""), 16);
    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
  };
  assert.equal(inlineCode.withDefault, rgbOf(inlineCode.defaultAccent), `行内代码应跟随默认强调色：${inlineCode.withDefault} vs ${rgbOf(inlineCode.defaultAccent)}`);
  assert.equal(inlineCode.withViolet, rgbOf(inlineCode.violetAccent), `换成紫罗兰后行内代码要跟着变：${inlineCode.withViolet} vs ${rgbOf(inlineCode.violetAccent)}`);

  // 原生窗口按钮区（右上角最小化/最大化/关闭）盖不到弹窗遮罩，必须跟着压暗，
  // 否则一开弹窗右上角就剩一条亮块。颜色由渲染进程算，这里验证状态切换。
  const chrome = JSON.parse(await evaluate(`(async () => {
    const api = window.__piDesktop;
    const frame = getComputedStyle(document.documentElement).getPropertyValue("--frame").trim();
    api.settings.close();
    await new Promise((r) => setTimeout(r, 600));
    const closed = document.documentElement.dataset.winChrome ?? "";
    api.settings.open("appearance");
    await new Promise((r) => setTimeout(r, 700));
    const opened = document.documentElement.dataset.winChrome ?? "";
    const scrim = Boolean(document.querySelector(".settings-modal-position"));
    api.settings.close();
    await new Promise((r) => setTimeout(r, 700));
    const reopened = document.documentElement.dataset.winChrome ?? "";
    return JSON.stringify({ frame, closed, opened, reopened, scrim });
  })()`));
  assert.equal(chrome.scrim, true, "设置弹窗应处于打开状态才能验证遮罩");
  assert.equal(chrome.closed, "plain", `没有弹窗时原生按钮区保持原色，实际 ${chrome.closed}`);
  assert.equal(chrome.opened, "scrim", `打开弹窗后原生按钮区要跟着压暗，实际 ${chrome.opened}`);
  assert.equal(chrome.reopened, "plain", `关闭弹窗后要恢复原色，实际 ${chrome.reopened}`);

  console.log("[appearance]", JSON.stringify({ controls: { swatches: controls.swatches, segments: controls.segments }, violet: violet.accent, radius: round.radius, column: full.column, motion: still.motion, chrome: chrome.opened }));
  return { controls, violet, round, full, still };
}
