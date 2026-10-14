import { reactive } from "vue";

const STORAGE_KEY = "pi-desktop.plugins.disabled";

function loadDisabled() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/**
 * 插件管理器：负责注册、启用、停用。
 * 停用时调用 deactivate 并撤销该插件的全部贡献与事件订阅，功能真正卸载。
 */
export function createPluginManager({ contributions, createContext }) {
  const disabled = loadDisabled();
  const records = reactive([]);
  const runtime = new Map();

  function persist() {
    const ids = records.filter((record) => !record.enabled).map((record) => record.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  async function activate(record) {
    const plugin = runtime.get(record.id).plugin;
    const disposers = [];
    const ctx = createContext(plugin, disposers);
    try {
      await plugin.activate?.(ctx);
      runtime.get(record.id).disposers = disposers;
      record.enabled = true;
      record.error = "";
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      contributions.removePlugin(record.id);
      record.enabled = false;
      record.error = error?.message ?? String(error);
      console.error(`[plugin] ${record.id} activate failed`, error);
    }
  }

  function deactivate(record) {
    const entry = runtime.get(record.id);
    try {
      entry.plugin.deactivate?.();
    } catch (error) {
      console.error(`[plugin] ${record.id} deactivate failed`, error);
    }
    for (const dispose of (entry.disposers ?? []).reverse()) dispose();
    entry.disposers = [];
    contributions.removePlugin(record.id);
    record.enabled = false;
  }

  async function register(plugin) {
    if (!plugin?.id) throw new Error("插件必须声明 id");
    if (runtime.has(plugin.id)) return;
    const record = reactive({
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      description: plugin.description ?? "",
      version: plugin.version ?? "0.0.0",
      core: Boolean(plugin.core),
      enabled: false,
      error: "",
    });
    records.push(record);
    runtime.set(plugin.id, { plugin, disposers: [] });
    if (record.core || !disabled.has(plugin.id)) await activate(record);
  }

  async function setEnabled(id, enabled) {
    const record = records.find((item) => item.id === id);
    if (!record || record.core || record.enabled === enabled) return;
    if (enabled) await activate(record);
    else deactivate(record);
    persist();
  }

  return { records, register, setEnabled };
}
