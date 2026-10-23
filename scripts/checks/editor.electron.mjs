import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/** 编辑器真实 DOM 回归：仅操作临时文件，不发送 Agent 提示词。 */
export async function checkEditorInElectron(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const poll = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await wait(100); }
    throw new Error(`编辑器检查超时：${label}`);
  };
  const dir = await mkdtemp(path.join(tmpdir(), "pi-editor-"));
  const file = path.join(dir, "sample.txt");
  const md = path.join(dir, "sample.md");
  const previousMode = await evaluate("window.__piDesktop.settings.settings.autoSave");
  try {
    await writeFile(file, "initial", "utf8");
    await writeFile(md, '# 渲染回归\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```\n\n<img src="x" onerror="window.__unsafeMarkdown=1">\n<script>window.__unsafeMarkdown=1</script>\n');
    await evaluate("window.__piDesktop.settings.settings.autoSave='off'; true");
    await evaluate(`window.__piDesktop.bus.emit('file:open', ${JSON.stringify(file)}); true`);
    await poll("document.querySelector('.file-editor-input')?.value === 'initial'", "打开临时文本");
    await evaluate("(()=>{const e=document.querySelector('.file-editor-input');e.value='edited';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
    await wait(100);
    await evaluate("document.querySelector('.file-editor-save').click(); true");
    await poll("window.__piDesktop.stage.activeTab.value?.dirty === false", "保存完成");
    assert.equal(await readFile(file, "utf8"), "edited");
    await writeFile(file, "changed-outside", "utf8");
    await evaluate("(()=>{const e=document.querySelector('.file-editor-input');e.value='keep-draft';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
    await wait(100);
    await evaluate("document.querySelector('.file-editor-save').click(); true");
    await poll("Boolean(window.__piDesktop.stage.activeTab.value?.data.saveError)", "外部修改冲突");
    assert.equal(await readFile(file, "utf8"), "changed-outside");
    assert.equal(await evaluate("document.querySelector('.file-editor-input').value"), "keep-draft");
    await evaluate("window.__piDesktop.stage.switchWorkspace('test-other-project'); true");
    await evaluate("window.__piDesktop.stage.switchWorkspace(window.__piDesktop.workbench.state.activeCwd); true");
    await poll("document.querySelector('.file-editor-input')?.value === 'keep-draft'", "切换项目保留草稿");
    // 明确丢弃本测试的草稿，不能触发关闭应用确认。
    await evaluate("window.__piDesktop.stage.activeTab.value.dirty=false; window.__piDesktop.stage.clear(); true");
    await evaluate(`window.__piDesktop.bus.emit('file:open', ${JSON.stringify(md)}); true`);
    await poll("Boolean(document.querySelector('.md-body'))", "Markdown 预览");
    await poll("Boolean(document.querySelector('.mermaid-preview-area svg, .mermaid-block-container svg'))", "时序图非空白");
    assert.notEqual(await evaluate("window.__unsafeMarkdown"), 1, "Markdown 不能执行不可信脚本 / 事件属性");
    await evaluate("(()=>{const buttons=[...document.querySelectorAll('.file-view-toggle button')];buttons.find(b=>b.textContent==='源码').click();return true})()");
    await poll("Boolean(document.querySelector('.markdown-highlight-input'))", "Markdown 源码高亮编辑");
    console.log("[editor] PASS 保存 / 外部冲突 / 草稿保留 / Markdown 高亮 / 时序图 / HTML安全");
  } finally {
    await evaluate(`window.__piDesktop.stage.clear(); window.__piDesktop.settings.settings.autoSave=${JSON.stringify(previousMode)}; true`);
    await rm(dir, { recursive: true, force: true });
  }
}
