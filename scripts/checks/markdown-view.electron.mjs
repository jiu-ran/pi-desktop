import assert from "node:assert/strict";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * .md 的 Typora / Obsidian 式实时预览回归。
 *
 * 期望：预览模式**本身就是文档**（CodeMirror + 标记隐藏），光标不在的行只显示排版
 * 结果；光标进到哪一行，哪一行才露出 `##`、反引号这类标记；代码块、表格在光标
 * 不在时渲染成真正的块，点进去变回源码。
 */
export async function checkMarkdownViewInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const poll = async (expression, label, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await wait(100);
    }
    throw new Error(`Markdown 视图检查超时：${label}`);
  };
  /** 真实鼠标点击（CodeMirror 靠 mousedown 定位光标，合成事件不可靠） */
  const clickAt = async (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    win.webContents.sendInputEvent({ type: "mouseDown", x: px, y: py, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: px, y: py, button: "left", clickCount: 1 });
    await wait(350);
  };
  /** 点击「包含某段文字的 CM 行」 */
  const clickLine = async (needle, offsetX = 40) => {
    const rect = await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes(${JSON.stringify(needle)}));
      if (!line) return null;
      line.scrollIntoView({ block: "center" });
      const r = line.getBoundingClientRect();
      return JSON.stringify({ x: r.left + ${offsetX}, y: r.top + 6 });
    })()`);
    assert.ok(rect, `找不到包含「${needle}」的行`);
    const point = JSON.parse(rect);
    await wait(250);
    await clickAt(point.x, point.y);
  };
  const lineText = (needle) =>
    evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes(${JSON.stringify(needle)}));
      return line ? line.textContent : "";
    })()`);

  const cwd = await evaluate(`window.__piDesktop.workbench.state.activeCwd ?? ""`);
  assert.ok(cwd, "需要一个活动工作区");

  const body = [
    "# 实时预览验收",
    "",
    "第一段文字，用来验证块级就地编辑。",
    "",
    "这里有 **加粗文字** 和 \`行内代码\` 以及 [一个链接](https://example.com)。",
    "",
    "[跳到最后一节](#最后一段)",
    "",
    "![截图](md-view-shot.png)",
    "",
    "## 小标题",
    "",
    "- 甲",
    "- 乙",
    "",
    "```js",
    "const a = 1;",
    "```",
    "",
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "| **配色模式** | 跟随 `--accent` 切换 |",
    "",
    ...Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段填充文字，用来把文档撑到超过一屏，验证预览可以向下滚动。\n`),
  ].join("\n");
  const filePath = path.join(cwd, "md-view-check.md");
  await writeFile(filePath, body, "utf8").catch(() => {});
  // 1x1 透明 PNG：验证 markdown 里的相对图片地址能读成 data URL
  const pngPath = path.join(cwd, "md-view-shot.png");
  await writeFile(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")).catch(() => {});

  const open = async (tabId, name, text) => {
    await evaluate(`(() => {
      window.__piDesktop.stage.open({
        pluginId: "files",
        tabId: ${JSON.stringify(tabId)},
        title: ${JSON.stringify(name)},
        data: {
          cwd: ${JSON.stringify(cwd)},
          path: ${JSON.stringify(path.join(cwd, name))},
          relative: ${JSON.stringify(name)},
          name: ${JSON.stringify(name)},
          size: ${text.length},
          content: ${JSON.stringify(text)},
          savedContent: ${JSON.stringify(text)},
          draft: ${JSON.stringify(text)},
          loading: false,
          error: "",
        },
      });
      return true;
    })()`);
    await wait(900);
  };

  try {
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "preview"; true`).catch(() => {});
    await open("md-view-check.md", "md-view-check.md", body);
    await poll(`Boolean(document.querySelector(".md-live .cm-content"))`, "实时预览渲染");

    // 1) 视图只有两档，默认预览
    const tabs = JSON.parse(await evaluate(`(() => {
      const toggle = document.querySelector(".file-view-toggle");
      const buttons = toggle ? [...toggle.querySelectorAll("button")] : [];
      return JSON.stringify({
        labels: buttons.map((n) => n.textContent.trim()),
        active: buttons.filter((n) => n.classList.contains("active")).map((n) => n.textContent.trim()),
        view: window.__piDesktop.settings.settings.markdownView,
      });
    })()`));
    assert.deepEqual(tabs.labels, ["源码", "预览"], `只应有两档：源码 / 预览，实际 ${JSON.stringify(tabs.labels)}`);
    assert.deepEqual(tabs.active, ["预览"], `默认应是预览，实际 ${JSON.stringify(tabs.active)}`);
    assert.equal(tabs.view, "preview", "默认视图要写进设置");

    // 2) 版式：可滚动、左右留白、正文栏宽 860、字号 14.5
    const layout = JSON.parse(await evaluate(`(() => {
      const scroller = document.querySelector(".md-live .cm-scroller");
      const content = document.querySelector(".md-live .cm-content");
      const cs = getComputedStyle(content);
      const scs = getComputedStyle(scroller);
      const box = content.getBoundingClientRect();
      return JSON.stringify({
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        overflowY: scs.overflowY,
        paddingLeft: scs.paddingLeft,
        maxWidth: cs.maxWidth,
        fontSize: cs.fontSize,
        hScroll: scroller.scrollWidth - scroller.clientWidth,
        leftGap: Math.round(box.left - scroller.getBoundingClientRect().left),
      });
    })()`));
    assert.equal(layout.overflowY, "auto", `预览要能滚动，实际 overflow-y=${layout.overflowY}`);
    assert.equal(layout.scrollable, true, "长文档预览必须可以下滑");
    assert.ok(Number.parseFloat(layout.paddingLeft) >= 20, `正文不能贴左边，实际 padding-left=${layout.paddingLeft}`);
    assert.equal(layout.maxWidth, "860px", `正文栏宽应为 860px，实际 ${layout.maxWidth}`);
    assert.equal(layout.fontSize, "14.5px", `正文字号应为 14.5px，实际 ${layout.fontSize}`);
    assert.ok(layout.hScroll <= 1, `不该出现横向溢出：${layout.hScroll}`);

    // 3) 光标不在的行收起标记：`## 小标题` 只剩标题文字
    const heading = await lineText("小标题");
    assert.equal(heading.trim(), "小标题", `非活动行的标题不该显示 ##，实际「${heading}」`);
    const headingSize = await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes("小标题"));
      return getComputedStyle(line).fontSize;
    })()`);
    assert.ok(Number.parseFloat(headingSize) > 20, `标题行要按标题字号排版，实际 ${headingSize}`);

    // 4) 点进去才露标记
    await clickLine("小标题");
    const activeHeading = await lineText("小标题");
    assert.match(activeHeading, /^## 小标题/, `光标进入后应显示 ##，实际「${activeHeading}」`);

    // 5) 加粗 / 行内代码 / 链接：只显示排版结果，标记收起来
    const inline = JSON.parse(await evaluate(`(() => {
      const strong = document.querySelector(".md-live .cm-md-strong");
      const code = document.querySelector(".md-live .cm-md-inlinecode");
      const link = document.querySelector(".md-live .cm-md-link");
      const line = strong ? strong.closest(".cm-line")?.textContent ?? "" : "";
      return JSON.stringify({
        strong: strong ? strong.textContent : "",
        code: code ? code.textContent : "",
        link: link ? link.textContent : "",
        line,
        strongWeight: strong ? getComputedStyle(strong).fontWeight : "",
        codeMono: code ? getComputedStyle(code).fontFamily.includes("Mono") || getComputedStyle(code).fontFamily.includes("Consolas") : false,
      });
    })()`));
    assert.equal(inline.strong, "加粗文字", `加粗只应显示文字，实际「${inline.strong}」`);
    assert.equal(inline.code, "行内代码", `行内代码只应显示文字，实际「${inline.code}」`);
    assert.equal(inline.link, "一个链接", `链接只应显示文字，实际「${inline.link}」`);
    assert.ok(!inline.line.includes("**"), `非活动行不该露出 **，实际「${inline.line}」`);
    assert.ok(!inline.line.includes("https://"), `链接地址应收起来，实际「${inline.line}」`);
    assert.ok(Number(inline.strongWeight) >= 600, `加粗要真的是粗体，实际 ${inline.strongWeight}`);
    assert.equal(inline.codeMono, true, "行内代码要用等宽字体");

    // 5.5) 图片：相对地址读出 data URL 后直接显示成图
    const image = JSON.parse(await evaluate(`(() => {
      const wrap = document.querySelector(".md-live .cm-md-imagewrap");
      const img = wrap ? wrap.querySelector("img") : null;
      return JSON.stringify({
        wrap: Boolean(wrap),
        state: wrap ? wrap.dataset.state : "",
        src: img ? img.src.slice(0, 22) : "",
        alt: img ? img.alt : "",
      });
    })()`));
    assert.equal(image.wrap, true, "markdown 里的图片要渲染成图");
    assert.match(image.src, /^data:image\/png/, `图片应转成 data URL，实际 ${image.src}`);
    assert.equal(image.alt, "截图", `替代文字要保留，实际「${image.alt}」`);

    // 5.6) Ctrl+点击文档内锚点：滚到对应标题
    const scrollBefore = await evaluate(`document.querySelector(".md-live .cm-scroller").scrollTop`);
    const anchorPoint = JSON.parse(await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes("跳到最后一节"));
      const text = line ? line.textContent : "";
      const r = line.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + 30), y: Math.round(r.top + 6), text });
    })()`));
    assert.match(anchorPoint.text, /跳到最后一节/, "锚点链接那一行要显示文字，不显示地址");
    // 用带 ctrlKey 的真实 DOM 事件点击（合成事件即可触发 EditorView.domEventHandlers）
    await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes("跳到最后一节"));
      const r = line.getBoundingClientRect();
      const x = r.left + 30;
      const y = r.top + 6;
      const target = document.elementFromPoint(x, y) || line;
      for (const type of ["mousedown", "mouseup"]) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true, button: 0 }));
      }
      return true;
    })()`);
    await wait(700);
    // 6) 代码块：光标不在时是块级渲染，没有 ``` 围栏
    const code = JSON.parse(await evaluate(`(() => {
      const block = document.querySelector(".md-live .cm-md-codeblock");
      const lines = [...document.querySelectorAll(".md-live .cm-line")].map((n) => n.textContent);
      return JSON.stringify({
        widget: Boolean(block),
        text: block ? block.textContent.trim() : "",
        fences: lines.some((text) => text.trim().startsWith("\`\`\`")),
      });
    })()`));
    assert.equal(code.widget, true, "代码块应收起成块级渲染");
    assert.match(code.text, /const a = 1;/, `代码块内容应保留，实际「${code.text}」`);
    // 语法高亮：shiki 跑完后代码会被切成带颜色的 span
    const colored = await evaluate(`(() => {
      const spans = [...document.querySelectorAll(".md-live .cm-md-codeblock code span")];
      return JSON.stringify({ count: spans.length, colors: spans.filter((n) => n.style.color).length });
    })()`);
    const highlight = JSON.parse(colored);
    assert.ok(highlight.count >= 3, `代码块要做语法高亮，实际 ${highlight.count} 个片段`);
    assert.ok(highlight.colors >= 1, `高亮片段要带颜色，实际 ${highlight.colors}`);
    // 光标已经不在代码块里（上一步点的是标题行），此时不该露出围栏

    // 7) 表格：渲染成真正的表格
    const table = JSON.parse(await evaluate(`(() => {
      const wrap = document.querySelector(".md-live .cm-md-tablewrap");
      return JSON.stringify({
        widget: Boolean(wrap),
        headers: wrap ? [...wrap.querySelectorAll("th")].map((n) => n.textContent) : [],
        cells: wrap ? [...wrap.querySelectorAll("td")].map((n) => n.textContent) : [],
      });
    })()`));
    assert.equal(table.widget, true, "表格应收起成块级渲染");
    assert.deepEqual(table.headers, ["列 A", "列 B"], `表头不对：${JSON.stringify(table.headers)}`);
    assert.deepEqual(
      table.cells,
      ["1", "2", "配色模式", "跟随 --accent 切换"],
      `单元格不对：${JSON.stringify(table.cells)}`,
    );

    // 8) 点进代码块：Typora / Obsidian 那样**留在渲染态**就地改，不显示围栏
    const codeRect = JSON.parse(await evaluate(`(() => {
      const block = document.querySelector(".md-live .cm-md-codeblock");
      block.scrollIntoView({ block: "center" });
      const r = block.getBoundingClientRect();
      return JSON.stringify({ x: r.left + 30, y: r.top + 16 });
    })()`));
    await wait(250);
    await clickAt(codeRect.x, codeRect.y);
    const codeActive = JSON.parse(await evaluate(`(() => {
      const widget = document.querySelector(".md-live .cm-md-codeblock");
      const fenceChar = String.fromCharCode(96).repeat(3);
      const fences = [...document.querySelectorAll(".md-live .cm-line")].some((n) => n.textContent.trim().startsWith(fenceChar));
      return JSON.stringify({ widget: Boolean(widget), fences, editable: widget?.querySelector("code")?.isContentEditable ?? false });
    })()`));
    assert.equal(codeActive.widget, true, "点代码块不该退回源码，仍应是块级渲染");
    assert.equal(codeActive.fences, false, "点代码块不该露出围栏");
    assert.equal(codeActive.editable, true, "代码正文要能直接编辑");

    // 改代码正文 → 写回草稿（围栏与语言标识原样保留）
    await evaluate(`(() => {
      const code = document.querySelector(".md-live .cm-md-codeblock code");
      code.focus();
      code.textContent = "const a = 42;";
      code.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await wait(700);
    const codeEdited = JSON.parse(await evaluate(`(() => {
      const draft = window.__piDesktop.stage.findTab("files", "md-view-check.md")?.data?.draft ?? "";
      const fenceChar = String.fromCharCode(96).repeat(3);
      return JSON.stringify({
        widget: Boolean(document.querySelector(".md-live .cm-md-codeblock")),
        hasCode: draft.includes("const a = 42;"),
        keepsFence: draft.includes(fenceChar + "js"),
      });
    })()`));
    assert.equal(codeEdited.widget, true, "编辑代码块时不该退回源码");
    assert.equal(codeEdited.hasCode, true, "改代码正文要写回草稿");
    assert.equal(codeEdited.keepsFence, true, "围栏与语言标识要保留");

    // 需要手写围栏时点「源码」；Esc 回到渲染态
    await evaluate(`(() => {
      document.querySelector(".md-live .cm-md-codeblock .cm-md-blocktool").click();
      return true;
    })()`);
    await wait(600);
    const rawMode = JSON.parse(await evaluate(`(() => {
      const fenceChar = String.fromCharCode(96).repeat(3);
      return JSON.stringify({
        fences: [...document.querySelectorAll(".md-live .cm-line")].some((n) => n.textContent.trim().startsWith(fenceChar)),
        widget: Boolean(document.querySelector(".md-live .cm-md-codeblock")),
      });
    })()`));
    assert.equal(rawMode.fences, true, "点「源码」应显示围栏");
    assert.equal(rawMode.widget, false, "源码态不再渲染代码块");
    // 源码态块前有个「渲染」按钮，点它回到渲染结果
    await evaluate(`(() => {
      const bar = document.querySelector(".md-live .cm-md-sourcebar .cm-md-blocktool");
      if (!bar) return false;
      bar.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      bar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    })()`);
    await wait(700);
    const backToRendered = await evaluate(`Boolean(document.querySelector(".md-live .cm-md-codeblock"))`);
    assert.equal(backToRendered, true, "点「渲染」应回到渲染态");

    // 8.5) 表格：点单元格就地编辑，不显示分隔行源码
    const cellRect = JSON.parse(await evaluate(`(() => {
      const cell = document.querySelector(".md-live .cm-md-tablewrap td");
      cell.scrollIntoView({ block: "center" });
      const r = cell.getBoundingClientRect();
      return JSON.stringify({ x: r.left + 10, y: r.top + r.height / 2, editable: cell.isContentEditable });
    })()`));
    assert.equal(cellRect.editable, true, "表格单元格要能直接编辑");
    await wait(250);
    await clickAt(cellRect.x, cellRect.y);
    const tableActive = JSON.parse(await evaluate(`(() => {
      const wrap = document.querySelector(".md-live .cm-md-tablewrap");
      const raw = [...document.querySelectorAll(".md-live .cm-line")].some((n) => n.textContent.includes("| --- |"));
      return JSON.stringify({ widget: Boolean(wrap), raw });
    })()`));
    assert.equal(tableActive.widget, true, "点表格不该退回源码");
    assert.equal(tableActive.raw, false, "点表格不该露出分隔行");
    await evaluate(`(() => {
      const cell = document.querySelector(".md-live .cm-md-tablewrap td");
      cell.focus();
      cell.textContent = "99";
      cell.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await wait(700);
    const tableEdited = JSON.parse(await evaluate(`(() => {
      const draft = window.__piDesktop.stage.findTab("files", "md-view-check.md")?.data?.draft ?? "";
      return JSON.stringify({ hasCell: draft.includes("| 99"), stillTable: draft.includes("| --- |") });
    })()`));
    assert.equal(tableEdited.hasCell, true, "改单元格要写回草稿");
    assert.equal(tableEdited.stillTable, true, "表格分隔行要保留");
    // 8.6) 单元格里的行内语法要渲染：**加粗** 显示成粗体、`代码` 显示成行内代码；
    // 编辑别的格子不能把它们的 markdown 标记吃掉（写回要按 raw 源码，不是渲染后的文字）
    const cellInline = JSON.parse(await evaluate(`(() => {
      const cells = [...document.querySelectorAll(".md-live .cm-md-tablewrap td")];
      const strongCell = cells.find((cell) => cell.querySelector("strong"));
      const codeCell = cells.find((cell) => cell.querySelector("code"));
      const tick = String.fromCharCode(96);
      return JSON.stringify({
        strong: Boolean(strongCell),
        strongText: strongCell ? strongCell.textContent.trim() : "",
        strongWeight: strongCell ? getComputedStyle(strongCell.querySelector("strong")).fontWeight : "",
        code: Boolean(codeCell),
        codeText: codeCell ? codeCell.textContent.trim() : "",
        codeOnly: codeCell?.querySelector("code")?.textContent ?? "",
        codeMono: codeCell ? getComputedStyle(codeCell.querySelector("code")).fontFamily : "",
        literals: cells.filter((cell) => cell.textContent.includes("**") || cell.textContent.includes(tick)).length,
      });
    })()`));
    assert.equal(cellInline.strong, true, "单元格里的 **加粗** 要渲染成 <strong>");
    assert.equal(cellInline.strongText, "配色模式", "加粗单元格不能露出星号");
    assert.ok(Number(cellInline.strongWeight) >= 600, `单元格加粗要真的变粗，实际 ${cellInline.strongWeight}`);
    assert.equal(cellInline.code, true, "单元格里的行内代码要渲染成 <code>");
    assert.equal(cellInline.codeText, "跟随 --accent 切换", "行内代码单元格不能露出反引号");
    assert.equal(cellInline.codeOnly, "--accent", "只有反引号里的内容才是 <code>");
    assert.ok(/mono/i.test(cellInline.codeMono), `行内代码要用等宽字体，实际 ${cellInline.codeMono}`);
    assert.equal(cellInline.literals, 0, "表格里不该有残留的 markdown 标记");

    const keepRaw = JSON.parse(await evaluate(`(() => {
      const draft = window.__piDesktop.stage.findTab("files", "md-view-check.md")?.data?.draft ?? "";
      return JSON.stringify({
        bold: draft.includes("| **配色模式** |"),
        code: draft.includes("| **配色模式** | 跟随 " + String.fromCharCode(96) + "--accent" + String.fromCharCode(96) + " 切换 |"),
      });
    })()`));
    assert.equal(keepRaw.bold, true, "改别的单元格不能把 **加粗** 的标记写没了");
    assert.equal(keepRaw.code, true, "改别的单元格不能把行内代码的反引号写没了");

    // 聚焦时要露源码（改的是标记本身），失焦回到渲染结果
    const cellFocus = JSON.parse(await evaluate(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const cell = [...document.querySelectorAll(".md-live .cm-md-tablewrap td")].find((n) => n.textContent === "配色模式");
      if (!cell) return JSON.stringify({ editing: "", rendered: false });
      cell.focus();
      await wait(150);
      const editing = cell.textContent;
      cell.blur();
      await wait(200);
      return JSON.stringify({ editing, rendered: cell.innerHTML.includes("<strong>") });
    })()`));
    assert.equal(cellFocus.editing, "**配色模式**", "聚焦单元格要能看到 markdown 源码");
    assert.equal(cellFocus.rendered, true, "失焦后回到渲染结果");


    // 9) 改一行 → 写回草稿（自动保存链路照旧）
    await clickLine("第一段文字");
    await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes("第一段文字"));
      line.scrollIntoView({ block: "center" });
      return true;
    })()`);
    await wait(250);
    const target = JSON.parse(await evaluate(`(() => {
      const line = [...document.querySelectorAll(".md-live .cm-line")].find((n) => n.textContent.includes("第一段文字"));
      const r = line.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width - 8, y: r.top + 6, text: line.textContent });
    })()`));
    await clickAt(target.x, target.y);
    win.webContents.sendInputEvent({ type: "char", keyCode: "！" });
    await wait(600);
    const draft = await evaluate(`window.__piDesktop.stage.findTab("files", "md-view-check.md")?.data?.draft ?? ""`);
    assert.ok(draft.includes("！"), `编辑要写回草稿，实际开头「${draft.slice(0, 40)}」`);
    assert.ok(draft.startsWith("# 实时预览验收"), "文档其它内容不能被改掉");

    // 10) 真实长文档：CHANGELOG.md 也能正常渲染与编辑
    const changelog = await readFile(path.resolve("CHANGELOG.md"), "utf8");
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "preview"; true`);
    await open("md-view-changelog.md", "md-view-changelog.md", changelog);
    await poll(`Boolean(document.querySelector(".md-live .cm-content"))`, "CHANGELOG 渲染");
    await wait(1200);
    const realHead = JSON.parse(await evaluate(`(() => {
      const scroller = document.querySelector(".md-live .cm-scroller");
      const content = document.querySelector(".md-live .cm-content");
      return JSON.stringify({
        hasH1: Boolean(content?.querySelector(".cm-md-h1")),
        hScroll: scroller.scrollWidth - scroller.clientWidth,
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        visibleLines: document.querySelectorAll(".md-live .cm-line").length,
      });
    })()`));
    assert.equal(realHead.hasH1, true, "真实文档的标题要按 h1 排版");
    assert.ok(realHead.hScroll <= 1, `真实文档不该横向溢出：${realHead.hScroll}`);
    assert.equal(realHead.scrollable, true, "真实长文档要能下滑");
    assert.ok(realHead.visibleLines > 8, `至少要渲染出可见行，实际 ${realHead.visibleLines}`);
    // 滚到中段：整篇内容都在编辑器里（CodeMirror 只渲染可视区域，所以要看内容而不是 DOM 长度）
    const readLines = () =>
      evaluate(`JSON.stringify([...document.querySelectorAll(".md-live .cm-line")].map((n) => n.textContent))`);
    const headLines = JSON.parse(await readLines());
    await evaluate(`(() => {
      const scroller = document.querySelector(".md-live .cm-scroller");
      scroller.scrollTop = Math.round(scroller.scrollHeight * 0.5);
      return true;
    })()`);
    await wait(700);
    const midLines = JSON.parse(await readLines());
    assert.ok(midLines.length > 8, `滚动后仍应有内容，实际 ${midLines.length} 行`);
    assert.notDeepEqual(midLines.slice(0, 3), headLines.slice(0, 3), "滚动后应渲染出后面的内容");
    await evaluate(`(() => {
      const tab = window.__piDesktop.stage.findTab("files", "md-view-changelog.md");
      if (tab) window.__piDesktop.stage.close(tab.key);
      return true;
    })()`);

    // 11) 切到源码模式仍是旧编辑器
    await evaluate(`(() => {
      [...document.querySelectorAll(".file-view-toggle button")].find((n) => n.textContent.trim() === "源码")?.click();
      return true;
    })()`);
    await wait(500);
    const source = JSON.parse(await evaluate(`(() => JSON.stringify({
      source: Boolean(document.querySelector(".markdown-highlight-input")),
      live: Boolean(document.querySelector(".md-live")),
      view: window.__piDesktop.settings.settings.markdownView,
    }))()`));
    assert.equal(source.source, true, "源码模式应显示源码编辑器");
    assert.equal(source.live, false, "源码模式不该再有实时预览");
    assert.equal(source.view, "source", "视图选择要写进设置");

    console.log("[markdown-view]", JSON.stringify({
      heading: activeHeading.trim(),
      headingSize,
      inline,
      codeWidget: code.text.trim().slice(0, 18),
      tableHeaders: table.headers,
      realLines: midLines.length,
    }));
  } finally {
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "preview"; true`).catch(() => {});
    await evaluate(`(() => {
      window.__piDesktop.stage.clear();
      return true;
    })()`).catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
    await rm(path.join(cwd, "md-view-shot.png"), { force: true }).catch(() => {});
    // 关掉文件页后等一拍：下一个检查（对话滚动）要保证拿到的是对话视图
    await wait(600);
  }
}
