import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    // 改完失焦 → 写回草稿，预览更新
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

    console.log("[markdown-view]", JSON.stringify({ blocks: initial.blocks, labels: initial.labels, draft: updated.draft.slice(0, 12) }));
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
