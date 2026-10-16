import { createPluginManager, type SidebarPlugin } from "../../packages/ui/src/kernel/plugin-manager.ts";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

const calls: string[] = [];
const manager = createPluginManager({
  createContext: (_plugin, disposers) => ({
    pluginId: _plugin.id,
    on: () => () => {},
    emit: () => {},
    onDispose: (dispose) => {
      disposers.push(dispose);
      return dispose;
    },
    registerCommand: () => () => {},
    togglePlugin: async () => {},
    workbench: {} as any,
    workspace: {} as any,
    stage: {} as any,
    host: {} as any,
  }),
  onPluginDeactivated: (id) => calls.push(`deactivated:${id}`),
});

let deactivations = 0;
const plugin: SidebarPlugin = {
  id: "slow-plugin",
  name: "Slow plugin",
  description: "",
  version: "1.0.0",
  icon: "",
  activate: async (ctx) => {
    calls.push("activate");
    ctx.onDispose(() => calls.push("dispose:first"));
    ctx.onDispose(() => calls.push("dispose:last"));
    await Promise.resolve();
  },
  deactivate: () => {
    deactivations += 1;
    calls.push("deactivate");
  },
};

storage.set("pi-desktop.plugins.disabled", JSON.stringify([plugin.id]));
await manager.register(plugin);
await Promise.all([
  manager.setEnabled(plugin.id, true),
  manager.setEnabled(plugin.id, false),
  manager.setEnabled(plugin.id, true),
]);
const record = manager.get(plugin.id);
if (!record?.enabled || Number(calls.filter((call) => call === "activate").length) !== 2 || deactivations !== 1) {
  throw new Error(`serialized plugin toggles failed: ${JSON.stringify({ record, calls, deactivations })}`);
}
if (calls.indexOf("dispose:last") > calls.indexOf("dispose:first")) {
  throw new Error("plugin disposers should run in reverse registration order");
}

manager.dispose();
if (manager.get(plugin.id) !== record || record.enabled || Number(deactivations) !== 2) {
  throw new Error("plugin manager dispose should deactivate enabled plugins");
}

let rollbackDeactivated = 0;
let rollbackDisposed = 0;
const broken: SidebarPlugin = {
  id: "broken-plugin",
  name: "Broken plugin",
  description: "",
  version: "1.0.0",
  icon: "",
  activate: (ctx) => {
    ctx.onDispose(() => { rollbackDisposed += 1; });
    throw new Error("activation failed");
  },
  deactivate: () => { rollbackDeactivated += 1; },
};
const second = createPluginManager({
  createContext: (_plugin, disposers) => ({
    pluginId: _plugin.id,
    on: () => () => {},
    emit: () => {},
    onDispose: (dispose) => { disposers.push(dispose); return dispose; },
    registerCommand: () => () => {},
    togglePlugin: async () => {},
    workbench: {} as any,
    workspace: {} as any,
    stage: {} as any,
    host: {} as any,
  }),
  onPluginDeactivated: () => {},
});
await second.register(broken);
const failed = second.get(broken.id);
if (failed?.enabled || !failed?.error || rollbackDeactivated !== 1 || rollbackDisposed !== 1) {
  throw new Error("plugin activation failure should rollback runtime state");
}

let releaseLateActivation!: () => void;
let lateDeactivated = 0;
let lateDisposed = 0;
const late = createPluginManager({
  createContext: (_plugin, disposers) => ({
    pluginId: _plugin.id,
    on: () => () => {},
    emit: () => {},
    onDispose: (dispose) => { disposers.push(dispose); return dispose; },
    registerCommand: () => () => {},
    togglePlugin: async () => {},
    workbench: {} as any,
    workspace: {} as any,
    stage: {} as any,
    host: {} as any,
  }),
  onPluginDeactivated: () => {},
});
const lateActivation: SidebarPlugin = {
  id: "late-plugin",
  name: "Late plugin",
  description: "",
  version: "1.0.0",
  icon: "",
  activate: async (ctx) => {
    ctx.onDispose(() => { lateDisposed += 1; });
    await new Promise<void>((resolve) => { releaseLateActivation = resolve; });
  },
  deactivate: () => { lateDeactivated += 1; },
};
const pendingLate = late.register(lateActivation);
await Promise.resolve();
late.dispose();
releaseLateActivation();
await pendingLate;
const lateRecord = late.get(lateActivation.id);
if (lateRecord?.enabled || lateDeactivated !== 1 || lateDisposed !== 1) {
  throw new Error("late plugin activation should rollback after manager disposal");
}

console.log("plugin-lifecycle OK");
