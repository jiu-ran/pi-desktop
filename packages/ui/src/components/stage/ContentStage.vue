<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";
import { appSettings } from "../../services/settings.ts";
import { askConfirm, openMenu } from "../sidebar/ui.ts";
import type { StageTab } from "../../kernel/stage.ts";

const { stage, plugins, workbench, bus } = useKernel();

const activeTab = computed(() => stage.activeTab.value);
const activePlugin = computed(() => (activeTab.value ? plugins.get(activeTab.value.pluginId) : undefined));
const stageComponent = computed(() => activePlugin.value?.stage ?? null);

function focusOwnerPanel(): void {
  if (!activeTab.value) return;
  workbench.state.activePanelId = activeTab.value.pluginId;
}

/** 关闭会卸载 FileStage；自动保存开启时它在卸载前会落盘，只有关闭自动保存才需要确认。 */
function needsDiscardConfirm(tab: StageTab): boolean {
  return Boolean(tab.dirty) && appSettings.autoSave === "off";
}

async function confirmDiscard(tabs: readonly StageTab[]): Promise<boolean> {
  const dirty = tabs.filter(needsDiscardConfirm);
  if (!dirty.length) return true;
  const ok = await askConfirm({
    title: dirty.length === 1 ? `关闭「${dirty[0].title}」？` : `关闭 ${dirty.length} 个未保存的标签？`,
    message: "自动保存已关闭，关闭后这些修改会丢失。",
    confirmLabel: "放弃修改并关闭",
    danger: true,
  });
  return Boolean(ok);
}

async function requestClose(tab: StageTab): Promise<void> {
  if (!(await confirmDiscard([tab]))) return;
  stage.close(tab.key);
}

async function requestClear(): Promise<void> {
  if (!(await confirmDiscard(stage.tabs))) return;
  stage.clear();
}

async function closeMany(tabs: readonly StageTab[]): Promise<void> {
  if (!(await confirmDiscard(tabs))) return;
  const keys = new Set(tabs.map((tab) => tab.key));
  for (const tab of [...stage.tabs]) {
    if (keys.has(tab.key)) stage.close(tab.key);
  }
}

function closeOthers(tab: StageTab): void {
  void closeMany(stage.tabs.filter((item) => item.key !== tab.key));
}

function closeToRight(tab: StageTab): void {
  const index = stage.tabs.findIndex((item) => item.key === tab.key);
  if (index < 0) return;
  void closeMany(stage.tabs.slice(index + 1));
}

function closeSaved(): void {
  void closeMany(stage.tabs.filter((item) => !item.dirty));
}

function copyTabPath(tab: StageTab): void {
  const target = String((tab.data as any)?.relative ?? tab.subtitle ?? tab.tabId ?? "");
  if (!target) return;
  navigator.clipboard.writeText(target).then(
    () => bus.emit("notify", { level: "info", text: `已复制路径 ${target}` }),
    (error) => bus.emit("notify", { level: "error", text: error?.message ?? String(error) }),
  );
}

function revealTab(tab: StageTab): void {
  const target = String((tab.data as any)?.path ?? "");
  if (!target) return;
  workbench.reveal(target).catch((error) => bus.emit("notify", { level: "error", text: error?.message ?? String(error) }));
}

function openTabMenu(event: MouseEvent, tab: StageTab): void {
  const fileTab = tab.pluginId === "files";
  openMenu(event, [
    { label: "关闭", run: () => void requestClose(tab) },
    { label: "关闭其他标签", run: () => closeOthers(tab) },
    { label: "关闭右侧标签", run: () => closeToRight(tab) },
    { separator: true },
    { label: "关闭已保存的标签", run: closeSaved },
    { label: "全部关闭", run: () => void requestClear() },
    ...(fileTab
      ? [
          { separator: true },
          { label: "复制文件路径", run: () => copyTabPath(tab) },
          { label: "在文件管理器中显示", run: () => revealTab(tab) },
        ]
      : []),
  ]);
}

/** 标签太多被横向滚出视野时，从下拉菜单里直达任意一个。 */
function openTabList(event: MouseEvent): void {
  openMenu(
    event,
    stage.tabs.map((tab) => ({
      label: `${tab.dirty ? "● " : ""}${tab.title}`,
      hint: tab.subtitle,
      run: () => stage.activate(tab.key),
    })),
  );
}

function scrollTabs(event: WheelEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement) || target.scrollWidth <= target.clientWidth) return;
  target.scrollLeft += event.deltaY || event.deltaX;
  event.preventDefault();
}

/** 编辑器内接管 Ctrl+W / Ctrl+Tab；聊天输入框里只吞掉 Ctrl+W，避免 Electron 关掉整个窗口。 */
function onStageKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.shiftKey && event.key !== "Tab")) return;
  if (!stage.tabs.length) return;
  const target = event.target;
  const inStage = target instanceof HTMLElement && Boolean(target.closest(".area-stage"));
  if (event.key === "w" || event.key === "W") {
    event.preventDefault();
    event.stopPropagation();
    const tab = inStage ? stage.activeTab.value : null;
    if (tab) void requestClose(tab);
    return;
  }
  if (!inStage) return;
  if (event.key === "Tab" && stage.tabs.length > 1) {
    event.preventDefault();
    event.stopPropagation();
    const index = stage.tabs.findIndex((tab) => tab.key === stage.activeKey.value);
    const delta = event.shiftKey ? -1 : 1;
    const next = stage.tabs[(Math.max(index, 0) + delta + stage.tabs.length) % stage.tabs.length];
    if (next) stage.activate(next.key);
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    const tab = stage.tabs[Number(event.key) - 1];
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    stage.activate(tab.key);
  }
}

onMounted(() => window.addEventListener("keydown", onStageKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onStageKey, true));
</script>

<template>
  <section v-if="activeTab && stageComponent" class="area-stage">
    <header class="stage-tabbar">
      <div class="stage-tabs" role="tablist" aria-label="打开的内容标签页" @wheel="scrollTabs">
        <div
          v-for="tab in stage.tabs"
          :key="tab.key"
          class="stage-tab"
          :class="{ active: tab.key === stage.activeKey.value }"
          :title="tab.subtitle || tab.title"
          role="tab"
          :aria-selected="tab.key === stage.activeKey.value"
          @click="stage.activate(tab.key)"
          @contextmenu.prevent="openTabMenu($event, tab)"
        >
          <span
            v-if="plugins.get(tab.pluginId)?.icon"
            class="stage-tab-icon"
            v-html="plugins.get(tab.pluginId)?.icon"
          />
          <span class="stage-tab-title">{{ tab.title }}</span>
          <span v-if="tab.dirty" class="stage-tab-dirty" title="未保存修改">●</span>
          <button
            type="button"
            class="stage-tab-close"
            title="关闭标签页 (Ctrl+W)"
            aria-label="关闭标签页"
            aria-keyshortcuts="Control+W"
            @click.stop="requestClose(tab)"
          >
            ×
          </button>
        </div>
      </div>

      <div class="stage-tabbar-actions">
        <button
          v-if="activePlugin"
          type="button"
          class="icon-btn small"
          :title="`打开「${activePlugin.name}」扩展工具面板`"
          @click="focusOwnerPanel"
        >
          <span v-html="activePlugin.icon" />
        </button>
        <button
          type="button"
          class="icon-btn small"
          title="所有标签页"
          aria-label="所有标签页"
          @click="openTabList"
          v-html="icons.more"
        />
        <button
          type="button"
          class="icon-btn small"
          title="关闭全部展示标签"
          aria-label="关闭全部展示标签"
          @click="requestClear()"
          v-html="icons.close"
        />
      </div>
    </header>

    <div class="stage-body">
      <component :is="stageComponent" :key="activeTab.key" :tab="activeTab" />
    </div>
  </section>
</template>
