import { reactive } from "vue";

const STORAGE_KEY = "pi-desktop.plugins.disabled";

export interface PluginDefinition {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  core?: boolean;
  activate?: (ctx: any) => void | Promise<void>;
  deactivate?: () => void;
}

export interface PluginRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  core: boolean;
  enabled: boolean;
  error: string;
}

function loadDisabled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function createPluginManager({
  contributions,
  createContext,
}: {
  contributions: ReturnType<typeof import("./contributions.ts").createContributions>;
  createContext: (plugin: PluginDefinition, disposers: Array<() => void>) => any;
}) {
  const disabled = loadDisabled();
  const records = reactive<PluginRecord[]>([]);
  const runtime = new Map<string, { plugin: PluginDefinition; disposers: Array<() => void> }>();

  function persist(): void {
    const ids = records.filter((record) => !record.enabled).map((record) => record.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  async function activate(record: PluginRecord): Promise<void> {
    const entry = runtime.get(record.id)!;
    const plugin = entry.plugin;
    const disposers: Array<() => void> = [];
    const ctx = createContext(plugin, disposers);
    try {
      await plugin.activate?.(ctx);
      entry.disposers = disposers;
      record.enabled = true;
      record.error = "";
    } catch (error: any) {
      for (const dispose of disposers.reverse()) dispose();
      contributions.removePlugin(record.id);
      record.enabled = false;
      record.error = error?.message ?? String(error);
      console.error(`[plugin] ${record.id} activate failed`, error);
    }
  }

  function deactivate(record: PluginRecord): void {
    const entry = runtime.get(record.id)!;
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

  async function register(plugin: PluginDefinition): Promise<void> {
    if (!plugin?.id) throw new Error("插件必须声明 id");
    if (runtime.has(plugin.id)) return;
    const record = reactive<PluginRecord>({
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

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = records.find((item) => item.id === id);
    if (!record || record.core || record.enabled === enabled) return;
    if (enabled) await activate(record);
    else deactivate(record);
    persist();
  }

  return { records, register, setEnabled };
}
