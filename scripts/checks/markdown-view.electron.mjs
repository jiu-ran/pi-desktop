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
    "",
    ...Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段填充文字，用来把文档撑到超过一屏，验证预览可以向下滚动。\n`),
  ].join("\n");
  const filePath = path.join(cwd, "md-view-check.md");
  await writeFile(filePath, body, "utf8").catch(() => {});

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
    assert.deepEqual(table.cells, ["1", "2"], `单元格不对：${JSON.stringify(table.cells)}`);

    // 8) 点进代码块 → 变回源码（围栏露出来）
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
      const fences = [...document.querySelectorAll(".md-live .cm-line")].some((n) => n.textContent.trim().startsWith("\`\`\`"));
      return JSON.stringify({ widget: Boolean(widget), fences });
    })()`));
    assert.equal(codeActive.widget, false, "光标进入后应收起 widget，显示源码");
    assert.equal(codeActive.fences, true, "光标进入后应显示 ``` 围栏");

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
      const tab = window.__piDesktop.stage.findTab("files", "md-view-check.md");
      if (tab) window.__piDesktop.stage.close(tab.key);
      return true;
    })()`).catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
  }
}
