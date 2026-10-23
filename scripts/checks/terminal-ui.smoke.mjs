/** 终端主题下拉和窄对话布局回归；不执行菜单中的命令，不请求模型。 */
export async function checkTerminalUiInElectron(win) {
  const evaluate = (expression) => win.webContents.executeJavaScript(expression, true);
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const assert = (ok, label) => { if (!ok) throw new Error(`终端界面回归：${label}`); };
  const poll = async (expression, label) => {
    for (let i = 0; i < 30; i++) {
      if (await evaluate(expression)) return;
      await wait();
    }
    throw new Error(`终端界面回归超时：${label}`);
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait();
  };
  const original = await evaluate(`({
    theme: document.documentElement.dataset.theme,
    input: window.__piDesktop.terminal.state.input,
    profile: window.__piDesktop.settings.settings.terminalProfile,
    count: window.__piDesktop.terminal.state.tasks.length
  })`);
  try {
    await evaluate("window.__piDesktop.settings.close(); window.__piDesktop.terminal.show(); true");
    await poll("document.querySelector('.terminal-profile-picker .terminal-select-btn')", "shell 菜单触发按钮");
    // ArrowUp 必须定位最后一项，而不是在浮层尚未挂载时读取空列表。
    await evaluate("document.querySelector('.terminal-profile-picker .terminal-select-btn').focus(); true");
    await key("Up");
    await poll("document.activeElement?.classList.contains('action')", "↑ 打开并聚焦终端设置项");
    await key("Home");
    assert(await evaluate("document.activeElement === document.querySelector('.terminal-select-item')"), "Home 到首项");
    await key("End");
    assert(await evaluate("document.activeElement === [...document.querySelectorAll('.terminal-select-item')].at(-1)"), "End 到末项");
    await key("Escape");
    assert(await evaluate("!document.querySelector('.terminal-select-menu') && document.activeElement?.closest('.terminal-profile-picker')"), "Esc 撤掉浮层并恢复触发按钮焦点");

    for (const theme of ["dark", "light"]) {
      await evaluate(`window.__piDesktop.workbench.setTheme(${JSON.stringify(theme)}); document.querySelector('.terminal-profile-picker .terminal-select-btn').click(); true`);
      await poll("document.querySelector('.terminal-select-menu')", "主题菜单出现");
      await poll(`(() => {
        const menu = document.querySelector('.terminal-select-menu');
        const r = menu.getBoundingClientRect();
        return menu.parentElement === document.body && r.left >= 0 && r.right <= innerWidth
          && r.top >= 0 && r.bottom <= innerHeight
          && getComputedStyle(menu).backgroundColor === getComputedStyle(document.querySelector('.composer')).backgroundColor;
      })()`, `${theme} 菜单跟随主题、不被终端裁切且处于视口内`);
      await key("Escape");
    }
    // 收起和 KeepAlive 停用时，不得让传送到 body 的浮层残留。
    await evaluate("document.querySelector('.terminal-profile-picker .terminal-select-btn').click(); true");
    await poll("document.querySelector('.terminal-select-menu')", "收起前菜单出现");
    await evaluate("window.__piDesktop.terminal.hide(); true");
    await poll("!document.querySelector('.terminal-select-menu')", "收起终端移除浮层");
    await evaluate("window.__piDesktop.terminal.show(); true");
    await wait();
    await evaluate("document.querySelector('.terminal-profile-picker .terminal-select-btn').click(); true");
    await poll("document.querySelector('.terminal-select-menu')", "停用前菜单出现");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', false).then(() => true)");
    await poll("!document.querySelector('.terminal-select-menu')", "停用插件移除浮层");
    await evaluate("window.__piDesktop.plugins.setEnabled('terminal', true).then(() => true)");
    await new Promise(resolve => setTimeout(resolve, 300));
    await evaluate("window.__piDesktop.terminal.show(); true");
    await new Promise(resolve => setTimeout(resolve, 300));

    // 菜单中的设置项也要关闭列表，不能越过模态框的遮罩层。
    await evaluate("document.querySelector('.terminal-profile-picker .terminal-select-btn').click(); true");
    await poll("document.querySelector('.terminal-select-item.action')", "终端设置项");
    await evaluate("document.querySelector('.terminal-select-item.action').click(); true");
    await poll("window.__piDesktop.settings.modal.open && !document.querySelector('.terminal-select-menu')", "设置弹窗不残留菜单");
    await evaluate("window.__piDesktop.settings.close(); true");
    await wait();

    // 历史选择只填草稿，不能执行、增加任务或改默认 shell。
    await evaluate("document.querySelector('.terminal-history-picker .terminal-select-btn').click(); true");
    await poll("document.querySelector('.terminal-select-item')", "历史菜单出现");
    assert(await evaluate("document.querySelector('.terminal-select-menu').getBoundingClientRect().bottom < document.querySelector('.terminal-history-picker').getBoundingClientRect().top"), "历史菜单向上展开");
    const command = await evaluate("document.querySelector('.terminal-select-item').dataset.value");
    await evaluate("document.querySelector('.terminal-select-item').click(); true");
    await poll(`window.__piDesktop.terminal.state.input === ${JSON.stringify(command)}`, "历史命令填入输入框");
    assert(await evaluate(`window.__piDesktop.terminal.state.tasks.length === ${original.count} && window.__piDesktop.settings.settings.terminalProfile === ${JSON.stringify(original.profile)}`), "历史菜单不执行命令、不修改配置");
    assert(await evaluate("document.activeElement?.classList.contains('terminal-input')"), "选历史后聚焦命令框");
    await evaluate("document.querySelector('.terminal-history-picker .terminal-select-btn').click(); true");
    await poll("document.querySelector('.terminal-select-menu')", "历史菜单键盘关闭");
    await key("Tab");
    assert(await evaluate("!document.querySelector('.terminal-select-menu') && document.activeElement?.classList.contains('terminal-run-btn')"), "Tab 恢复工具栏自然焦点顺序");

    // 宽度由容器决定，模拟实际对话区的 260/300/470/760px，而不是仅改窗口宽度。
    const layout = await evaluate(`(() => {
      const source = document.querySelector('.composer textarea');
      const root = document.createElement('section');
      root.className = 'area-chat';
      root.style.cssText = 'position:fixed;left:8px;top:8px;height:auto;z-index:70';
      root.innerHTML = '<div class="changes-bar"><button class="changes-bar-main"><span class="changes-bar-icon">↗</span><strong>123 个文件已变更</strong><span class="diff-stat"><b class="add">+9999</b><b class="del">−9999</b></span><span class="changes-bar-files"><span class="changes-chip">TerminalDock.vue</span></span><span class="changes-bar-more">在右侧查看改动</span></button></div><button class="activity-head"><span class="activity-caret">›</span><span class="activity-icon">⌁</span><span class="activity-title">活动</span><span class="activity-count">20 工具 · 20 思考</span><span class="activity-summary">运行很长的命令说明</span></button><div class="composer-wrap"><div class="composer"><textarea placeholder="继续这个任务，输入 / 使用命令"></textarea><div class="composer-bar">工具栏</div></div></div>';
      root.querySelector('textarea').placeholder = source.placeholder;
      document.body.append(root);
      try {
        return [260, 300, 470, 760].map(width => {
          root.style.width = width + 'px';
          const button = root.querySelector('.changes-bar-main');
          const strong = button.querySelector('strong');
          const r = button.getBoundingClientRect();
          const visible = [...button.children].filter(el => getComputedStyle(el).display !== 'none');
          return { width, barHeight: r.height,
            labelHeight: strong.getBoundingClientRect().height,
            contained: visible.every(el => el.getBoundingClientRect().right <= r.right && el.getBoundingClientRect().bottom <= r.bottom),
            noWrap: getComputedStyle(strong).whiteSpace === 'nowrap',
            placeholder: width > 360 || parseFloat(getComputedStyle(root.querySelector('textarea')).minHeight) >= 64,
            activity: root.querySelector('.activity-head').scrollWidth <= root.querySelector('.activity-head').clientWidth
          };
        });
      } finally { root.remove(); }
    })()`);
    assert(layout.every(r => r.barHeight === 30 && r.labelHeight < r.barHeight && r.contained && r.noWrap && r.placeholder && r.activity), `窄对话变更条 / 活动 / 占位文案：${JSON.stringify(layout)}`);
    console.log("[terminal-ui] PASS 深浅主题下拉 / 边界定位 / 键盘 / 历史填入 / 浮层生命周期 / 窄对话布局");
  } finally {
    await evaluate(`window.__piDesktop.settings.close(); window.__piDesktop.workbench.setTheme(${JSON.stringify(original.theme)}); window.__piDesktop.terminal.state.input = ${JSON.stringify(original.input)}; true`);
  }
}
