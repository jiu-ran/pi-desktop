import { createEventBus } from "./event-bus.js";
import { createContributions } from "./contributions.js";
import { createPluginManager } from "./plugin-manager.js";
import { createWorkbench } from "./workbench.js";

export const KERNEL_KEY = Symbol("pi-desktop-kernel");

/**
 * 内核：把事件总线、贡献点、工作台服务与插件管理器组装在一起。
 * 插件只能拿到 PluginContext，拿不到内核本身。
 */
export function createKernel({ host = window.piDesktop } = {}) {
  const bus = createEventBus();
  const contributions = createContributions();
  const workbench = createWorkbench({ host, bus });

  function createContext(plugin, disposers) {
    const track = (dispose) => {
      disposers.push(dispose);
      return dispose;
    };
    return Object.freeze({
      pluginId: plugin.id,
      /** 向贡献点注册一项，插件停用时自动撤销 */
      contribute: (point, item) => track(contributions.add(point, plugin.id, item)),
      /** 订阅内核事件：pi:event / workspace:opened / notify / ... */
      on: (type, handler) => track(bus.on(type, handler)),
      /** 登记一个清理函数（如 watch 的 stop），插件停用时自动执行 */
      onDispose: (dispose) => track(dispose),
      emit: (type, payload) => bus.emit(type, payload),
      /** 只读的工作台状态 */
      workbench: {
        get state() { return workbench.state; },
        get active() { return workbench.active.value; },
        get workspaces() { return workbench.workspaces; },
        open: workbench.open,
        chooseAndOpen: workbench.chooseAndOpen,
        get currentFile() { return workbench.state.openFiles.find((item) => item.relative === workbench.state.activeFile) ?? null; },
        get openFiles() { return workbench.state.openFiles; },
        listDirectory: workbench.listDirectory,
        openFile: workbench.openFile,
        closeFile: workbench.closeFile,
        activateFile: workbench.activateFile,
        readWorkspaceFile: workbench.readWorkspaceFile,
        saveWorkspaceFile: workbench.saveWorkspaceFile,
        openWorkspacePath: workbench.openWorkspacePath,
        completePaths: workbench.completePaths,
        addFiles: workbench.addFiles,
        chooseFiles: workbench.chooseFiles,
        chooseFolder: workbench.chooseFolder,
        removeAttachment: workbench.removeAttachment,
        forget: workbench.forget,
        removeProject: workbench.removeProject,
        deleteSession: workbench.deleteSession,
        send: workbench.send,
        stop: workbench.stop,
        newSession: workbench.newSession,
        switchSession: workbench.switchSession,
        setModel: workbench.setModel,
        setThinking: workbench.setThinking,
        setTheme: workbench.setTheme,
        reload: workbench.reload,
        restart: workbench.restart,
        renameSession: workbench.renameSession,
        notice: workbench.notice,
        refreshSessions: () => workbench.refreshSessions(),
        listSessions: workbench.listSessions,
        openSession: workbench.openSession,
        showPanel: (id) => {
          const panels = workbench.state.activePanels;
          const index = panels.indexOf(id);
          if (index >= 0) panels.splice(index, 1);
          else panels.push(id);
        },
        showSidebar: (id) => {
          const s = workbench.state;
          if (s.sidebarOpen && s.activeSidebar === id) s.sidebarOpen = false;
          else { s.activeSidebar = id; s.sidebarOpen = true; }
        },
        setSidebarWidth: workbench.setSidebarWidth,
        setPanelWidth: workbench.setPanelWidth,
        setEditorWidth: workbench.setEditorWidth,
      },
      /** 只读：已注册的桌面命令与快捷键 */
      get keybindings() {
        return contributions.points.commands.filter((c) => c.keybinding).map((c) => ({ title: c.title, keybinding: c.keybinding }));
      },
      /** 窗口外观（仅 UI）：同步标题栏覆盖层颜色 */
      chrome: {
        platform: host?.platform ?? "web",
        setTitleBar: (colors) => host?.setTitleBar?.(colors),
      },
      /** 白名单 RPC 调用（作用于当前工作区） */
      rpc: (method, ...args) => workbench.call(method, ...args),
      /** 回写 extension_ui_response */
      respondExtensionUi: (cwd, response) => host.respondExtensionUi(cwd, JSON.parse(JSON.stringify(response))),
      reveal: (target) => host?.reveal(target),
    });
  }

  const plugins = createPluginManager({ contributions, createContext });

  async function runCommand(id) {
    const command = contributions.points.commands.find((item) => item.id === id);
    if (command) await command.run();
  }

  // 快捷键分发：由命令面板插件发出 keybinding 事件，这里匹配 commands 贡献点
  bus.on("keybinding", ({ combo, event }) => {
    const command = contributions.points.commands.find((item) => item.keybinding === combo);
    if (!command) return;
    event.preventDefault();
    command.run();
  });

  return { bus, contributions, workbench, plugins, runCommand, available: Boolean(host), platform: host?.platform ?? "web" };
}
