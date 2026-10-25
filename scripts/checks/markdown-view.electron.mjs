import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * .md 的 Typora 式混合预览回归。
 *
 * 期望（用户明确要的形态）：默认就是**预览**，不是分栏；点其中某一块时只有那一块
 * 变成源码编辑框，改完写回全文，其它块继续以渲染结果展示。
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

  const cwd = await evaluate(`window.__piDesktop.workbench.state.activeCwd ?? ""`);
  assert.ok(cwd, "需要一个活动工作区");

  const body = [
    "# 实时预览验收",
    "",
    "第一段文字，用来验证块级就地编辑。",
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
    // 撑够一屏：预览必须能下滑（短文档贴底不该被误判成"不能滚"）
    ...Array.from({ length: 14 }, (_, i) => `第 ${i + 1} 段填充文字，用来把文档撑到超过一屏，验证预览可以向下滚动。\n`),
  ].join("\n");
  const filePath = path.join(cwd, "md-view-check.md");
  await writeFile(filePath, body, "utf8").catch(() => {});

  const state = () =>
    evaluate(`(() => {
      const toggle = document.querySelector(".file-view-toggle");
      const buttons = toggle ? [...toggle.querySelectorAll("button")] : [];
      const host = document.querySelector(".md-editable");
      const editor = document.querySelector(".md-block-editor");
      const tab = window.__piDesktop.stage.findTab("files", "md-view-check.md");
      return JSON.stringify({
        labels: buttons.map(((n) => n.textContent.trim())),
        active: buttons.filter((n) => n.classList.contains("active")).map((n) => n.textContent.trim()),
        editable: Boolean(host),
        aligned: host?.getAttribute("data-aligned") ?? null,
        blocks: document.querySelectorAll("[data-md-block]").length,
        editing: Boolean(editor),
        editorValue: editor?.value ?? "",
        sourceVisible: Boolean(document.querySelector(".markdown-highlight-input")),
        draft: tab?.data?.draft ?? "",
        view: window.__piDesktop.settings.settings.markdownView,
      });
    })()`);

  try {
    // 默认应该是预览（混合编辑）
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "preview"; true`).catch(() => {});
    await evaluate(`(() => {
      const text = ${JSON.stringify(body)};
      window.__piDesktop.stage.open({
        pluginId: "files",
        tabId: "md-view-check.md",
        title: "md-view-check.md",
        data: {
          cwd: ${JSON.stringify(cwd)},
          path: ${JSON.stringify(filePath)},
          relative: "md-view-check.md",
          name: "md-view-check.md",
          size: text.length,
          content: text,
          savedContent: text,
          draft: text,
          loading: false,
          error: "",
        },
      });
      return true;
    })()`);
    await poll(`Boolean(document.querySelector(".file-view-toggle"))`, "工具栏视图切换");
    await wait(700);

    const initial = JSON.parse(await state());
    // 版式必须有：可纵向滚动、左右留白、正文栏宽 860 —— 之前漏了 .md-preview 的
    // 滚动与内边距，结果预览既不能下滑、左边还被切掉一截。
    const layout = await evaluate(`(() => {
      const host = document.querySelector(".md-editable");
      const md = host?.querySelector(".md");
      if (!host || !md) return "no-host";
      const box = host.getBoundingClientRect();
      const first = md.querySelector("p, h1, h2, li");
      const fbox = first ? first.getBoundingClientRect() : null;
      return JSON.stringify({
        scrollable: host.scrollHeight > host.clientHeight,
        overflowY: getComputedStyle(host).overflowY,
        paddingLeft: getComputedStyle(host).paddingLeft,
        leftGap: fbox ? Math.round(fbox.left - box.left) : -1,
        scrollWidth: host.scrollWidth,
        clientWidth: host.clientWidth,
        maxWidth: getComputedStyle(md).maxWidth,
        fontSize: getComputedStyle(md).fontSize,
      });
    })()`);
    assert.notEqual(layout, "no-host", "预览容器应存在");
    const box = JSON.parse(layout);
    assert.equal(box.overflowY, "auto", `预览容器要能滚动，实际 overflow-y=${box.overflowY}`);
    assert.equal(box.scrollable, true, "长文档预览必须可以下滑");
    assert.ok(box.leftGap >= 20, `正文不能贴左边被切掉，实际左间距 ${box.leftGap}px`);
    assert.ok(box.scrollWidth <= box.clientWidth + 1, `不该出现横向溢出：${box.scrollWidth} > ${box.clientWidth}`);
    assert.equal(box.maxWidth, "860px", `正文栏宽应为 860px，实际 ${box.maxWidth}`);
    assert.equal(box.fontSize, "14.5px", `正文字号应为 14.5px，实际 ${box.fontSize}`);
    assert.deepEqual(initial.labels, ["源码", "预览"], `只应有两档：源码 / 预览，实际 ${JSON.stringify(initial.labels)}`);
    assert.deepEqual(initial.active, ["预览"], `默认应是预览，实际 ${JSON.stringify(initial.active)}`);
    assert.equal(initial.view, "preview", "默认视图应写进设置");
    assert.ok(initial.editable, "预览里应有混合编辑容器");
    assert.equal(initial.aligned, "1", "块与渲染节点必须对齐（对不上就退化成纯预览）");
    assert.ok(initial.blocks >= 6, `每块都要有编号，实际 ${initial.blocks} 块`);
    assert.equal(initial.sourceVisible, false, "预览模式不该出现源码编辑器");

    // 点标题块 → 只有这一块变成编辑框，内容是它的源码
    await evaluate(`(() => {
      const slot = document.querySelector('[data-md-block="0"]');
      if (!slot) return false;
      const rect = slot.getBoundingClientRect();
      slot.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + 12, clientY: rect.top + 8 }));
      return true;
    })()`);
    await poll(`Boolean(document.querySelector(".md-block-editor"))`, "点击块后就地编辑");
    const editing = JSON.parse(await state());
    assert.equal(editing.editing, true, "应出现就地编辑框");
    assert.equal(editing.editorValue, "# 实时预览验收", `编辑框应预填这一块的源码，实际「${editing.editorValue}」`);
    // 其它块仍然是渲染结果（列表还在，不是源码）
    const stillRendered = await evaluate(`document.querySelectorAll(".md-editable li").length`);
    assert.ok(stillRendered >= 2, `其它块要保持渲染：列表项 ${stillRendered}`);

    // 滚动到中间再点块：编辑框必须落在那一块原位置（坐标要算上滚动距离）
    // 先把上一步开着的编辑框收起来，否则点击会被「正在编辑」挡住
    await evaluate(`(() => { document.querySelector(".md-block-editor")?.blur(); return true; })()`);
    await poll(`!document.querySelector(".md-block-editor")`, "收起上一块的编辑框");
    await evaluate(`(() => { document.querySelector(".md-editable").scrollTop = 160; return true; })()`);
    await wait(250);
    const scrolled = JSON.parse(await evaluate(`(() => {
      const host = document.querySelector(".md-editable");
      const slot = document.querySelector('[data-md-block="3"]');
      if (!slot) return JSON.stringify({ ok: false });
      const rect = slot.getBoundingClientRect();
      slot.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 10 }));
      return JSON.stringify({ ok: true, scrollTop: host.scrollTop });
    })()`));
    assert.equal(scrolled.ok, true, "滚动后应能点到目标块");
    await poll(`Boolean(document.querySelector(".md-block-editor"))`, "滚动后点击进入编辑");
    const placed = JSON.parse(await evaluate(`(() => {
      const box = document.querySelector(".md-block-editor").getBoundingClientRect();
      const host = document.querySelector(".md-editable");
      const md = host.querySelector(".md");
      const block = document.querySelector('[data-md-block="3"]');
      const b = block.getBoundingClientRect();
      return JSON.stringify({
        dy: Math.round(box.top - b.top),
        dx: Math.round(box.left - b.left),
        inView: box.top >= host.getBoundingClientRect().top - 2 && box.bottom <= host.getBoundingClientRect().bottom + 2,
        cs: md ? getComputedStyle(md).fontSize : "",
      });
    })()`));
    assert.ok(Math.abs(placed.dy) <= 2, `滚动后编辑框应与块对齐，纵向差 ${placed.dy}px`);
    assert.ok(Math.abs(placed.dx) <= 2, `滚动后编辑框应与块对齐，横向差 ${placed.dx}px`);
    await evaluate(`(() => { document.querySelector(".md-block-editor").blur(); return true; })()`);
    await poll(`!document.querySelector(".md-block-editor")`, "退出编辑");

    // 重新点第一块，改完失焦 → 写回草稿，预览更新
    await evaluate(`(() => {
      document.querySelector(".md-editable").scrollTop = 0;
      const slot = document.querySelector('[data-md-block="0"]');
      slot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    })()`);
    await poll(`Boolean(document.querySelector(".md-block-editor"))`, "回到第一块");
    await wait(300);
    await evaluate(`(() => {
      const box = document.querySelector(".md-block-editor");
      box.value = "# 改过的标题";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new FocusEvent("blur"));
      return true;
    })()`);
    await poll(`!document.querySelector(".md-block-editor")`, "编辑框收起");
    await wait(400);
    const updated = JSON.parse(await state());
    assert.match(updated.draft, /^# 改过的标题/, `草稿应已更新，实际开头「${updated.draft.slice(0, 20)}」`);
    assert.ok(updated.draft.includes("第一段文字"), "其它块不能被改掉");
    const rendered = await evaluate(`document.querySelector(".md-editable")?.textContent ?? ""`);
    assert.match(rendered, /改过的标题/, "预览应显示修改后的内容");

    // 切到源码
    await evaluate(`(() => {
      [...document.querySelectorAll(".file-view-toggle button")].find((n) => n.textContent.trim() === "源码")?.click();
      return true;
    })()`);
    await wait(400);
    const source = JSON.parse(await state());
    assert.equal(source.sourceVisible, true, "源码模式应显示源码编辑器");
    assert.equal(source.editable, false, "源码模式不该再有混合编辑容器");
    assert.equal(source.view, "source", "视图选择要写进设置");

    // 真实文档回归：本仓库的 CHANGELOG.md 末尾有一串链接引用定义（渲染后不占节点），
    // 早前会把块数算多一个，导致整篇退化成纯预览、点了没反应。
    const changelog = await readFile(path.resolve("CHANGELOG.md"), "utf8");
    // 上一段刚切到「源码」，这里要切回预览
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "preview"; true`);
    await wait(300);
    await evaluate(`(() => {
      window.__piDesktop.stage.open({
        pluginId: "files",
        tabId: "md-view-changelog.md",
        title: "md-view-changelog.md",
        data: {
          cwd: ${JSON.stringify(cwd)},
          path: ${JSON.stringify(path.join(cwd, "md-view-changelog.md"))},
          relative: "md-view-changelog.md",
          name: "md-view-changelog.md",
          size: ${changelog.length},
          content: ${JSON.stringify(changelog)},
          savedContent: ${JSON.stringify(changelog)},
          draft: ${JSON.stringify(changelog)},
          loading: false,
          error: "",
        },
      });
      return true;
    })()`);
    await poll(`Boolean(document.querySelector(".md-editable .md h1"))`, "CHANGELOG 预览渲染");
    await wait(900);
    const real = JSON.parse(await evaluate(`(() => {
      const host = document.querySelector(".md-editable");
      return JSON.stringify({
        aligned: host?.getAttribute("data-aligned"),
        blocks: document.querySelectorAll("[data-md-block]").length,
        slots: host?.querySelector(".md")?.children.length ?? -1,
        scrollable: host ? host.scrollHeight > host.clientHeight : false,
        hScroll: host ? host.scrollWidth - host.clientWidth : -1,
      });
    })()`));
    assert.equal(real.aligned, "1", `真实文档（含链接引用定义）必须能对齐，实际 ${JSON.stringify(real)}`);
    assert.equal(real.blocks, real.slots, `块数要与渲染节点一致：${real.blocks} vs ${real.slots}`);
    assert.equal(real.scrollable, true, "长文档要能下滑");
    assert.ok(real.hScroll <= 1, `长文档不该横向溢出：${real.hScroll}`);
    await evaluate(`(() => {
      const tab = window.__piDesktop.stage.findTab("files", "md-view-changelog.md");
      if (tab) window.__piDesktop.stage.close(tab.key);
      return true;
    })()`);

    console.log("[markdown-view]", JSON.stringify({ blocks: initial.blocks, labels: initial.labels, realBlocks: real.blocks, draft: updated.draft.slice(0, 12) }));
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
