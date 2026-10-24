import { computed, markRaw, reactive, type ComputedRef } from "vue";
import type { OpenStageInput, StageController, StageTab } from "./stage.ts";
import type { Workbench, WorkspaceState } from "./workbench.ts";
import type { TerminalController } from "../services/terminal.ts";
import type { GitActionResult, GitActionName, GitActionPayload, GitInspectResult, GitOverview, WorkspaceEntry, WorkspaceFileData } from "../env.d.ts";

const STORAGE_KEY = "pi-desktop.plugins.disabled";
const ENABLED_KEY = "pi-desktop.plugins.enabled";

export interface PluginCommand {
  id: string;
  title: string;
  category?: string;
  hint?: string;
  keybinding?: string;
  run: () => void | Promise<void>;
}

/** `@` 选择器里的一个候选（由插件提供） */
export interface MentionItem {
  /** 唯一标识；引用对话时是会话文件路径 */
  id: string;
  /** 主标题 */
  label: string;
  /** 右侧弱化信息，例如所属项目 */
  hint?: string;
  /** 附加搜索词（项目路径等），不显示 */
  keywords?: string;
}

/**
 * 插件向 `@` 选择器贡献一组候选。
 * 典型用法：引用其它项目的对话——搜出会话，选中后加一枚会话附件。
 */
export interface MentionSource {
  id: string;
  /** 注册它的插件 id（由内核填写，界面用来显示能力标签） */
  pluginId?: string;
  /** 分组标题 */
  title: string;
  /** 分组顺序（越小越靠前） */
  order?: number;
  search: (query: string) => MentionItem[] | Promise<MentionItem[]>;
  pick: (item: MentionItem) => void | Promise<void>;
}

export interface PluginContext {
  readonly pluginId: string;
  /** 注册 `@` 选择器候选来源（停用插件时自动注销） */
  registerMentionSource: (source: MentionSource) => () => void;
  /** 订阅内核事件（插件停用时自动取消） */
  on: (type: string, handler: (payload: any) => void) => () => void;
  /** 发送内核事件 */
  emit: (type: string, payload?: any) => void;
  /** 注册停用清理回调 */
  onDispose: (dispose: () => void) => () => void;
  /** 注册命令面板快捷命令 */
  registerCommand: (command: PluginCommand) => () => void;
  /** 切换另一个插件的启用状态 */
  togglePlugin: (pluginId: string) => Promise<void>;
  /** 工作区控制器 */
  readonly workbench: Workbench;
  /** 当前激活工作区（ComputedRef） */
  readonly workspace: ComputedRef<WorkspaceState | null>;
  /** 3 区域（内容展示区）控制器 */
  readonly stage: StageController;
  /** 可选的终端服务，由终端插件控制启用状态。 */
  readonly terminal?: TerminalController;
  /** 当前工作区受控宿主能力快捷封装 */
  readonly host: {
    listDirectory: (relative?: string) => Promise<WorkspaceEntry[]>;
    readFile: (relative: string) => Promise<WorkspaceFileData>;
    writeFile: (relative: string, content: string) => Promise<WorkspaceFileData>;
    openExternal: (relative: string) => Promise<void>;
    gitOverview: () => Promise<GitOverview>;
    gitInspect: (kind: "commit" | "working" | "staged" | "unstaged", target: string) => Promise<GitInspectResult>;
    gitAction: (action: GitActionName, payload?: GitActionPayload) => Promise<GitActionResult>;
  };
}

/**
 * 插件归属的界面区域：
 * - `sidebar`：扩展工具（活动栏图标 + 扩展工具面板 + 详情视图）
 * - `conversation`：对话区域（渲染对话消息里的 Markdown / 图表等）
 * - `files`：文件区域（渲染打开的文件，如 Markdown 预览）
 * - `shell`：工作台工具（可选停靠面板，不占用右侧活动栏）
 */
export type PluginArea = "sidebar" | "conversation" | "files" | "shell";

export const PLUGIN_AREAS: Array<{ id: PluginArea; label: string }> = [
  { id: "conversation", label: "对话区域" },
  { id: "files", label: "文件区域" },
  { id: "sidebar", label: "扩展工具" },
  { id: "shell", label: "工作台工具" },
];

/**
 * 功能插件定义：
 * - 扩展工具区域：活动栏图标 + 4 区域面板 `panel` + 3 区域详情 `stage`
 * - 对话 / 文件区域：仅注册渲染能力，不占用活动栏
 */
export interface SidebarPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  order?: number;
  core?: boolean;
  /** 默认启用状态；false 为用户主动选择启用（不影响已保存的选择）。 */
  defaultEnabled?: boolean;
  /** 工作台停靠组件，例如底部终端（不会占用右侧活动栏）。 */
  dock?: any;
  /** 归属区域，默认 `sidebar` */
  area?: PluginArea;
  /** 4 区域面板组件（仅扩展工具区域） */
  panel?: any;
  /** 3 区域内容展示组件（仅扩展工具区域） */
  stage?: any;
  /** 右侧边栏图标上的动态角标 */
  badge?: () => string | number | null | undefined;
  activate?: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void;
}

export interface RegisteredSidebarPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  order: number;
  core: boolean;
  area: PluginArea;
  dock?: any;
  panel?: any;
  stage?: any;
  badge?: () => string | number | null | undefined;
  enabled: boolean;
  error: string;
}

export function definePlugin(plugin: SidebarPlugin): SidebarPlugin {
  return plugin;
}

const mentionSourceIds = new Set<string>();

function loadDisabled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function createPluginManager({
  createContext,
  onPluginDeactivated,
  beforeDisable = async () => true,
}: {
  createContext: (plugin: SidebarPlugin, disposers: Array<() => void>) => PluginContext;
  onPluginDeactivated: (pluginId: string) => void;
  beforeDisable?: (pluginId: string) => Promise<boolean>;
}) {
  const disabled = loadDisabled();
  const enabled = (() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(ENABLED_KEY) || "[]")); } catch { return new Set<string>(); }
  })();
  const records = reactive<RegisteredSidebarPlugin[]>([]);
  /** 插件贡献的 `@` 候选来源（按 order 排序，停用时移除） */
  const mentionSources = reactive<MentionSource[]>([]);

  function registerMentionSource(source: MentionSource, pluginId = ""): () => void {
    if (!source?.id || mentionSourceIds.has(source.id)) return () => {};
    mentionSourceIds.add(source.id);
    mentionSources.push(markRaw({ ...source, pluginId: pluginId || source.pluginId || "" }));
    mentionSources.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    return () => {
      mentionSourceIds.delete(source.id);
      const index = mentionSources.findIndex((item) => item.id === source.id);
      if (index >= 0) mentionSources.splice(index, 1);
    };
  }
  const runtime = new Map<
    string,
    {
      plugin: SidebarPlugin;
      ctx: PluginContext | null;
      disposers: Array<() => void>;
      generation: number;
      activationPending: boolean;
    }
  >();
  const operations = new Map<string, Promise<void>>();
  let disposed = false;

  function disposeAll(disposers: Array<() => void>): void {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error("[plugin] disposer failed", error);
      }
    }
  }

  function persist(): void {
    const ids = records.filter((record) => !record.enabled).map((record) => record.id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      localStorage.setItem(ENABLED_KEY, JSON.stringify(records.filter((record) => record.enabled).map((record) => record.id)));
    } catch { /* 隐私模式下不影响本次启停 */ }
  }

  async function activate(record: RegisteredSidebarPlugin): Promise<void> {
    const entry = runtime.get(record.id);
    if (disposed || !entry || record.enabled || entry.ctx) return;
    const plugin = entry.plugin;
    const generation = entry.generation + 1;
    entry.generation = generation;
    entry.activationPending = true;
    const disposers: Array<() => void> = [];
    const ctx = createContext(plugin, disposers);
    entry.ctx = ctx;
    entry.disposers = disposers;
    try {
      await plugin.activate?.(ctx);
      const current = runtime.get(record.id) === entry
        && entry.generation === generation
        && entry.ctx === ctx
        && !disposed;
      if (!current) {
        // A concurrent deactivation/dispose already invalidated this context.
        // Roll back after the async activation settles so late resources cannot leak.
        entry.activationPending = false;
        try {
          plugin.deactivate?.();
        } catch (error) {
          console.error(`[plugin] ${record.id} late activation rollback failed`, error);
        }
        if (entry.ctx === ctx) {
          entry.ctx = null;
          entry.disposers = [];
        }
        disposeAll(disposers);
        return;
      }
      entry.activationPending = false;
      record.badge = plugin.badge ? () => plugin.badge?.() : undefined;
      record.enabled = true;
      record.error = "";
    } catch (error: any) {
      try {
        plugin.deactivate?.();
      } catch (deactivateError) {
        console.error(`[plugin] ${record.id} rollback failed`, deactivateError);
      }
      disposeAll(disposers);
      if (entry.ctx === ctx) {
        entry.activationPending = false;
        entry.ctx = null;
        entry.disposers = [];
      }
      record.badge = undefined;
      onPluginDeactivated(record.id);
      record.enabled = false;
      record.error = error?.message ?? String(error);
      console.error(`[plugin] ${record.id} activate failed`, error);
    }
  }

  function deactivate(record: RegisteredSidebarPlugin): void {
    const entry = runtime.get(record.id);
    if (!entry) {
      record.badge = undefined;
      record.enabled = false;
      return;
    }
    const activationPending = entry.activationPending;
    entry.generation += 1;
    if (!activationPending) entry.activationPending = false;
    const disposers = entry.disposers;
    entry.ctx = null;
    entry.disposers = [];
    if (!activationPending) {
      try {
        entry.plugin.deactivate?.();
      } catch (error) {
        console.error(`[plugin] ${record.id} deactivate failed`, error);
      }
    }
    disposeAll(disposers);
    record.badge = undefined;
    onPluginDeactivated(record.id);
    record.enabled = false;
  }

  async function register(rawPlugin: SidebarPlugin): Promise<void> {
    if (disposed) return;
    if (!rawPlugin?.id) throw new Error("插件必须声明 id");
    if (runtime.has(rawPlugin.id)) {
      throw new Error(`插件 id 已注册：${rawPlugin.id}`);
    }
    const plugin: SidebarPlugin = {
      ...rawPlugin,
      panel: rawPlugin.panel ? markRaw(rawPlugin.panel) : undefined,
      stage: rawPlugin.stage ? markRaw(rawPlugin.stage) : undefined,
      dock: rawPlugin.dock ? markRaw(rawPlugin.dock) : undefined,
    };
    const record = reactive<RegisteredSidebarPlugin>({
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      description: plugin.description ?? "",
      version: plugin.version ?? "1.0.0",
      icon: plugin.icon ?? "",
      order: plugin.order ?? 50,
      core: Boolean(plugin.core),
      area: plugin.area ?? "sidebar",
      dock: plugin.dock,
      panel: plugin.panel,
      stage: plugin.stage,
      badge: plugin.badge ? () => plugin.badge?.() : undefined,
      enabled: false,
      error: "",
    });
    records.push(record);
    records.sort((a, b) => a.order - b.order);
    runtime.set(plugin.id, { plugin, ctx: null, disposers: [], generation: 0, activationPending: false });
    if (record.core || (!disabled.has(plugin.id) && (plugin.defaultEnabled !== false || enabled.has(plugin.id)))) await activate(record);
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    if (disposed) return;
    const record = records.find((item) => item.id === id);
    if (!record || record.core) return;
    const previous = operations.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const entry = runtime.get(id);
      if (!entry) return;
      if (record.enabled === enabled && !entry.activationPending) return;
      if (enabled) await activate(record);
      else {
        if (!(await beforeDisable(id))) return;
        deactivate(record);
      }
      persist();
    });
    operations.set(id, operation);
    try {
      await operation;
    } finally {
      if (operations.get(id) === operation) operations.delete(id);
    }
  }

  async function toggle(id: string): Promise<void> {
    const record = records.find((item) => item.id === id);
    if (!record || record.core) return;
    await setEnabled(id, !record.enabled);
  }

  const list = computed(() => records);
  const enabledList = computed(() => records.filter((record) => record.enabled));
  /** 仅扩展工具区域的插件会占用活动栏与扩展工具面板 */
  const sidebarPlugins = computed(() => records.filter((record) => record.area === "sidebar" && record.enabled));

  function get(id: string): RegisteredSidebarPlugin | undefined {
    return records.find((item) => item.id === id);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const record of records) {
      const entry = runtime.get(record.id);
      if (record.enabled || entry?.ctx) deactivate(record);
    }
    runtime.clear();
    operations.clear();
  }

  return {
    records,
    list,
    enabledList,
    sidebarPlugins,
    mentionSources,
    registerMentionSource,
    get,
    register,
    setEnabled,
    toggle,
    dispose,
  };
}
