import { computed, reactive } from "vue";

/**
 * 3 区域（内容展示区）控制器：
 * 完全由 4 区域（右侧面板）中的插件驱动——例如在文件树插件里点击文件、
 * 在变更插件里点击修改项、在 Git 树插件里点击提交，均在 3 区域打开标签页展示详情。
 */
export interface StageTab<T = any> {
  key: string;
  pluginId: string;
  tabId: string;
  title: string;
  subtitle?: string;
  icon?: string;
  dirty?: boolean;
  data: T;
}

export interface OpenStageInput<T = any> {
  key?: string;
  pluginId: string;
  tabId: string;
  title: string;
  subtitle?: string;
  icon?: string;
  dirty?: boolean;
  data: T;
}

export function createStage() {
  const state = reactive({
    tabs: [] as StageTab[],
    activeKey: "",
  });

  const workspaces = new Map<string, { tabs: StageTab[]; activeKey: string }>();
  let workspace = "";
  const allTabs = computed(() => [...new Set([...state.tabs, ...[...workspaces.values()].flatMap((saved) => saved.tabs)])]);
  function switchWorkspace(cwd: string): void {
    if (cwd === workspace) return;
    workspaces.set(workspace, { tabs: [...state.tabs], activeKey: state.activeKey });
    workspace = cwd;
    const saved = workspaces.get(cwd);
    state.tabs.splice(0, state.tabs.length, ...(saved?.tabs ?? []));
    state.activeKey = saved?.activeKey ?? "";
    workspaces.delete(cwd);
  }

  function removeWorkspace(cwd: string): void {
    workspaces.delete(cwd);
    if (workspace === cwd) clear();
  }

  const activeKey = computed(() => state.activeKey);

  const activeTab = computed<StageTab | null>(
    () => state.tabs.find((item) => item.key === state.activeKey) ?? state.tabs[0] ?? null,
  );

  function findTab<T = any>(pluginId: string, tabId: string): StageTab<T> | undefined {
    const key = `${pluginId}:${tabId}`;
    return state.tabs.find((item) => item.key === key) as StageTab<T> | undefined;
  }

  function open<T = any>(input: OpenStageInput<T>): StageTab<T> {
    const key = input.key ?? `${input.pluginId}:${input.tabId}`;
    const existing = state.tabs.find((item) => item.key === key);
    if (existing) {
      existing.title = input.title;
      if (input.subtitle !== undefined) existing.subtitle = input.subtitle;
      if (input.icon !== undefined) existing.icon = input.icon;
      if (input.dirty !== undefined) existing.dirty = input.dirty;
      if (input.data !== undefined) existing.data = input.data;
      state.activeKey = key;
      return existing as StageTab<T>;
    }
    const tab = reactive<StageTab<T>>({
      key,
      pluginId: input.pluginId,
      tabId: input.tabId,
      title: input.title,
      subtitle: input.subtitle ?? "",
      icon: input.icon ?? "",
      dirty: Boolean(input.dirty),
      data: input.data,
    }) as StageTab<T>;
    state.tabs.push(tab);
    state.activeKey = key;
    return tab;
  }

  function update(key: string, patch: Partial<Omit<StageTab, "key" | "pluginId" | "tabId">>): void {
    const tab = state.tabs.find((item) => item.key === key);
    if (!tab) return;
    if (patch.title !== undefined) tab.title = patch.title;
    if (patch.subtitle !== undefined) tab.subtitle = patch.subtitle;
    if (patch.icon !== undefined) tab.icon = patch.icon;
    if (patch.dirty !== undefined) tab.dirty = patch.dirty;
    if (patch.data !== undefined) tab.data = patch.data;
  }

  function activate(key: string): void {
    if (state.tabs.some((item) => item.key === key)) {
      state.activeKey = key;
    }
  }

  function close(key = state.activeKey): void {
    const index = state.tabs.findIndex((item) => item.key === key);
    if (index < 0) return;
    state.tabs.splice(index, 1);
    if (state.activeKey === key) {
      state.activeKey = state.tabs[Math.max(0, index - 1)]?.key ?? state.tabs[0]?.key ?? "";
    }
  }

  function closeByPlugin(pluginId: string): void {
    for (const saved of workspaces.values()) {
      saved.tabs = saved.tabs.filter((tab) => tab.pluginId !== pluginId);
      if (!saved.tabs.some((tab) => tab.key === saved.activeKey)) saved.activeKey = saved.tabs[0]?.key ?? "";
    }
    const next = state.tabs.filter((item) => item.pluginId !== pluginId);
    state.tabs.splice(0, state.tabs.length, ...next);
    if (!state.tabs.some((item) => item.key === state.activeKey)) {
      state.activeKey = state.tabs[0]?.key ?? "";
    }
  }

  function closeWorkspaceTabs(cwd: string, predicate: (tab: StageTab) => boolean): void {
    const saved = cwd === workspace ? state : workspaces.get(cwd);
    if (!saved) return;
    saved.tabs.splice(0, saved.tabs.length, ...saved.tabs.filter(tab => !predicate(tab)));
    if (!saved.tabs.some(tab => tab.key === saved.activeKey)) saved.activeKey = saved.tabs[0]?.key ?? "";
  }

  function clear(): void {
    state.tabs.splice(0, state.tabs.length);
    state.activeKey = "";
  }

  return {
    state,
    allTabs,
    switchWorkspace,
    removeWorkspace,
    get tabs() {
      return state.tabs;
    },
    activeKey,
    activeTab,
    findTab,
    open,
    update,
    activate,
    close,
    closeByPlugin,
    closeWorkspaceTabs,
    clear,
  };
}

export type StageController = ReturnType<typeof createStage>;
