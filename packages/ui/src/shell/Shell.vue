<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useKernel } from "../kernel/use-kernel.ts";
import TitleBar from "../components/titlebar/TitleBar.vue";
import LeftSidebar from "../components/sidebar/LeftSidebar.vue";
import TaskOverlays from "../components/sidebar/TaskOverlays.vue";
import AgentChat from "../components/chat/AgentChat.vue";
import ContentStage from "../components/stage/ContentStage.vue";
import RightPanel from "../components/panel/RightPanel.vue";
import ActivityBar from "../components/panel/ActivityBar.vue";
import CommandPalette from "../components/overlays/CommandPalette.vue";
import QuickOpen from "../components/overlays/QuickOpen.vue";
import SettingsModal from "../components/overlays/SettingsModal.vue";
import ExtensionDialog from "../components/overlays/ExtensionDialog.vue";
import Toasts from "../components/overlays/Toasts.vue";

/**
 * 工作台四区域 + 右侧边栏骨架：
 *
 *   ┌ TitleBar ──────────────────────────────────────────────────────────────────┐
 *   │ [ 1区域 LeftSidebar ] [ 2区域 AgentChat ] [ 3区域 ContentStage ] [ 4区域 RightPanel ] [ 右侧边栏 ActivityBar ] │
 *   └────────────────────────────────────────────────────────────────────────────┘
 */
const { workbench, stage, plugins, platform } = useKernel();
const state = workbench.state;

const hasStage = computed(() => {
  const activeTab = stage.activeTab.value;
  if (!activeTab) return false;
  const owner = plugins.get(activeTab.pluginId);
  return Boolean(owner?.enabled && owner?.stage);
});

const hasPanel = computed(() => {
  const id = state.activePanelId;
  if (!id) return false;
  const plugin = plugins.get(id);
  return Boolean(plugin?.enabled && plugin?.panel);
});

const sidebarResizing = ref(false);
const panelResizing = ref(false);
const stageResizing = ref(false);
const workspaceEl = ref<HTMLElement | null>(null);
const workspaceWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1440);

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const PANEL_MIN_WIDTH = 290;
const PANEL_MAX_WIDTH = 640;
const STAGE_VIEW_MIN_WIDTH = 240;
const STAGE_VIEW_MAX_WIDTH = 1000;
const CHAT_MIN_WIDTH = 260;
// 预留右侧 ActivityBar (38px) + workspace 左右内边距 (10px) + 最多 4 个岛屿间隙 (20px) + 安全余量 (8px) = 76px
const CHROME_RESERVED = 76;

let resizeStartX = 0;
let resizeStartSidebar = 0;
let resizeStartStage = 0;
let resizeStartPanel = 0;
let workspaceObserver: ResizeObserver | null = null;

function clamp(val: number, min: number, max: number): number {
  const safeMax = Math.max(min, max);
  return Math.min(safeMax, Math.max(min, val));
}

function updateWorkspaceWidth(): void {
  workspaceWidth.value = workspaceEl.value?.clientWidth || window.innerWidth || 1440;
}

/**
 * 除 2 区域（对话主窗口，最小 CHAT_MIN_WIDTH）和右侧 ActivityBar 外，
 * 1 区域 + 3 区域 + 4 区域可共同占用的最大总宽度预算。
 */
const panelsBudget = computed(() =>
  Math.max(
    0,
    workspaceWidth.value - CHAT_MIN_WIDTH - CHROME_RESERVED,
  ),
);

const effectiveWidths = computed(() => {
  const w1 = state.sidebarOpen ? clamp(state.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) : 0;
  const min1 = state.sidebarOpen ? SIDEBAR_MIN_WIDTH : 0;

  const w3 = hasStage.value ? clamp(state.stageWidth, STAGE_VIEW_MIN_WIDTH, STAGE_VIEW_MAX_WIDTH) : 0;
  const min3 = hasStage.value ? STAGE_VIEW_MIN_WIDTH : 0;

  const w4 = hasPanel.value ? clamp(state.panelWidth, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH) : 0;
  const min4 = hasPanel.value ? PANEL_MIN_WIDTH : 0;

  const totalWanted = w1 + w3 + w4;
  const budget = panelsBudget.value;

  if (totalWanted <= budget) {
    return { sidebar: w1, stage: w3, panel: w4 };
  }

  const totalMin = min1 + min3 + min4;
  const extraWanted = totalWanted - totalMin;
  const extraBudget = Math.max(0, budget - totalMin);
  const ratio = extraWanted > 0 ? Math.min(1, extraBudget / extraWanted) : 0;

  const sidebar = state.sidebarOpen ? Math.round(min1 + (w1 - min1) * ratio) : 0;
  const panel = hasPanel.value ? Math.round(min4 + (w4 - min4) * ratio) : 0;
  const stage = hasStage.value
    ? clamp(budget - sidebar - panel, STAGE_VIEW_MIN_WIDTH, Math.round(min3 + (w3 - min3) * ratio))
    : 0;

  return { sidebar, stage, panel };
});

const effectiveSidebarWidth = computed(() => effectiveWidths.value.sidebar);
const effectiveStageWidth = computed(() => effectiveWidths.value.stage);
const effectivePanelWidth = computed(() => effectiveWidths.value.panel);

// 1 区域 <-> 2 区域 分隔条拖拽
function onSidebarPointerMove(event: PointerEvent): void {
  if (!sidebarResizing.value) return;
  const dx = event.clientX - resizeStartX;
  const desiredSidebar = clamp(resizeStartSidebar + dx, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
  const minStage = hasStage.value ? STAGE_VIEW_MIN_WIDTH : 0;
  const minPanel = hasPanel.value ? PANEL_MIN_WIDTH : 0;
  const hardMaxSidebar = Math.min(SIDEBAR_MAX_WIDTH, panelsBudget.value - minStage - minPanel);
  const nextSidebar = clamp(desiredSidebar, SIDEBAR_MIN_WIDTH, hardMaxSidebar);
  workbench.setSidebarWidth(nextSidebar, false);

  // 若总宽度超出预算，优先压缩 3 区域，其次才收回 4 区域超出最小宽度的部分
  let remaining = panelsBudget.value - nextSidebar;
  if (hasPanel.value) {
    const nextPanel = clamp(resizeStartPanel, PANEL_MIN_WIDTH, remaining - minStage);
    workbench.setPanelWidth(nextPanel, false);
    remaining -= nextPanel;
  }
  if (hasStage.value) {
    const nextStage = clamp(resizeStartStage, STAGE_VIEW_MIN_WIDTH, remaining);
    workbench.setStageWidth(nextStage, false);
  }
}

function commitWidths(): void {
  if (state.sidebarOpen) workbench.setSidebarWidth(effectiveSidebarWidth.value);
  if (hasStage.value) workbench.setStageWidth(effectiveStageWidth.value);
  if (hasPanel.value) workbench.setPanelWidth(effectivePanelWidth.value);
}

function stopSidebarResize(): void {
  if (!sidebarResizing.value) return;
  commitWidths();
  sidebarResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onSidebarPointerMove);
  window.removeEventListener("pointerup", stopSidebarResize);
  window.removeEventListener("pointercancel", stopSidebarResize);
}

// 2 区域 <-> 3 区域 分隔条拖拽（保护 1 区域与 4 区域侧边栏不被挤压异常）
function onStagePointerMove(event: PointerEvent): void {
  if (!stageResizing.value) return;
  const dx = event.clientX - resizeStartX;
  // 向左拖动 (dx < 0) 增大 3 区域宽度，向右拖动减小 3 区域宽度
  const desiredStage = clamp(resizeStartStage - dx, STAGE_VIEW_MIN_WIDTH, STAGE_VIEW_MAX_WIDTH);
  const protectedSidebar = state.sidebarOpen ? Math.min(resizeStartSidebar, 272) : 0;
  const protectedPanel = hasPanel.value ? Math.min(resizeStartPanel, 280) : 0;
  const hardMaxStage = Math.min(
    STAGE_VIEW_MAX_WIDTH,
    panelsBudget.value - protectedSidebar - protectedPanel,
  );
  const nextStage = clamp(desiredStage, STAGE_VIEW_MIN_WIDTH, hardMaxStage);
  workbench.setStageWidth(nextStage, false);

  let remaining = panelsBudget.value - nextStage;
  if (state.sidebarOpen) {
    const nextSidebar = clamp(resizeStartSidebar, protectedSidebar, remaining - protectedPanel);
    workbench.setSidebarWidth(nextSidebar, false);
    remaining -= nextSidebar;
  }
  if (hasPanel.value) {
    const nextPanel = clamp(resizeStartPanel, protectedPanel, remaining);
    workbench.setPanelWidth(nextPanel, false);
  }
}

function stopStageResize(): void {
  if (!stageResizing.value) return;
  commitWidths();
  stageResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onStagePointerMove);
  window.removeEventListener("pointerup", stopStageResize);
  window.removeEventListener("pointercancel", stopStageResize);
}

// 3 区域（或 2 区域） <-> 4 区域 分隔条拖拽
function onPanelPointerMove(event: PointerEvent): void {
  if (!panelResizing.value) return;
  const dx = event.clientX - resizeStartX;
  // 向左拖动 (dx < 0) 增大 4 区域宽度，向右拖动减小 4 区域宽度
  const desiredPanel = clamp(resizeStartPanel - dx, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
  const protectedSidebar = state.sidebarOpen ? Math.min(resizeStartSidebar, 272) : 0;
  const minStage = hasStage.value ? STAGE_VIEW_MIN_WIDTH : 0;
  const hardMaxPanel = Math.min(
    PANEL_MAX_WIDTH,
    panelsBudget.value - protectedSidebar - minStage,
  );
  const nextPanel = clamp(desiredPanel, PANEL_MIN_WIDTH, hardMaxPanel);
  workbench.setPanelWidth(nextPanel, false);

  let remaining = panelsBudget.value - nextPanel;
  if (state.sidebarOpen) {
    const nextSidebar = clamp(resizeStartSidebar, protectedSidebar, remaining - minStage);
    workbench.setSidebarWidth(nextSidebar, false);
    remaining -= nextSidebar;
  }
  if (hasStage.value) {
    const totalStageAndPanel = Math.min(remaining + nextPanel, resizeStartStage + resizeStartPanel);
    const nextStage = clamp(
      totalStageAndPanel - nextPanel,
      STAGE_VIEW_MIN_WIDTH,
      Math.min(STAGE_VIEW_MAX_WIDTH, remaining),
    );
    workbench.setStageWidth(nextStage, false);
  }
}

function stopPanelResize(): void {
  if (!panelResizing.value) return;
  commitWidths();
  panelResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPanelPointerMove);
  window.removeEventListener("pointerup", stopPanelResize);
  window.removeEventListener("pointercancel", stopPanelResize);
}

function resizeByKeyboard(kind: "sidebar" | "stage" | "panel", event: KeyboardEvent): void {
  const step = event.shiftKey ? 40 : 16;
  const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  if (event.key === "Home" || event.key === "End") {
    const value = event.key === "Home"
      ? kind === "sidebar" ? SIDEBAR_MIN_WIDTH : kind === "stage" ? STAGE_VIEW_MIN_WIDTH : PANEL_MIN_WIDTH
      : kind === "sidebar" ? SIDEBAR_MAX_WIDTH : kind === "stage" ? STAGE_VIEW_MAX_WIDTH : PANEL_MAX_WIDTH;
    if (kind === "sidebar") workbench.setSidebarWidth(value);
    else if (kind === "stage") workbench.setStageWidth(value);
    else workbench.setPanelWidth(value);
    event.preventDefault();
    return;
  }
  if (!delta) return;
  if (kind === "sidebar") workbench.setSidebarWidth(state.sidebarWidth + delta);
  else if (kind === "stage") workbench.setStageWidth(state.stageWidth + delta);
  else workbench.setPanelWidth(state.panelWidth + delta);
  event.preventDefault();
}

function syncEffectiveWidthsToState(): void {
  if (state.sidebarOpen) workbench.setSidebarWidth(effectiveSidebarWidth.value, false);
  if (hasStage.value) workbench.setStageWidth(effectiveStageWidth.value, false);
  if (hasPanel.value) workbench.setPanelWidth(effectivePanelWidth.value, false);
}

function startSidebarResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  syncEffectiveWidthsToState();
  sidebarResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartSidebar = effectiveSidebarWidth.value;
  resizeStartStage = effectiveStageWidth.value;
  resizeStartPanel = effectivePanelWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onSidebarPointerMove);
  window.addEventListener("pointerup", stopSidebarResize);
  window.addEventListener("pointercancel", stopSidebarResize);
  event.preventDefault();
}

function startStageResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  syncEffectiveWidthsToState();
  stageResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartSidebar = effectiveSidebarWidth.value;
  resizeStartStage = effectiveStageWidth.value;
  resizeStartPanel = effectivePanelWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onStagePointerMove);
  window.addEventListener("pointerup", stopStageResize);
  window.addEventListener("pointercancel", stopStageResize);
  event.preventDefault();
}

function startPanelResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  syncEffectiveWidthsToState();
  panelResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartSidebar = effectiveSidebarWidth.value;
  resizeStartPanel = effectivePanelWidth.value;
  resizeStartStage = effectiveStageWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPanelPointerMove);
  window.addEventListener("pointerup", stopPanelResize);
  window.addEventListener("pointercancel", stopPanelResize);
  event.preventDefault();
}

onMounted(() => {
  updateWorkspaceWidth();
  window.addEventListener("resize", updateWorkspaceWidth);
  if (typeof ResizeObserver !== "undefined" && workspaceEl.value) {
    workspaceObserver = new ResizeObserver(updateWorkspaceWidth);
    workspaceObserver.observe(workspaceEl.value);
  }
});

onBeforeUnmount(() => {
  stopSidebarResize();
  stopPanelResize();
  stopStageResize();
  window.removeEventListener("resize", updateWorkspaceWidth);
  workspaceObserver?.disconnect();
});
</script>

<template>
  <div class="shell" :data-platform="platform">
    <TitleBar />

    <div ref="workspaceEl" class="workspace">
      <!-- 项目与会话栏（LeftSidebar） -->
      <aside v-if="state.sidebarOpen" class="island sidebar" :style="{ width: `${effectiveSidebarWidth}px` }">
        <LeftSidebar />
      </aside>
      <div
        v-if="state.sidebarOpen"
        class="sidebar-resizer"
        :class="{ dragging: sidebarResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整项目与会话栏宽度"
        tabindex="0"
        title="拖动调整项目与会话栏宽度，双击恢复默认"
        @pointerdown="startSidebarResize"
        @keydown="resizeByKeyboard('sidebar', $event)"
        @dblclick="workbench.setSidebarWidth(272)"
      />

      <!-- Agent 对话区（AgentChat） -->
      <main class="island stage">
        <AgentChat />
      </main>

      <!-- 编辑器与详情视图（ContentStage：代码编辑 / Diff / Git 详情 / 事件载荷） -->
      <div
        v-if="hasStage"
        class="editor-resizer"
        :class="{ dragging: stageResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整编辑器与详情视图宽度"
        tabindex="0"
        title="拖动调整编辑器与详情视图宽度，双击恢复默认"
        @pointerdown="startStageResize"
        @keydown="resizeByKeyboard('stage', $event)"
        @dblclick="workbench.setStageWidth(520)"
      />
      <section
        v-if="hasStage"
        class="island editor"
        :style="{ width: `${effectiveStageWidth}px` }"
      >
        <ContentStage />
      </section>

      <!-- 扩展工具面板（RightPanel：文件树 / 变更列表 / Git 树 / 事件流） -->
      <div
        v-if="hasPanel"
        class="panel-resizer"
        :class="{ dragging: panelResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整扩展工具面板宽度"
        tabindex="0"
        title="拖动调整扩展工具面板宽度，双击恢复默认"
        @pointerdown="startPanelResize"
        @keydown="resizeByKeyboard('panel', $event)"
        @dblclick="workbench.setPanelWidth(320)"
      />
      <aside
        v-if="hasPanel"
        class="island panel"
        :style="{ width: `${effectivePanelWidth}px` }"
      >
        <RightPanel />
      </aside>

      <!-- 插件活动栏（ActivityBar） -->
      <ActivityBar class="island toolstrip" />
    </div>

    <TaskOverlays />
    <CommandPalette />
    <QuickOpen />
    <SettingsModal />
    <ExtensionDialog />
    <Toasts />
  </div>
</template>
