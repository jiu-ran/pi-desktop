import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * .md 文件的三种视图回归：源码 / 分栏实时预览 / 纯预览。
 *
 * 以前工具栏那个控件用的是不存在的 `.settings-segmented` 类，渲染成一个灰色空白块；
 * 现在统一成 `.settings-segments`，并且分栏要求「边写边看」：
 * - 输入后预览跟着变（去抖 ~140ms）
 * - 编辑器滚动时预览按比例跟随
 * - 视图选择落到设置里（重开文件仍然是这个视图）
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
    "第一段：用来验证分栏实时预览。",
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
  ].join("\n");
  const filePath = path.join(cwd, "md-view-check.md");
  await writeFile(filePath, body, "utf8").catch(() => {});

  const open = () =>
    evaluate(`(() => {
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

  const setView = (label) =>
    evaluate(`(() => {
      const button = [...document.querySelectorAll(".file-view-toggle button")].find((n) => n.textContent.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);

  const state = () =>
    evaluate(`(() => {
      const toggle = document.querySelector(".file-view-toggle");
      const buttons = toggle ? [...toggle.querySelectorAll("button")] : [];
      const split = document.querySelector(".file-editor-split");
      const panes = split ? [...split.children].map((el) => Math.round(el.getBoundingClientRect().width)) : [];
      return JSON.stringify({
        hasToggle: Boolean(toggle),
        // 以前是「有底色、没字」的灰块：这里同时要求按钮有文字
        labels: buttons.map((n) => n.textContent.trim()),
        active: buttons.filter((n) => n.classList.contains("active")).map((n) => n.textContent.trim()),
        split: Boolean(split),
        panes,
        previewVisible: Boolean(document.querySelector(".md-preview")),
        editorVisible: Boolean(document.querySelector(".markdown-highlight-input")),
        view: window.__piDesktop.settings.settings.markdownView,
      });
    })()`);

  try {
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "split"; true`).catch(() => {});
    await open();
    await poll(`Boolean(document.querySelector(".file-view-toggle"))`, "工具栏视图切换");
    await wait(600);

    const split = JSON.parse(await state());
    assert.deepEqual(split.labels, ["源码", "分栏", "预览"], `视图切换应为三档，实际 ${JSON.stringify(split.labels)}`);
    assert.deepEqual(split.active, ["分栏"], `默认应是分栏，实际 ${JSON.stringify(split.active)}`);
    assert.ok(split.split, "分栏模式下应有左右两栏");
    assert.equal(split.panes.length, 2, `分栏应有两个面板，实际 ${JSON.stringify(split.panes)}`);
    assert.ok(split.panes.every((width) => width > 60), `两栏都要有宽度，实际 ${JSON.stringify(split.panes)}`);
    assert.ok(split.editorVisible && split.previewVisible, "分栏里输入框与预览都应存在");
    assert.equal(split.view, "split", "视图选择应写进设置");

    // 边写边看：往输入框里打字，预览要跟着变
    await evaluate(`(() => {
      const box = document.querySelector(".markdown-highlight-input");
      box.focus();
      box.value = box.value + "新增的一句话：实时预览应该立刻出现。";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await poll(
      `(() => {
        const root = document.querySelector(".file-editor-split-preview");
        return Boolean(root && root.textContent.includes("实时预览应该立刻出现"));
      })()`,
      "输入后预览即时更新",
    );

    // 滚动同步：编辑器滚到底，预览也要往下走
    const scrolled = await evaluate(`(() => {
      const box = document.querySelector(".markdown-highlight-input");
      box.scrollTop = box.scrollHeight;
      box.dispatchEvent(new Event("scroll"));
      return true;
    })()`);
    assert.ok(scrolled, "应能滚动编辑器");
    await wait(250);
    const previewTop = await evaluate(
      `(() => Math.round((document.querySelector(".file-editor-split-preview")?.scrollTop) ?? -1))()`,
    );
    assert.ok(previewTop >= 0, `预览面板不可滚动：${previewTop}`);

    // 纯预览
    assert.ok(await setView("预览"), "找不到「预览」按钮");
    await wait(500);
    const preview = JSON.parse(await state());
    assert.equal(preview.split, false, "预览模式不该再有分栏");
    assert.ok(preview.previewVisible && !preview.editorVisible, "预览模式只显示渲染结果");
    assert.equal(preview.view, "preview", "视图选择要持久化到设置");
    const previewText = await evaluate(`document.querySelector(".md-preview")?.textContent ?? ""`);
    assert.match(previewText, /实时预览验收/, "预览应渲染出文档内容");
    assert.match(previewText, /甲/, "列表也要渲染出来");

    // 源码
    assert.ok(await setView("源码"), "找不到「源码」按钮");
    await wait(400);
    const source = JSON.parse(await state());
    assert.equal(source.split, false, "源码模式不该有分栏");
    assert.ok(source.editorVisible && !source.previewVisible, "源码模式只显示编辑器");
    assert.equal(source.view, "source", "视图选择要持久化到设置");

    console.log("[markdown-view]", JSON.stringify({ panes: split.panes, views: [split.view, preview.view, source.view] }));
  } finally {
    await evaluate(`window.__piDesktop.settings.settings.markdownView = "split"; true`).catch(() => {});
    await evaluate(`(() => {
      const tab = window.__piDesktop.stage.findTab("files", "md-view-check.md");
      if (tab) window.__piDesktop.stage.close(tab.key);
      return true;
    })()`).catch(() => {});
    await rm(filePath, { force: true }).catch(() => {});
    await rm(path.join(cwd, "md-view-check.md"), { force: true }).catch(() => {});
  }
}
