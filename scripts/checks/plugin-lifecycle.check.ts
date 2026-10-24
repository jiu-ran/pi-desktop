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
    registerMentionSource: () => () => {},
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
    registerMentionSource: () => () => {},
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
    registerMentionSource: () => () => {},
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

// 默认关闭的工作台工具只有用户选择后才启用，并跨重启保留选择。
let optionalActivations = 0;
const createOptionalManager = () => createPluginManager({
  createContext: (_plugin, disposers) => ({
    pluginId: _plugin.id, on: () => () => {}, emit: () => {},
    onDispose: (dispose) => { disposers.push(dispose); return dispose; },
    registerCommand: () => () => {},
    registerMentionSource: () => () => {}, togglePlugin: async () => {},
    workbench: {} as any, workspace: {} as any, stage: {} as any, host: {} as any,
  }),
  onPluginDeactivated: () => {},
});
const optional: SidebarPlugin = {
  id: "optional-dock", name: "Optional dock", description: "", version: "1.0.0", icon: "",
  defaultEnabled: false, area: "shell", dock: {},
  activate: () => { optionalActivations += 1; },
};
const optionalManager = createOptionalManager();
await optionalManager.register(optional);
if (optionalManager.get(optional.id)?.enabled || optionalActivations !== 0) throw new Error("可选插件不应强制默认启用");
await optionalManager.setEnabled(optional.id, true);
if (!optionalManager.get(optional.id)?.enabled) throw new Error("可选停靠插件无法主动启用");
optionalManager.dispose();
const restoredOptional = createOptionalManager();
await restoredOptional.register(optional);
if (!restoredOptional.get(optional.id)?.enabled) throw new Error("重启后没有保留用户启用插件的选择");
await restoredOptional.setEnabled(optional.id, false);
restoredOptional.dispose();
const disabledOptional = createOptionalManager();
await disabledOptional.register(optional);
if (disabledOptional.get(optional.id)?.enabled) throw new Error("重启后忽略了用户停用插件的选择");
disabledOptional.dispose();

console.log("plugin-lifecycle OK");

// `@` 候选来源：插件注册后出现在 mentionSources，停用后自动移除
{
  const manager2 = createPluginManager({
    createContext: (_plugin, disposers) => ({
      pluginId: _plugin.id,
      on: () => () => {},
      emit: () => {},
      onDispose: (dispose) => {
        disposers.push(dispose);
        return dispose;
      },
      registerCommand: () => () => {},
      registerMentionSource: (source) => {
        const dispose = manager2.registerMentionSource(source, _plugin.id);
        disposers.push(dispose);
        return dispose;
      },
      togglePlugin: async () => {},
      workbench: {} as any,
      workspace: {} as any,
      stage: {} as any,
      host: {} as any,
    }),
    onPluginDeactivated: () => {},
  });
  const fake: SidebarPlugin = {
    id: "mention-plugin",
    name: "Mention plugin",
    description: "",
    version: "1.0.0",
    icon: "",
    area: "conversation",
    activate: (ctx) => {
      ctx.registerMentionSource({ id: "mention-plugin.source", title: "其它项目", search: () => [], pick: () => {} });
    },
  };
  await manager2.register(fake);
  // 类型收窄会把字面量定死，这里放宽成 any 便于断言
  const sources = (): any[] => manager2.mentionSources as any[];
  if (sources().length !== 1) throw new Error("启用后应有一个候选来源");
  if (sources()[0].title !== "其它项目") throw new Error("候选来源信息不对");
  if (sources()[0].pluginId !== "mention-plugin") throw new Error("候选来源应记录所属插件");
  // 顺序：order 小的在前
  await manager2.register({
    id: "mention-plugin-2",
    name: "Second",
    description: "",
    version: "1.0.0",
    icon: "",
    area: "conversation",
    activate: (ctx) => {
      ctx.registerMentionSource({ id: "mention-plugin-2.source", title: "排前面", order: 1, search: () => [], pick: () => {} });
    },
  });
  if (sources()[0].title !== "排前面") throw new Error("候选来源应按 order 排序");
  await manager2.toggle("mention-plugin");
  if (sources().some((source) => source.id === "mention-plugin.source")) {
    throw new Error("停用插件后候选来源应被移除");
  }
  await manager2.toggle("mention-plugin-2");
  if (sources().length !== 0) throw new Error("全部停用后不应残留候选来源");
  manager2.dispose();
}
console.log("plugin mention source OK 注册 / 排序 / 停用清理");
