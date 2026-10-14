import { createEventBus } from "./event-bus.ts";
import { createContributions } from "./contributions.ts";
import { createPluginManager, type PluginDefinition } from "./plugin-manager.ts";
import { createWorkbench } from "./workbench.ts";

export const KERNEL_KEY = Symbol("pi-desktop-kernel");

export function createKernel({ host = typeof window !== "undefined" ? window.piDesktop : undefined }: { host?: any } = {}) {
  const bus = createEventBus();
  const contributions = createContributions();
  const workbench = createWorkbench({ host, bus });

  function createContext(plugin: PluginDefinition, disposers: Array<() => void>) {
    const track = <T extends () => void>(dispose: T): T => {
      disposers.push(dispose);
      return dispose;
    };
    return Object.freeze({
      pluginId: plugin.id,
      contribute: (point: string, item: Record<string, any>) => track(contributions.add(point, plugin.id, item)),
      on: (type: string, handler: (payload: any) => void) => track(bus.on(type, handler)),
      onDispose: (dispose: () => void) => track(dispose),
      emit: (type: string, payload?: any) => bus.emit(type, payload),
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
        showPanel: (id: string) => {
          const panels = workbench.state.activePanels;
          const index = panels.indexOf(id);
          if (index >= 0) panels.splice(index, 1);
          else panels.push(id);
        },
        showSidebar: (id: string) => {
          const s = workbench.state;
          if (s.sidebarOpen && s.activeSidebar === id) s.sidebarOpen = false;
          else { s.activeSidebar = id; s.sidebarOpen = true; }
        },
        setSidebarWidth: workbench.setSidebarWidth,
        setPanelWidth: workbench.setPanelWidth,
        setEditorWidth: workbench.setEditorWidth,
      },
      get keybindings() {
        return contributions.points.commands.filter((c: any) => c.keybinding).map((c: any) => ({ title: c.title, keybinding: c.keybinding }));
      },
      chrome: {
        platform: host?.platform ?? "web",
        setTitleBar: (colors: { color: string; symbolColor: string }) => host?.setTitleBar?.(colors),
      },
      rpc: (method: string, ...args: any[]) => workbench.call(method, ...args),
      respondExtensionUi: (cwd: string, response: Record<string, any>) => host.respondExtensionUi(cwd, JSON.parse(JSON.stringify(response))),
      reveal: (target: string) => host?.reveal(target),
    });
  }

  const plugins = createPluginManager({ contributions, createContext });

  async function runCommand(id: string): Promise<void> {
    const command = contributions.points.commands.find((item: any) => item.id === id);
    if (command) await command.run();
  }

  bus.on("keybinding", ({ combo, event }: { combo: string; event: KeyboardEvent }) => {
    const command = contributions.points.commands.find((item: any) => item.keybinding === combo);
    if (!command) return;
    event.preventDefault();
    command.run();
  });

  return { bus, contributions, workbench, plugins, runCommand, available: Boolean(host), platform: host?.platform ?? "web" };
}
