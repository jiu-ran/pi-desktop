import { fileURLToPath } from "node:url";

/** Electron 真机终端检查，复用不调用模型的全屏 fixture。 */
export async function checkTerminalInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const poll = async (expression, label, timeout = 12000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = await evaluate(expression);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const detail = await evaluate(`JSON.stringify({
      screens: [...document.querySelectorAll('.terminal-xterm')].map(el => ({id:el.dataset.taskId, ready:el.dataset.terminalReady,cols:el.dataset.cols,rows:el.dataset.rows,text:el.textContent.slice(-500),display:getComputedStyle(el).display,rect:el.getBoundingClientRect().toJSON(),visibility:document.visibilityState,rows:el.querySelector('.xterm-rows')?.innerHTML.slice(0,200)})),
      tasks: window.__piDesktop.terminal.state.tasks.map(t => ({id:t.id,status:t.status,output:t.output.slice(-700)})),
      open:window.__piDesktop.terminal.state.open,enabled:window.__piDesktop.terminal.state.enabled
    })`);
    console.log("[terminal diagnostic]", detail);
    const shot = await win.webContents.capturePage();
    await (await import('node:fs/promises')).writeFile((await import('node:path')).join((await import('node:os')).tmpdir(), 'pi-smoke-terminal-failure.png'), shot.toPNG());
    throw new Error(`终端冒烟超时：${label}`);
  };
  const write = (id, text) => evaluate(`window.__piDesktop.terminal.writePty(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
  const task = (id) => `window.__piDesktop.terminal.state.tasks.find(t => t.id === ${JSON.stringify(id)})`;
  const selector = (id) => `.terminal-xterm[data-task-id="${id}"]`;
  const dimsMatch = (id) => `(async () => {
    const el = document.querySelector(${JSON.stringify(selector(id))});
    const local = ${task(id)};
    const remote = (await window.piDesktop.terminalTasks()).find(t => t.id === ${JSON.stringify(id)});
    return el?.dataset.terminalReady === 'true' && Number(el.dataset.cols) === remote?.cols
      && Number(el.dataset.rows) === remote?.rows && local?.cols === remote?.cols && local?.rows === remote?.rows;
  })()`;
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await new Promise((resolve) => setTimeout(resolve, 120));
  };

  try {
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', false).then(() => true)");
    const disabled = await evaluate("!window.__piDesktop.terminal.state.enabled && !document.querySelector('.tb-terminal-btn') && !window.__piDesktop.commands.some(c => c.id === 'terminal.toggle')");
    if (!disabled) throw new Error("停用终端插件后仍存在入口 / 快捷命令");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', true).then(() => true)");
    // 不继承上次失败/手工调试留下的最小高度，fixture 至少需要 7 行完整显示。
    await evaluate("window.__piDesktop.terminal.setHeight(360); true");
    await evaluate("window.__piDesktop.terminal.startPty(80, 24).then(() => true)");
    const first = await evaluate("window.__piDesktop.terminal.activeTask.value.id");
    await poll(dimsMatch(first), "初始屏幕 / 宿主尺寸同步");
    await evaluate(`window.__ptySmokeScreen = document.querySelector(${JSON.stringify(selector(first))}); true`);
    const fixture = fileURLToPath(new URL("./terminal-pty.fixture.cjs", import.meta.url));
    const command = `node "${fixture}"`;
    await write(first, `${command}\r`);
    await poll(`${task(first)}?.output.includes('PTY-PROBE-READY')`, "全屏程序启动");
    await poll(`document.querySelector(${JSON.stringify(selector(first))})?.textContent.includes('PTY-PROBE-READY')`, "xterm 全屏渲染");
    await evaluate(`document.querySelector(${JSON.stringify(`${selector(first)} textarea`)})?.focus(); true`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await key("Up");
    await poll(`${task(first)}?.output.includes('PTY-HEX:1b5b41')`, "方向键原样发送");
    // 全屏程序未协商鼠标协议时，滚轮不能走 xterm 默认的 ↑/↓ 模拟。
    const beforeWheel = await evaluate(`${task(first)}.output.length`);
    const wheelAt = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector(first))}).getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    win.webContents.sendInputEvent({ type: "mouseWheel", ...wheelAt, deltaY: 120, canScroll: true });
    await poll(`${task(first)}.output.slice(${beforeWheel}).includes('PTY-HEX:1b5b357e')`, "上滑变为内容翻页而不是命令历史");
    const afterUp = await evaluate(`${task(first)}.output.length`);
    await new Promise(resolve => setTimeout(resolve, 150));
    win.webContents.sendInputEvent({ type: "mouseWheel", ...wheelAt, deltaY: -120, canScroll: true });
    await poll(`${task(first)}.output.slice(${afterUp}).includes('PTY-HEX:1b5b367e')`, "下滑变为内容翻页");
    await key("Tab");
    await poll(`${task(first)}?.output.includes('PTY-HEX:09')`, "Tab 原样发送");
    await key("W", ["control"]);
    await poll(`${task(first)}?.output.includes('PTY-HEX:17')`, "Ctrl+W 不关窗口、不关闭编辑器标签");

    await evaluate("window.__piDesktop.terminal.hide(); true");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await evaluate("window.__piDesktop.terminal.show(); true");
    await poll(`document.querySelector(${JSON.stringify(selector(first))}) === window.__ptySmokeScreen`, "收起展开不重建屏幕");

    await evaluate("window.__piDesktop.terminal.startPty(80, 24).then(() => true)");
    const second = await evaluate("window.__piDesktop.terminal.activeTask.value.id");
    await poll(dimsMatch(second), "第二个终端尺寸同步");
    await write(first, "\u001b[B");
    await poll(`${task(first)}?.output.includes('PTY-HEX:1b5b42')`, "隐藏会话继续接收独立输出");
    const mixed = await evaluate(`${task(second)}?.output.includes('PTY-HEX:1b5b42')`);
    if (mixed) throw new Error("终端输入被发给了另一个会话");
    await evaluate(`window.__piDesktop.terminal.select(${JSON.stringify(first)}); true`);
    await poll(`document.querySelector(${JSON.stringify(selector(first))}) === window.__ptySmokeScreen`, "多终端切换保留屏幕");

    const initialRows = await evaluate(`${task(first)}.rows`);
    await evaluate("window.__piDesktop.terminal.setHeight(160); true");
    await poll(`${task(first)}.rows < ${initialRows}`, "终端缩小实际行数");
    await poll(dimsMatch(first), "最小高度同步尺寸");
    const minimumRows = await evaluate(`${task(first)}.rows`);
    await evaluate("window.__piDesktop.terminal.setHeight(360); true");
    await poll(`${task(first)}.rows > ${minimumRows}`, "终端增高实际行数");
    await poll(dimsMatch(first), "增高终端同步尺寸");
    await poll(`${task(first)}?.output.includes('PTY-RESIZE:')`, "全屏程序收到 resize");
    await evaluate(`document.querySelector(${JSON.stringify(`${selector(first)} textarea`)})?.focus(); true`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // 终端打开时，底部输入框仍可运行一次性后台命令；不能抢走终端视图，也不能发进 PTY。
    const backgroundCommand = "echo BG-ONCE-OK";
    await evaluate(`(() => {
      const input = document.querySelector('.terminal-input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(backgroundCommand)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    await poll(`(() => {
      const t = window.__piDesktop.terminal.state.tasks.find(t => !t.pty && t.command.includes('BG-ONCE-OK'));
      return t && t.status !== 'running' && t.status !== 'stopping' && t.output.includes('BG-ONCE-OK');
    })()`, "终端打开时运行一次性后台命令");
    const keptView = await evaluate(`window.__piDesktop.terminal.activeTask.value.id === ${JSON.stringify(first)} && window.__piDesktop.terminal.state.input === ''`);
    if (!keptView) throw new Error("后台命令抢走了终端视图或未清空输入");
    const onceTask = await evaluate(`window.__piDesktop.terminal.state.tasks.find(t => !t.pty && t.command.includes('BG-ONCE-OK'))?.id`);
    await evaluate(`window.__piDesktop.terminal.select(${JSON.stringify(onceTask)}); true`);
    await poll(`document.querySelector('.terminal-input') !== null`, "后台命令也保留命令输入框");
    await evaluate(`window.__piDesktop.terminal.select(${JSON.stringify(first)}); true`);
    await poll(`window.__ptySmokeScreen?.getBoundingClientRect().width > 0`, "回到终端视图");
    await evaluate(`document.querySelector(${JSON.stringify(`${selector(first)} textarea`)})?.focus(); true`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    await key("C", ["control"]);
    await poll(`${task(first)}?.output.includes('PTY-CTRL-C')`, "Ctrl+C 中断全屏程序");
    if (!await evaluate(`${task(first)}?.status === 'running'`)) throw new Error("Ctrl+C 错误地结束了外层 shell");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', false).then(() => true)");
    if (!await evaluate(`${task(first)}?.status === 'running'`)) throw new Error("插件停用不应强制结束已有终端");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', true).then(() => true)");
    await poll(`document.querySelector(${JSON.stringify(selector(first))}) === window.__ptySmokeScreen`, "插件重新启用保留屏幕");
    console.log("[terminal] PASS 可选插件 / PTY / 全屏渲染 / 方向键与滚轮区分 / Tab / Ctrl+W / 多会话 / resize / 后台命令 / Ctrl+C");
  } finally {
    await evaluate(`(async () => {
      const api = window.__piDesktop.terminal;
      for (const task of [...api.state.tasks]) if (task.status === 'running') await api.stop(task.id);
      await window.piDesktop.setTerminalFocus(false);
      delete window.__ptySmokeScreen;
      return true;
    })()`);
    await poll("window.__piDesktop.terminal.state.tasks.every(t => t.status !== 'running' && t.status !== 'stopping')", "终端进程回收");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', false).then(() => true)");
  }
}
