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
  /** 等目标节点出现后再点击：界面重渲染时裸 click 会抛 "reading 'click'"，表现为整套冒烟偶发失败。 */
  const click = async (expression, label) => {
    for (let i = 0; i < 150; i += 1) {
      const done = await evaluate(`(() => { const node = ${expression}; if (!node) return false; node.click(); return true; })()`);
      if (done) return;
      await wait(100);
    }
    throw new Error(`点击超时：${label}`);
  };
  const tab = name => click(
    `[...document.querySelectorAll('.git-view-tabs button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)}))`,
    `视图 ${name}`,
  );
  const switchTo = name => click(
    `document.querySelector(${JSON.stringify(`.git-branch-row[aria-label="切换分支 ${name}"]`)})`,
    `切换分支 ${name}`,
  );
  const refresh = () => click(`document.querySelector('.git-sc-toolbar button[title="刷新"]')`, "刷新");
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

    await click("[...document.querySelectorAll('.git-branches .btn')].find(b=>b.textContent.includes('新建分支'))", "新建分支按钮");
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
    // 层级引导线：每个非根行的引导线数量应等于其深度，嵌套关系才看得出来。
    const railCount = await evaluate("[...document.querySelectorAll('.git-tree-row')].reduce((sum, row) => sum + row.querySelectorAll('.git-rail').length, 0)");
    assert.equal(
      railCount,
      treeRows.reduce((sum, row) => sum + row.depth, 0),
      `引导线数量应等于各层深度之和，实际 ${railCount}`,
    );
    // 提交框：不允许手动拖拽改变高度（不能出现 resize 手柄），改为随内容自动增高并受上限约束。
    const commitBox = await evaluate(`(() => {
      const el = document.querySelector('.git-commit-input');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        resize: style.resize,
        maxHeight: Number.parseFloat(style.maxHeight) || 0,
        before: Math.round(el.getBoundingClientRect().height),
      };
    })()`);
    assert(commitBox, "应存在提交消息输入框");
    assert.equal(commitBox.resize, "none", "提交框不应保留鼠标拖拽缩放的 resize 手柄");
    const commitGrown = await evaluate(`(() => {
      const el = document.querySelector('.git-commit-input');
      el.value = Array.from({ length: 40 }, (_, i) => \`第 \${i} 行提交说明\`).join("\\n");
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert(commitGrown, "应能输入多行提交消息");
    await wait(200);
    const commitSized = await evaluate(`(() => {
      const el = document.querySelector('.git-commit-input');
      const height = Math.round(el.getBoundingClientRect().height);
      const max = Number.parseFloat(getComputedStyle(el).maxHeight) || 0;
      el.value = "";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { height, max };
    })()`);
    assert(commitSized.height > commitBox.before, `输入多行后提交框应自动增高：${commitBox.before} → ${commitSized.height}`);
    assert(commitSized.max > 0 && commitSized.height <= commitSized.max + 1, `提交框高度应受上限约束：${commitSized.height} > ${commitSized.max}`);
    await wait(120);
    // 分区标题必须与子行用不同颜色区分（标题是「标签」层，子行才是内容）。
    const palette = await evaluate(`(() => {
      const color = (selector) => {
        const node = document.querySelector(selector);
        return node ? getComputedStyle(node).color : null;
      };
      return {
        header: color('.git-group-name'),
        folder: color('.git-tree-row.folder .git-tree-name'),
        file: color('.git-tree-row:not(.folder) .git-tree-name'),
      };
    })()`);
    assert(palette.header && palette.folder && palette.file, "分区标题与子行都应可测量颜色");
    assert.notEqual(palette.header, palette.file, "分区标题不能与文件行同色");
    assert.notEqual(palette.header, palette.folder, "分区标题不能与目录行同色");
    // 第一层树行与分区标题左对齐（靠字号区分层级，而不是靠缩进）。
    const firstCaret = byDepth.get(depths[0])[0].caret;
    assert(Math.abs(firstCaret - groupCaret) <= 2, `第一层应与分区标题对齐，实际相差 ${firstCaret - groupCaret}px`);
    // 分区标题字号必须明显大于树行，作为「大标题」区分层级。
    const typography = await evaluate(`(() => {
      const header = document.querySelector('.git-group-toggle');
      const row = document.querySelector('.git-tree-row .git-tree-name');
      return {
        header: header ? parseFloat(getComputedStyle(header).fontSize) : null,
        row: row ? parseFloat(getComputedStyle(row).fontSize) : null,
      };
    })()`);
    assert(typography.header && typography.row, "分区标题与树行字号都应可测量");
    assert(
      typography.header - typography.row >= 2,
      `分区标题应明显大于子行：${typography.header}px vs ${typography.row}px`,
    );
    assert(await evaluate("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]').length === 2"), "同一文件有索引及工作区修改时应分开呈现");
    await click("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[0]", "已暂存 a.txt 行");
    await poll("window.__piDesktop.stage.activeTab.value?.data.detail?.diff.includes('+two')", "已暂存 diff");
    assert(!(await evaluate("window.__piDesktop.stage.activeTab.value.data.detail.diff.includes('+three')")), "暂存详情不能混入工作区修改");
    await click("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[1]", "未暂存 a.txt 行");
    await poll("window.__piDesktop.stage.activeTab.value?.data.detail?.diff.includes('+three')", "未暂存 diff");
    await click("document.querySelectorAll('.git-tree-row[title=\"a.txt\"]')[1]?.querySelector('button[title=\"暂存此文件\"]')", "单文件暂存按钮");
    await poll("document.querySelectorAll('.git-group').length === 2", "单文件暂存移入索引分区");
    await tab("分支");
    await poll("Boolean(document.querySelector('.git-branch-row[aria-label=\"切换分支 main\"]'))", "有改动时分支入口");
    await switchTo("main"); await wait(150);
    assert.equal(await evaluate("window.__piDesktop.workbench.active.value.branch"), "feature/new-ui", "脏工作区不得切换分支");
    assert.equal(await readFile(path.join(dir, "a.txt"), "utf8"), "three\n");
    await tab("快照");
    await poll("document.querySelector('.git-view-hint')?.textContent.includes('不代表当前 Git 状态')", "快照与实时改动分离");
    // 快照分区已由标题表明「非实时」，行内不再重复「快照」标记。
    const snapshotMarkers = await evaluate(`(() => ({
      name: document.querySelector('.git-group-name')?.textContent?.trim() ?? "",
      badges: document.querySelectorAll('.git-group .git-tree-badge').length,
      dots: document.querySelectorAll('.git-group .git-agent-dot').length,
      rows: document.querySelectorAll('.git-tree-row').length,
    }))()`);
    if (snapshotMarkers.rows > 0) {
      assert.equal(snapshotMarkers.name, "会话快照", "快照分区标题应精简为「会话快照」");
      assert.equal(snapshotMarkers.badges, 0, "快照行不应重复各自的「快照」标记");
      assert.equal(snapshotMarkers.dots, 0, "快照行不应再显示 Agent 圆点");
    }
    await tab("历史");
    await poll("document.querySelectorAll('.git-commit-row').length > 0", "提交历史入口");
    assert(await evaluate("[...document.querySelectorAll('.git-view-tabs button')].length === 5"), "五个可发现的视图入口");
    // 评审评论框：diff 里有超长行时，评论框和「取消 / 添加」按钮必须留在可视区域内，
    // 不能跟着内容宽度一起被推到屏幕右边（以前只能靠加宽窗口才点得到）。
    await writeFile(path.join(dir, "wide.txt"), `${"x".repeat(400)}
`);
    await git(["add", "wide.txt"]);
    await tab("更改");
    await refresh();
    await poll("Boolean(document.querySelector('.git-tree-row[title=\"wide.txt\"]'))", "长行文件进入暂存区");
    await click("document.querySelector('.git-tree-row[title=\"wide.txt\"]')", "打开长行文件 diff");
    await poll("Boolean(document.querySelector('.diff-view .diff-row'))", "长行 diff 渲染");
    const reviewGeometry = await evaluate(`(() => {
      const view = document.querySelector('.diff-view');
      const body = document.querySelector('.diff-body');
      document.querySelector('.diff-comment-add')?.click();
      return JSON.stringify({
        viewWidth: Math.round(view.clientWidth),
        bodyWidth: Math.round(body.getBoundingClientRect().width),
      });
    })()`);
    await poll("Boolean(document.querySelector('.diff-comment-composer'))", "评论输入框出现");
    const composerGeometry = await evaluate(`(() => {
      const view = document.querySelector('.diff-view').getBoundingClientRect();
      const box = document.querySelector('.diff-comment-composer').getBoundingClientRect();
      const primary = document.querySelector('.diff-comment-actions .btn.primary').getBoundingClientRect();
      const area = document.querySelector('.diff-comment-composer textarea');
      const before = Math.round(area.getBoundingClientRect().height);
      const placeholderClipped = area.scrollHeight > area.clientHeight + 1;
      area.value = ["第一行", "第二行", "第三行", "第四行"].join(String.fromCharCode(10));
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({
        viewWidth: Math.round(view.width),
        viewRight: Math.round(view.right),
        boxWidth: Math.round(box.width),
        boxLeft: Math.round(box.left),
        primaryRight: Math.round(primary.right),
        before,
        resize: getComputedStyle(area).resize,
        placeholderClipped,
      });
    })()`);
    await wait(250);
    const composerAfter = await evaluate(
      "Math.round(document.querySelector('.diff-comment-composer textarea').getBoundingClientRect().height)",
    );
    const wideDiff = JSON.parse(reviewGeometry);
    const composer = JSON.parse(composerGeometry);
    assert(wideDiff.bodyWidth > wideDiff.viewWidth + 50, "该用例必须真的出现横向溢出的长行");
    assert(
      Math.abs(composer.boxWidth - composer.viewWidth) <= 2,
      `评论框宽度应等于可视宽度：${composer.boxWidth} vs ${composer.viewWidth}`,
    );
    assert(composer.boxLeft >= 0, "评论框不能被推到视口左侧之外");
    assert(
      composer.primaryRight <= composer.viewRight + 1,
      `「添加」按钮必须留在可视区域内：${composer.primaryRight} > ${composer.viewRight}`,
    );
    assert.equal(composer.resize, "none", "评论框不应保留手拖缩放手柄");
    assert(!composer.placeholderClipped, "占位文案不能被裁掉");
    assert(composerAfter > composer.before, `输入多行后评论框应自动增高：${composer.before} → ${composerAfter}`);
    await evaluate("document.querySelector('.diff-comment-actions .btn')?.click(); true");

    console.log("[git-ui] PASS 分区导航 / 本地分支切换 / 新建分支 / 草稿与运行任务保护 / 真实分区 Diff / 单文件暂存 / 评审评论框自适应 / 中文路径");
  } finally {
    await evaluate("window.__piDesktop.workbench.active.value.streaming=false; window.__piDesktop.stage.clear(); true");
    await evaluate(`window.__piDesktop.workbench.open(${JSON.stringify(previous.cwd)}).then(()=>true)`);
    await evaluate(`window.__piDesktop.workbench.state.activePanelId=${JSON.stringify(previous.panel)};window.__piDesktop.workbench.setPanelWidth(${previous.width});true`);
    await evaluate(`window.__piDesktop.workbench.removeProject(${literal}).then(()=>true)`);
    await rm(dir, { recursive: true, force: true });
  }
}
