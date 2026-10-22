import { defineAsyncComponent } from "vue";
import { definePlugin } from "../../kernel/plugin-manager.ts";
import { openSettingsModal } from "../../services/settings.ts";
import { pushToast } from "../../services/extension-ui.ts";
import { icons } from "../../shared/util.ts";

/** 用户主动选择启用；xterm 与停靠界面仅在首次启用时按需加载。 */
export default definePlugin({
  id: "terminal",
  name: "终端与后台任务",
  description: "可选的完整 PTY 终端与后台任务；支持切换系统 shell、pwsh、Git Bash 等。停用隐藏入口，已有任务继续在后台运行。",
  version: "0.3.0",
  icon: icons.terminal,
  order: 60,
  area: "shell",
  core: false,
  defaultEnabled: false,
  dock: defineAsyncComponent(() => import("../../components/terminal/TerminalDock.vue")),
  activate(ctx) {
    const terminal = ctx.terminal;
    if (!terminal) throw new Error("终端服务不可用");
    terminal.setEnabled(true);
    ctx.registerCommand({
      id: "terminal.toggle",
      title: "切换终端与后台任务",
      category: "终端",
      keybinding: "Ctrl+`",
      run: () => terminal.toggle(),
    });
    ctx.registerCommand({
      id: "terminal.new",
      title: "新建默认终端",
      category: "终端",
      run: () => terminal.startPty(),
    });
    ctx.registerCommand({
      id: "terminal.settings",
      title: "配置默认终端与启动参数",
      category: "终端",
      run: () => openSettingsModal("terminal"),
    });
    ctx.onDispose(() => {
      const wasEnabled = terminal.state.enabled;
      terminal.setEnabled(false);
      if (wasEnabled && (terminal.runningCount.value || terminal.state.starting)) {
        const detail = terminal.runningCount.value ? `${terminal.runningCount.value} 个任务仍在后台运行` : "已请求的任务仍在启动";
        pushToast("warning", `终端插件已停用，${detail}；重新启用可查看或结束任务`);
      }
    });
  },
});
