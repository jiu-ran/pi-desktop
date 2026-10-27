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
        emphasis: style.getPropertyValue("--emphasis").trim(),
        emphasisId: root.dataset.emphasis,
        accentCustom: root.dataset.accent === "custom" ? style.getPropertyValue("--accent").trim() : "",
        emphasisCustom: root.dataset.emphasis === "custom" ? style.getPropertyValue("--emphasis").trim() : "",
        inlineCode: (() => {
          const node = document.querySelector(".settings-preview-emphasis");
          return node ? getComputedStyle(node).color : "";
        })(),
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
          accentCustom: settings.accentCustom,
          emphasis: settings.emphasis,
          emphasisCustom: settings.emphasisCustom,
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
      swatches: document.querySelectorAll(".settings-swatches .settings-swatch").length,
      emphasisSwatches: document.querySelectorAll(".settings-emphasis-row .settings-swatch").length,
      segments: document.querySelectorAll(".settings-segment").length,
      preview: Boolean(document.querySelector(".settings-preview")),
      reset: [...document.querySelectorAll(".settings-group-head .btn")].some((n) => n.textContent.includes("恢复默认外观")),
    }))()`),
  );
  assert.deepEqual(controls.tiles, ["跟随系统", "深色", "浅色"], `主题卡不对：${controls.tiles.join("/")}`);
  assert.equal(controls.swatches, 8, `强调色应是 7 个预设 + 1 个自定义，实际 ${controls.swatches}`);
  assert.ok(controls.segments >= 15, `分段选项太少：${controls.segments}`);
  assert.ok(controls.preview, "外观页应有实时预览块");
  assert.ok(controls.reset, "外观页应有「恢复默认外观」");

  // 缩略图必须「选什么颜色就是什么颜色」：深色黑底、浅色白底、跟随系统左右各一半
  const art = JSON.parse(
    await evaluate(`(() => JSON.stringify([...document.querySelectorAll(".settings-theme-art")].map((node) => ({
      scheme: node.dataset.scheme ?? "",
      halves: [...node.querySelectorAll(".settings-theme-half")].map((half) => {
        const style = getComputedStyle(half);
        return { bg: style.backgroundColor, ink: getComputedStyle(half.querySelector(".settings-theme-art-line")).backgroundColor };
      }),
    }))))()`),
  );
  const artOf = (scheme) => art.find((item) => item.scheme === scheme);
  assert.deepEqual(art.map((item) => item.scheme), ["system", "dark", "light"], `缩略图顺序应与主题卡一致：${art.map((item) => item.scheme).join("/")}`);
  assert.equal(artOf("dark")?.halves.length, 1, "深色缩略图是整块黑底");
  assert.equal(artOf("dark")?.halves[0]?.bg, "rgb(0, 0, 0)", `深色缩略图必须是纯黑底，实际 ${artOf("dark")?.halves[0]?.bg}`);
  assert.equal(artOf("light")?.halves.length, 1, "浅色缩略图是整块白底");
  assert.equal(artOf("light")?.halves[0]?.bg, "rgb(255, 255, 255)", `浅色缩略图必须是纯白底，实际 ${artOf("light")?.halves[0]?.bg}`);
  assert.equal(artOf("system")?.halves.length, 2, "跟随系统要画成左右两半");
  assert.equal(artOf("system")?.halves[0]?.bg, "rgb(0, 0, 0)", "跟随系统左半是黑");
  assert.equal(artOf("system")?.halves[1]?.bg, "rgb(255, 255, 255)", "跟随系统右半是白");
  // 线条要在两半上都看得见：黑底用浅线、白底用深线
  const darkInk = artOf("dark")?.halves[0]?.ink ?? "";
  const lightInk = artOf("light")?.halves[0]?.ink ?? "";
  assert.ok(darkInk.startsWith("rgba(255, 255, 255"), `黑底上的线条要是浅色：${darkInk}`);
  assert.ok(lightInk.startsWith("rgba(0, 0, 0"), `白底上的线条要是深色：${lightInk}`);

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

  // 自定义强调色：任意颜色都能用（不是只有几个预设）
  const customAccent = JSON.parse(await evaluate(`(() => {
    const settings = JSON.parse(localStorage.getItem("pi-desktop.settings") || "{}");
    return JSON.stringify({ customBefore: settings.accentCustom ?? null });
  })()`));
  assert.ok(customAccent.customBefore, "设置里应有 accentCustom 字段");
  await evaluate(`(() => {
    const input = document.querySelector('.settings-swatch-custom input[type="color"]');
    if (!input) return false;
    input.value = "#12ab34";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.click();
    return true;
  })()`);
  await wait(350);
  const custom = JSON.parse(await snapshot());
  assert.equal(custom.accent.toLowerCase(), "#12ab34", `自定义强调色应直接生效，实际 ${custom.accent}`);
  assert.equal(custom.accentId, "custom", "data-accent 要标成 custom");
  assert.equal(custom.stored.accentCustom, "#12ab34", "自定义颜色要落盘");
  assert.match(custom.accentSoft, /^rgba\(18, 171, 52/, `自定义色也要推淡底，实际 ${custom.accentSoft}`);

  // 对话强调色：默认跟随强调色
  assert.equal(violet.emphasis.toLowerCase(), "#8b5cf6", `默认情况下对话强调色跟随强调色，实际 ${violet.emphasis}`);
  assert.equal(violet.emphasisId, "follow", "data-emphasis 默认是 follow");
  assert.equal(violet.emphasisCustom, "", "跟随模式下不该用单独的颜色");

  // 单独设置对话强调色：界面强调色不动，只有对话文字变
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-segment")].find((n) => n.textContent.trim() === "单独设置")?.click();
    return true;
  })()`);
  await wait(350);
  assert.ok(await evaluate(`Boolean(document.querySelector('.settings-emphasis-row input[type="color"]'))`), "选「单独设置」后要出现取色器");
  await evaluate(`(() => {
    const input = document.querySelector('.settings-emphasis-row input[type="color"]');
    input.value = "#ff8800";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(350);
  const split = JSON.parse(await snapshot());
  assert.equal(split.accent.toLowerCase(), "#12ab34", "对话强调色不该影响界面强调色");
  assert.equal(split.emphasis.toLowerCase(), "#ff8800", `对话强调色应独立生效，实际 ${split.emphasis}`);
  assert.equal(split.emphasisId, "custom", "data-emphasis 要标成 custom");
  assert.equal(split.stored.emphasis, "custom", "独立设置要落盘");
  assert.equal(split.stored.emphasisCustom, "#ff8800", "独立颜色要落盘");
  assert.equal(split.inlineCode, "rgb(255, 136, 0)", `预览里的对话强调文字要用独立颜色，实际 ${split.inlineCode}`);

  // 截图留档：强调色预设 + 自定义取色、对话强调色独立设置、实时预览
  try {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const box = JSON.parse(await evaluate(`(() => {
      const rows = [...document.querySelectorAll(".settings-group")];
      const group = rows.find((node) => node.textContent.includes("强调色")) ?? document.querySelector(".settings-body");
      const preview = document.querySelector(".settings-preview");
      const r = group.getBoundingClientRect();
      const p = preview ? preview.getBoundingClientRect() : r;
      return JSON.stringify({
        x: Math.round(r.left) - 8,
        y: Math.round(r.top) - 8,
        width: Math.round(r.width) + 16,
        height: Math.round(Math.min(p.bottom - r.top, 1200)) + 16,
      });
    })()`));
    const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    const { writeFile } = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const { tmpdir } = await import("node:os");
    await writeFile(nodePath.join(tmpdir(), "appearance-emphasis.png"), Buffer.from(shot.data, "base64"));
    console.log("[appearance] shot appearance-emphasis.png");
  } catch (error) {
    console.log("[appearance] shot（跳过）", error?.message ?? error);
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
  }

  // 回到「跟随强调色」：又和界面强调色一致
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-segment")].find((n) => n.textContent.trim() === "跟随强调色")?.click();
    return true;
  })()`);
  await wait(300);
  const backToFollow = JSON.parse(await snapshot());
  assert.equal(backToFollow.emphasis.toLowerCase(), "#12ab34", `跟随模式应回到界面强调色，实际 ${backToFollow.emphasis}`);
  assert.equal(backToFollow.emphasisId, "follow", "data-emphasis 回到 follow");

  // 恢复默认外观：两个颜色一起回到预设
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-group-head .btn")].find((n) => n.textContent.includes("恢复默认外观")).click();
    return true;
  })()`);
  await wait(300);
  const afterReset = JSON.parse(await snapshot());
  assert.equal(afterReset.accentId, "default", "恢复默认后强调色回到默认");
  assert.equal(afterReset.emphasisId, "follow", "恢复默认后对话强调色回到跟随");
  await evaluate(`(() => {
    [...document.querySelectorAll(".settings-swatch")].find((n) => n.getAttribute("aria-label") === "紫罗兰")?.click();
    return true;
  })()`);
  await wait(250);

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

  // 原生窗口按钮区（右上角最小化/最大化/关闭）由系统绘制，压暗它永远慢一帧。
  // 现在的做法是「遮罩从标题栏下方开始」，标题栏与原生按钮区天然同色，
  // 这里验证这条前提：遮罩顶边 = 标题栏高度，且打开弹窗时标题栏像素不变。
  {
    const parse = (hex) => {
      const value = Number.parseInt(String(hex).replace("#", ""), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    };
    const sampleTitlebar = async () => {
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      const bitmap = image.getBitmap();
      const x = Math.round(size.width * 0.5);
      const y = Math.round(size.height * 0.018);
      const index = (y * size.width + x) * 4;
      return { pixel: [bitmap[index + 2], bitmap[index + 1], bitmap[index]], size };
    };

    const closed = JSON.parse(await evaluate(`(() => {
      const root = getComputedStyle(document.documentElement);
      const bar = document.querySelector(".titlebar");
      return JSON.stringify({
        frame: root.getPropertyValue("--frame").trim(),
        titlebarH: Math.round(bar?.getBoundingClientRect().height ?? 0),
      });
    })()`));
    const before = await sampleTitlebar();

    await evaluate("window.__piDesktop.settings.open('appearance'); true");
    await wait(700);
    const opened = JSON.parse(await evaluate(`(() => {
      const overlay = document.querySelector('.settings-overlay');
      const rect = overlay.getBoundingClientRect();
      return JSON.stringify({ top: Math.round(rect.top), active: Boolean(document.querySelector('.settings-modal')) });
    })()`));
    const after = await sampleTitlebar();

    const delta = parse(closed.frame).map((value, index) => Math.abs(value - before.pixel[index]));
    assert.ok(Math.max(...delta) <= 3, `标题栏像素应等于 --frame：${closed.frame} vs rgb(${before.pixel.join(",")})`);
    assert.equal(opened.active, true, "设置弹窗应已打开");
    assert.equal(
      opened.top,
      closed.titlebarH,
      `遮罩必须从标题栏下方开始（标题栏高 ${closed.titlebarH}px），实际 top=${opened.top}`,
    );
    const drift = after.pixel.map((value, index) => Math.abs(value - before.pixel[index]));
    assert.ok(
      Math.max(...drift) <= 2,
      `打开弹窗后标题栏不能被压暗（原生按钮区才不会深一块），实测 rgb(${before.pixel.join(",")}) → rgb(${after.pixel.join(",")})`,
    );
    console.log("[appearance] titlebar", JSON.stringify({ frame: closed.frame, titlebarH: closed.titlebarH, overlayTop: opened.top, pixel: after.pixel }));

  // 自绘窗口按钮：系统按钮（titleBarOverlay）悬停没有任何反馈，所以改成自己画。
  // 这里用 CDP 合成真实鼠标事件，断言「悬停 / 按下 / 关闭变红」都真的有视觉变化。
  {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach("1.3");
    const rects = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll(".wc-btn")].map((b) => {
      const rect = b.getBoundingClientRect();
      return {
        label: b.getAttribute("aria-label"),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }))`));
    assert.equal(rects.length, 3, `窗口按钮应有 3 个（最小化 / 最大化 / 关闭），实际 ${rects.length}`);
    // 中间那个随窗口状态变：最大化时是「向下还原」。窗口边界是持久化的，
    // 上一次跑完留在最大化状态就会把这条断言打成偶发失败。
    assert.equal(rects[0].label, "最小化", `第一个按钮是最小化，实际「${rects[0].label}」`);
    assert.ok(
      ["最大化", "向下还原"].includes(rects[1].label),
      `中间按钮应是最大化 / 向下还原，实际「${rects[1].label}」`,
    );
    assert.equal(rects[2].label, "关闭", `最后一个按钮是关闭，实际「${rects[2].label}」`);
    const inner = Number(await evaluate("window.innerWidth"));
    assert.equal(rects[2].right, inner, `关闭按钮要贴住窗口右缘（innerWidth=${inner}），实际 ${rects[2].right}`);
    for (const rect of rects) {
      assert.equal(rect.height, 40, `窗口按钮高度应铺满标题栏，实际 ${rect.height}`);
      assert.equal(rect.width, 46, `窗口按钮宽度应为 46px，实际 ${rect.width}`);
    }

    const styleOf = async (index) =>
      JSON.parse(await evaluate(`(() => {
        const style = getComputedStyle(document.querySelectorAll(".wc-btn")[${index}]);
        return JSON.stringify({ bg: style.backgroundColor, color: style.color });
      })()`));
    const move = async (x, y, buttons = 0, type = "mouseMoved") => {
      await dbg.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
      await wait(140);
    };

    const idle = await styleOf(0);
    for (const [index, rect] of rects.entries()) {
      await move(rect.x, rect.y);
      const hover = await styleOf(index);
      assert.notEqual(hover.bg, idle.bg, `「${rect.label}」悬停要有背景反馈，实际仍是 ${hover.bg}`);
      await move(rect.x, rect.y, 1, "mousePressed");
      const press = await styleOf(index);
      assert.notEqual(press.bg, hover.bg, `「${rect.label}」按下要比悬停更深，实际仍是 ${press.bg}`);
      // 松手要在按钮外，避免真的触发点击（关闭按钮会把应用关掉）
      await move(4, 4, 1);
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 4, button: "left", buttons: 0, clickCount: 1 });
      await wait(120);
    }

    await move(rects[2].x, rects[2].y);
    const closeHover = await styleOf(2);
    assert.ok(
      closeHover.bg.startsWith("rgb(196, 43, 28)"),
      `关闭按钮悬停要是系统报警红 rgb(196, 43, 28)，实际 ${closeHover.bg}`,
    );
    assert.equal(closeHover.color, "rgb(255, 255, 255)", "关闭按钮悬停时字形要变白");
    await move(4, 4);
    // 标题栏空白处双击要能最大化 / 还原：无边框窗口系统不再提供这个行为
    const doubleClickTitlebar = async () => {
      const spot = JSON.parse(await evaluate(`(() => {
        const rect = document.querySelector(".titlebar").getBoundingClientRect();
        return JSON.stringify({ x: Math.round(rect.width / 2), y: Math.round(rect.height / 2) });
      })()`));
      for (const clickCount of [1, 2]) {
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: spot.x, y: spot.y, button: "left", buttons: 1, clickCount });
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: spot.x, y: spot.y, button: "left", buttons: 0, clickCount });
        await wait(120);
      }
      await wait(500);
    };
    const maximizeLabel = async () => evaluate("document.querySelectorAll('.wc-btn')[1]?.getAttribute('aria-label') ?? ''");
    assert.equal(await maximizeLabel(), "最大化", "初始应为「最大化」");
    await doubleClickTitlebar();
    assert.equal(win.isMaximized(), true, "双击标题栏应最大化");
    assert.equal(await maximizeLabel(), "向下还原", "最大化后图标要变成「向下还原」");
    await doubleClickTitlebar();
    assert.equal(win.isMaximized(), false, "再次双击应还原");
    assert.equal(await maximizeLabel(), "最大化", "还原后图标要变回「最大化」");

    console.log("[appearance] window-controls", JSON.stringify({ count: rects.length, idle: idle.bg, closeHover: closeHover.bg }));
    if (dbg.isAttached()) dbg.detach();
  }


    await evaluate("window.__piDesktop.settings.close(); true");
    await wait(500);
  }

  console.log("[appearance]", JSON.stringify({ controls: { swatches: controls.swatches, segments: controls.segments }, violet: violet.accent, emphasis: violet.emphasis, customAccent: "#12ab34", splitEmphasis: "#ff8800", radius: round.radius, column: full.column, motion: still.motion }));
  return { controls, violet, round, full, still };
}
