import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

/** 仅操作临时仓库，验证真实分支切换、新建、暂存分区和编辑器草稿保护。 */
export async function checkGitUiInElectron(win) {
  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const poll = async (expression, label) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await wait(100); }
    throw new Error(`Git 界面检查超时：${label}`);
  };
  const dir = await mkdtemp(path.join(tmpdir(), "pi-git-ui-"));
  const git = args => promisify(execFile)("git", args, { cwd: dir });
  const literal = JSON.stringify(dir);
  const previous = await evaluate("({cwd:window.__piDesktop.workbench.state.activeCwd,panel:window.__piDesktop.workbench.state.activePanelId,width:window.__piDesktop.workbench.state.panelWidth})");
  const tab = name => evaluate(`(()=>{[...document.querySelectorAll('.git-view-tabs button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)})).click();return true})()`);
  const switchTo = name => evaluate(`document.querySelector(${JSON.stringify(`.git-branch-row[aria-label="切换分支 ${name}"]`)}).click(); true`);
  const refresh = () => evaluate("document.querySelector('.git-sc-toolbar button[title=\"刷新\"]').click(); true");
  try {
    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Pi UI Check"]);
    await git(["config", "user.email", "ui@example.com"]);
    await writeFile(path.join(dir, "a.txt"), "one\n");
    await git(["add", "."]); await git(["commit", "-m", "初始提交"]);
    await git(["switch", "-c", "feature/ui"]);
    await writeFile(path.join(dir, "a.txt"), "feature\n");
    await git(["commit", "-am", "功能分支"]); await git(["switch", "main"]);
    await evaluate(`window.__piDesktop.workbench.open(${literal}).then(()=>true)`);
    await evaluate("window.__piDesktop.workbench.state.activePanelId='git'; true");
    await poll("document.querySelector('.git-branch-trigger')?.textContent.includes('main')", "仓库分支栏");
    await tab("分支");
    await poll("document.querySelectorAll('.git-branch-row').length === 2", "本地分支列表");
    await evaluate("(()=>{const e=document.querySelector('.git-branch-search');e.value='feature/ui';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
    await poll("document.querySelectorAll('.git-branch-row').length === 1", "分支搜索");
    await evaluate("(()=>{const e=document.querySelector('.git-branch-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
    await poll("document.querySelectorAll('.git-branch-row').length === 2", "清空分支搜索");
    assert(await evaluate("document.querySelector('.git-branch-row.current')?.textContent.includes('main')"), "当前分支应有独立标记");
    await switchTo("feature/ui");
    await poll("window.__piDesktop.workbench.active.value.branch === 'feature/ui'", "UI 切换分支");
    assert.equal((await readFile(path.join(dir, "a.txt"), "utf8")).replace(/\r\n/g, "\n"), "feature\n");
    await evaluate("window.__piDesktop.bus.emit('file:open','a.txt'); true");
    await poll("window.__piDesktop.stage.activeTab.value?.data.content.trim() === 'feature'", "打开分支文件");
    await evaluate("window.__piDesktop.stage.activeTab.value.dirty=true; true");
    const blocked = await evaluate("window.__piDesktop.workbench.gitAction('switchBranch',{branch:'refs/heads/main'}).then(()=>false,()=>true)");
    assert(blocked, "未保存草稿必须阻止切换分支");
    await evaluate("window.__piDesktop.stage.activeTab.value.dirty=false; true");
    await poll("Boolean(document.querySelector('.git-branch-row[aria-label=\"切换分支 main\"]'))", "切换主分支入口");
    await switchTo("main");
    await poll("window.__piDesktop.workbench.active.value.branch === 'main' && !window.__piDesktop.stage.tabs.some(t=>t.pluginId==='files')", "切换后清除旧源码标签");

    await evaluate("[...document.querySelectorAll('.git-branches .btn')].find(b=>b.textContent.includes('新建分支')).click(); true");
    await poll("Boolean(document.querySelector('.prompt-field input'))", "新建分支对话框");
    await evaluate("(()=>{const input=document.querySelector('.prompt-field input');input.value='feature/new-ui';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form.modal').requestSubmit();return true})()");
    await poll("window.__piDesktop.workbench.active.value.branch === 'feature/new-ui'", "对话框新建并切换分支");
    assert.equal((await readFile(path.join(dir, "a.txt"), "utf8")).replace(/\r\n/g, "\n"), "one\n");
    // 运行中的 Agent 任务不得在脚下切换分支；不发送任何模型请求。
    await evaluate("window.__piDesktop.workbench.active.value.streaming=true; true");
    assert(await evaluate("window.__piDesktop.workbench.gitAction('switchBranch',{branch:'refs/heads/main'}).then(()=>false,()=>true)"), "运行任务应阻止分支切换");
    await evaluate("window.__piDesktop.workbench.active.value.streaming=false; true");

    await writeFile(path.join(dir, "a.txt"), "two\n"); await git(["add", "a.txt"]);
    await writeFile(path.join(dir, "a.txt"), "three\n");
    await writeFile(path.join(dir, "中文 空格.txt"), "new\n");
    // 深层目录用于验证层级缩进。每层至少要有一个兄弟节点，否则单链目录会被折叠成一行。
    await mkdir(path.join(dir, "nested/a/b/c"), { recursive: true });
    await writeFile(path.join(dir, "nested/a/one.txt"), "one\n");
    await writeFile(path.join(dir, "nested/a/b/two.txt"), "two\n");
    await writeFile(path.join(dir, "nested/a/b/c/three.txt"), "three\n");
    await tab("更改"); await refresh();
    await poll("document.querySelectorAll('.git-group').length === 3", "已暂存 / 未暂存 / 未跟踪分区");
    const names = await evaluate("[...document.querySelectorAll('.git-group-name')].map(e=>e.textContent)");
    assert.deepEqual(names, ["已暂存", "未暂存", "未跟踪"]);
    // 操作按钮必须整体隐藏，不能留下截图中的一排空白背景块。
    await evaluate("window.__piDesktop.workbench.setPanelWidth(290); true");
    await wait(200);
    assert(await evaluate("[...document.querySelectorAll('.git-row-actions')].some(e=>getComputedStyle(e).display==='none')"), "非悬停操作栏不应留下背景块");
    assert(await evaluate("document.querySelector('.git-panel').scrollWidth <= document.querySelector('.git-panel').clientWidth"), "290px 面板不应出现横向溢出");
    // 层级缩进：同一深度对齐，逐层恒定右移；文件与同级目录的图标列一致；
    // 第一层必须相对分区标题右移（否则看起来和「未暂存」同列）。
    const geometry = await evaluate(`(() => {
      const tree = document.querySelector('.git-tree');
      const base = tree.getBoundingClientRect().left;
      const off = node => node ? Math.round(node.getBoundingClientRect().left - base) : null;
      const groupCaret = off(document.querySelector('.git-group-toggle .git-caret'));
      return {
        groupCaret,
        rows: [...document.querySelectorAll('.git-tree-row')].map(row => ({
          depth: Number(row.style.getPropertyValue('--depth') || 0),
          folder: row.classList.contains('folder'),
          caret: off(row.querySelector('.git-caret')),
          icon: off(row.querySelector('.git-file-icon')),
          name: off(row.querySelector('.git-tree-name')),
        })),
      };
    })()`);
    assert(geometry.rows.length, "应渲染出树行");
    const groupCaret = geometry.groupCaret;
    const treeRows = geometry.rows;
    const byDepth = new Map();
    for (const row of treeRows) {
      if (row.name === null) continue;
      if (!byDepth.has(row.depth)) byDepth.set(row.depth, []);
      byDepth.get(row.depth).push(row);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    assert(depths.length >= 3, "深层目录应产生至少三层缩进");
    for (const [depth, list] of byDepth) {
      const names = new Set(list.map(row => row.name));
      assert.equal(names.size, 1, `深度 ${depth} 的名字列必须对齐：${[...names].join('/')}`);
      const icons = new Set(list.map(row => row.icon));
      assert.equal(icons.size, 1, `深度 ${depth} 的图标列必须对齐（文件与目录一致）`);
    }
    for (let i = 1; i < depths.length; i += 1) {
      const step = byDepth.get(depths[i])[0].name - byDepth.get(depths[i - 1])[0].name;
      assert.equal(step, 20, `层级缩进应恒定 20px，实际 ${step}px（深度 ${depths[i - 1]} → ${depths[i]}）`);
    }
    // 第一层树行必须比分区标题的箭头明显右移，且从分区文字列开始。
    const firstCaret = byDepth.get(depths[0])[0].caret;
    assert(firstCaret - groupCaret >= 16, `第一层应相对分区标题右移，实际 ${firstCaret - groupCaret}px`);
    assert(firstCaret <= byDepth.get(depths[0])[0].name - 24, "第一层箭头应仍位于其名称左侧");
    assert(await evaluate("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]').length === 2"), "同一文件有索引及工作区修改时应分开呈现");
    await evaluate("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[0].click(); true");
    await poll("window.__piDesktop.stage.activeTab.value?.data.detail?.diff.includes('+two')", "已暂存 diff");
    assert(!(await evaluate("window.__piDesktop.stage.activeTab.value.data.detail.diff.includes('+three')")), "暂存详情不能混入工作区修改");
    await evaluate("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[1].click(); true");
    await poll("window.__piDesktop.stage.activeTab.value?.data.detail?.diff.includes('+three')", "未暂存 diff");
    await evaluate("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[1].querySelector('button[title=\"暂存此文件\"]').click(); true");
    await poll("document.querySelectorAll('.git-group').length === 2", "单文件暂存移入索引分区");
    await tab("分支");
    await poll("Boolean(document.querySelector('.git-branch-row[aria-label=\"切换分支 main\"]'))", "有改动时分支入口");
    await switchTo("main"); await wait(150);
    assert.equal(await evaluate("window.__piDesktop.workbench.active.value.branch"), "feature/new-ui", "脏工作区不得切换分支");
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "three\n");
    await tab("快照");
    await poll("document.querySelector('.git-view-hint')?.textContent.includes('不代表当前 Git 状态')", "快照与实时改动分离");
    await tab("历史");
    await poll("document.querySelectorAll('.git-commit-row').length > 0", "提交历史入口");
    assert(await evaluate("[...document.querySelectorAll('.git-view-tabs button')].length === 5"), "五个可发现的视图入口");
    console.log("[git-ui] PASS 分区导航 / 本地分支切换 / 新建分支 / 草稿与运行任务保护 / 真实分区 Diff / 单文件暂存 / 中文路径");
  } finally {
    await evaluate("window.__piDesktop.workbench.active.value.streaming=false; window.__piDesktop.stage.clear(); true");
    await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(previous.cwd)}).then(()=>true)`);
    await evaluate(`window.__piDesktop.workbench.state.activePanelId=${JSON.stringify(previous.panel)};window.__piDesktop.workbench.setPanelWidth(${previous.width});true`);
    await evaluate(`window.__piDesktop.workbench.removeProject(${literal}).then(()=>true)`);
    await rm(dir, { recursive: true, force: true });
  }
}
