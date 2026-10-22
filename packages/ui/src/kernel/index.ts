import { createEventBus } from "./event-bus.ts";
import { createStage } from "./stage.ts";
import { createPluginManager, type PluginCommand, type PluginContext, type SidebarPlugin } from "./plugin-manager.ts";
import { createWorkbench } from "./workbench.ts";
import { setupTheme } from "../services/theme.ts";
import { createBuiltinSlashCommands } from "../services/slash-commands.ts";
import { setupExtensionUi } from "../services/extension-ui.ts";
import { createCommandRegistry, paletteState } from "../services/command-palette.ts";
import { appSettings, openSettingsModal, setupSettings } from "../services/settings.ts";
import { createTerminalService } from "../services/terminal.ts";

export const KERNEL_KEY = Symbol("pi-desktop-kernel");

export function createKernel({ host = typeof window !== "undefined" ? window.piDesktop : undefined }: { host?: any } = {}) {
  const bus = createEventBus();
  const stage = createStage();
  const workbench = createWorkbench({ host, bus });
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
  const theme = setupTheme(workbench, host);
  const settings = setupSettings(workbench, bus);
  const commandRegistry = createCommandRegistry();
  const stopExtensionUi = setupExtensionUi(bus, host);
  const disposers: Array<() => void> = [
    () => workbench.dispose(),
    () => terminal.dispose(),
    () => settings.dispose(),
    () => theme.dispose(),
    stopExtensionUi,
  ];

  // 切换项目目录时清空 3 区域打开的内容标签页
  disposers.push(bus.on("workspace:switched", () => {
    stage.clear();
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
        gitInspect: (kind: "commit" | "working", target: string) => workbench.gitInspect(kind, target),
        gitAction: (action, payload) => workbench.gitAction(action, payload),
      },
    });
  }

  const plugins = createPluginManager({
    createContext,
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
