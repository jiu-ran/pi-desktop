import { createEventBus } from "./event-bus.ts";
import { createStage } from "./stage.ts";
import { createPluginManager, type PluginCommand, type PluginContext, type SidebarPlugin } from "./plugin-manager.ts";
import { createWorkbench } from "./workbench.ts";
import { setupTheme } from "../services/theme.ts";
import { setupWindowChrome } from "../services/window-chrome.ts";
import { createBuiltinSlashCommands } from "../services/slash-commands.ts";
import { setupExtensionUi } from "../services/extension-ui.ts";
import { createCommandRegistry, paletteState } from "../services/command-palette.ts";
import { appSettings, openSettingsModal, setupSettings } from "../services/settings.ts";
import { createTerminalService } from "../services/terminal.ts";
import { saveFileTab } from "../plugins/files/save.ts";
import type { FileStageData } from "../plugins/files/state.ts";
import type { StageTab } from "./stage.ts";
import { askConfirm } from "../components/sidebar/ui.ts";

export const KERNEL_KEY = Symbol("pi-desktop-kernel");

/** 文件页签记录打开时的项目目录，用于按项目收敛未保存草稿。 */
function tabCwd(tab: StageTab): string {
  return String((tab.data as { cwd?: string } | undefined)?.cwd ?? "");
}

export function createKernel({ host = typeof window !== "undefined" ? window.piDesktop : undefined }: { host?: any } = {}) {
  const bus = createEventBus();
  const stage = createStage();
  const workbench = createWorkbench({
    host,
    bus,
    async beforeGitBranchChange(cwd: string) {
      return !stage.allTabs.value.some(tab => tab.pluginId === "files" && tab.dirty && tabCwd(tab) === cwd);
    },
    async beforeRemoveWorkspace(cwd: string) {
      // 移除项目会卸载舞台，先兜住该项目未保存的草稿：能自动保存就直接保存，
      // 关掉自动保存时必须由用户确认放弃。
      const dirty = stage.allTabs.value.filter(tab => tab.pluginId === "files" && tab.dirty && tabCwd(tab) === cwd);
      if (!dirty.length) return true;
      if (appSettings.autoSave !== "off") {
        try {
          for (const tab of dirty) await saveFileTab(workbench, tab as StageTab<FileStageData>);
          return !dirty.some(tab => tab.dirty);
        } catch (error: any) {
          bus.emit("notify", { level: "error", text: `保存失败，已取消移除项目：${error?.message || String(error)}` });
          return false;
        }
      }
      return Boolean(await askConfirm({ title: "移除项目会关闭未保存的文件", message: `共有 ${dirty.length} 个文件含未保存修改，确定放弃并移除吗？`, confirmLabel: "放弃并移除", danger: true }));
    },
  });
  const terminal = createTerminalService({
    host,
    getCwd: () => workbench.state.activeCwd,
    enabled: false,
    getProfileOptions: () => ({
      profileId: appSettings.terminalProfile,
      customPath: appSettings.terminalCustomPath,
      customArgs: [...appSettings.terminalCustomArgs],
    }),
  });
  const theme = setupTheme(workbench, host, (mode) => {
    appSettings.themeMode = mode;
  });
  // 主题切换时把标题栏颜色告诉主进程（遮罩从标题栏下方开始，不再需要跟着压暗）
  const stopWindowChrome = setupWindowChrome(workbench, host, (id) => {
    const current = theme.themes.find((item) => item.id === id) ?? theme.themes[0];
    return { id: current.id, titlebar: current.titlebar };
  });
  const settings = setupSettings(workbench, bus);
  const commandRegistry = createCommandRegistry();
  const stopExtensionUi = setupExtensionUi(bus, host);
  const disposers: Array<() => void> = [
    () => workbench.dispose(),
    () => terminal.dispose(),
    () => settings.dispose(),
    () => theme.dispose(),
    stopWindowChrome,
    stopExtensionUi,
  ];

  // 按项目保留页签和未保存草稿；离开项目不销毁文件数据。
  disposers.push(bus.on("workspace:switched", ({ cwd }: { cwd: string }) => {
    stage.switchWorkspace(cwd);
  }));
  disposers.push(bus.on("workspace:removed", ({ cwd }: { cwd: string }) => {
    stage.removeWorkspace(cwd);
  }));

  // 切换分支后磁盘基线变了：关闭已保存的源码和实时 Diff，防止旧内容被再次保存。
  disposers.push(bus.on("git:branch-changed", ({ cwd }: { cwd: string }) => {
    stage.closeWorkspaceTabs(cwd, tab => !tab.dirty && (tab.pluginId === "files" || (tab.pluginId === "git" && tab.data?.kind !== "commit")));
  }));

  // 注册主程序内置全局命令（1 区域 & 全局）
  const builtinCommands: PluginCommand[] = [
    {
      id: "palette.open",
      title: "打开命令面板",
      category: "全局",
      keybinding: "Ctrl+K",
      run: () => {
        paletteState.open = true;
      },
    },
    {
      id: "settings.open",
      title: "打开偏好设置",
      category: "全局",
      keybinding: "Ctrl+,",
      run: () => {
        openSettingsModal();
      },
    },
    {
      id: "settings.mcp",
      title: "打开 MCP 服务配置",
      category: "全局",
      run: () => {
        openSettingsModal("mcp");
      },
    },
    {
      id: "settings.packages",
      title: "打开 Pi 软件包管理",
      category: "全局",
      run: () => {
        openSettingsModal("packages");
      },
    },
    {
      id: "settings.skills",
      title: "打开 Skills 设置",
      category: "全局",
      run: () => {
        openSettingsModal("skills");
      },
    },
    {
      id: "workspace.open",
      title: "打开项目目录",
      category: "项目",
      keybinding: "Ctrl+O",
      run: () => workbench.chooseAndOpen(),
    },
    {
      id: "session.new",
      title: "新建任务",
      category: "任务",
      keybinding: "Ctrl+N",
      run: () => workbench.newSession(),
    },
    {
      id: "sidebar.toggle",
      title: "切换项目与会话栏",
      category: "视图",
      keybinding: "Ctrl+B",
      run: () => {
        workbench.state.sidebarOpen = !workbench.state.sidebarOpen;
      },
    },
    {
      id: "theme.toggle",
      title: "切换深色 / 浅色主题",
      category: "视图",
      run: () => theme.toggleTheme(),
    },
  ];
  for (const command of builtinCommands) disposers.push(commandRegistry.register(command));
  disposers.push(commandRegistry.bindGlobalKeys());

  const slashCommands = createBuiltinSlashCommands({
    workbench,
    bus,
    getKeybindings: () => commandRegistry.commands,
  });

  function createContext(plugin: SidebarPlugin, disposers: Array<() => void>): PluginContext {
    const track = <T extends () => void>(dispose: T): T => {
      disposers.push(dispose);
      return dispose;
    };

    return Object.freeze({
      pluginId: plugin.id,
      registerMentionSource: (source) => track(plugins.registerMentionSource(source, plugin.id)),
      registerToolRenderer: (renderer) => track(plugins.registerToolRenderer(renderer, plugin.id)),
      on: (type: string, handler: (payload: any) => void) => track(bus.on(type, handler)),
      emit: (type: string, payload?: any) => bus.emit(type, payload),
      onDispose: (dispose: () => void) => track(dispose),
      registerCommand: (command) => track(commandRegistry.register(command)),
      togglePlugin: (pluginId: string) => plugins.toggle(pluginId),
      workbench,
      workspace: workbench.active,
      stage,
      terminal,
      host: {
        listDirectory: (relative = "") => workbench.listDirectory(relative),
        readFile: (relative: string) => workbench.readWorkspaceFile(relative),
        writeFile: (relative: string, content: string) => workbench.writeWorkspaceFile(relative, content),
        openExternal: (relative: string) => workbench.openWorkspacePath(relative),
        gitOverview: () => workbench.gitOverview(),
        gitInspect: (kind: "commit" | "working" | "staged" | "unstaged", target: string) => workbench.gitInspect(kind, target),
        gitAction: (action, payload) => workbench.gitAction(action, payload),
      },
    });
  }

  const plugins = createPluginManager({
    createContext,
    async beforeDisable(id) {
      const dirty = stage.allTabs.value.filter(tab => tab.pluginId === id && tab.dirty);
      if (!dirty.length) return true;
      if (appSettings.autoSave !== "off") {
        try {
          for (const tab of dirty) await saveFileTab(workbench, tab as StageTab<FileStageData>);
          return !dirty.some(tab => tab.dirty);
        } catch (error: any) {
          bus.emit("notify", { level: "error", text: `保存失败，插件未停用：${error?.message || String(error)}` });
          return false;
        }
      }
      return Boolean(await askConfirm({ title: "停用插件会关闭未保存的文件", message: `共有 ${dirty.length} 个文件含未保存修改，确定放弃并停用吗？`, confirmLabel: "放弃并停用", danger: true }));
    },
    onPluginDeactivated(pluginId: string) {
      workbench.closePanel(pluginId);
      stage.closeByPlugin(pluginId);
    },
  });

  return {
    bus,
    stage,
    workbench,
    terminal,
    plugins,
    theme,
    settings,
    slashCommands,
    commandRegistry,
    commands: commandRegistry.commands,
    runCommand: commandRegistry.run,
    dispose: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      plugins.dispose();
      bus.dispose();
    },
    available: Boolean(host),
    platform: host?.platform ?? "web",
  };
}

export type PiDesktopKernel = ReturnType<typeof createKernel>;
