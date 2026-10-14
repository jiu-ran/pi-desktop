<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useKernel } from "../kernel/use-kernel.js";
import { icons } from "../shared/util.js";

/**
 * 工作台骨架（布局参考 JetBrains Air）：
 *
 *   ┌ titlebar：品牌 · 侧栏开关 · [titlebar 贡献] ………… [statusbar 贡献] · 面板开关 · 系统按钮 ┐
 *   │ [sidebar 岛]  [stage 岛：views.main]  [panel 岛]  [toolstrip 岛]                    │
 *
 * 只负责摆放插槽，不含业务；插件停用，对应区域就消失。
 */
const { contributions, workbench, platform } = useKernel();
const points = contributions.points;
const state = workbench.state;

const sidebarViews = computed(() => points["views.sidebar"]);
const activeSidebar = computed(() => {
  if (!state.sidebarOpen) return null;
  return sidebarViews.value.find((view) => view.id === state.activeSidebar) ?? sidebarViews.value[0] ?? null;
});
const panelViews = computed(() => points["views.panel"]);
const editorViews = computed(() => points["views.editor"]);
const activeEditor = computed(() => editorViews.value.find((view) => !view.when || view.when()) ?? null);
const activePanels = computed(() => state.activePanels
  .map((id) => panelViews.value.find((view) => view.id === id))
  .filter(Boolean));
const mainView = computed(() => points["views.main"].find((view) => !view.when || view.when()) ?? null);
const titleItems = computed(() => points.titlebar);
const statusItems = computed(() => points.statusbar);
const stripItems = computed(() => points.toolstrip);
const sidebarResizing = ref(false);
const panelResizing = ref(false);
const editorResizing = ref(false);
const workspaceEl = ref(null);
const workspaceWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1440);
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 520;
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MAX_WIDTH = 900;
const STAGE_MIN_WIDTH = 340;
const CHROME_RESERVED = 68;
let resizeStartX = 0;
let resizeStartWidth = 0;
let workspaceObserver = null;

function updateWorkspaceWidth() {
  workspaceWidth.value = workspaceEl.value?.clientWidth || window.innerWidth || 1440;
}

const sidebarMaxWidth = computed(() => {
  const reserved = STAGE_MIN_WIDTH
    + (activeEditor.value ? EDITOR_MIN_WIDTH : 0)
    + (activePanels.value.length ? PANEL_MIN_WIDTH : 0)
    + CHROME_RESERVED;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, workspaceWidth.value - reserved));
});
const effectiveSidebarWidth = computed(() => (activeSidebar.value
  ? Math.min(state.sidebarWidth, sidebarMaxWidth.value)
  : 0));

const panelMaxWidth = computed(() => {
  const reserved = effectiveSidebarWidth.value
    + STAGE_MIN_WIDTH
    + (activeEditor.value ? EDITOR_MIN_WIDTH : 0)
    + CHROME_RESERVED;
  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, workspaceWidth.value - reserved));
});
const effectivePanelWidth = computed(() => (activePanels.value.length
  ? Math.min(state.panelWidth, panelMaxWidth.value)
  : 0));

const editorMaxWidth = computed(() => {
  const reserved = effectiveSidebarWidth.value
    + effectivePanelWidth.value
    + STAGE_MIN_WIDTH
    + CHROME_RESERVED;
  return Math.max(EDITOR_MIN_WIDTH, Math.min(EDITOR_MAX_WIDTH, workspaceWidth.value - reserved));
});
const effectiveEditorWidth = computed(() => (activeEditor.value
  ? Math.min(state.editorWidth, editorMaxWidth.value)
  : 0));

function onSidebarPointerMove(event) {
  if (!sidebarResizing.value) return;
  const max = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(
      SIDEBAR_MAX_WIDTH,
      workspaceWidth.value - (STAGE_MIN_WIDTH + effectiveEditorWidth.value + effectivePanelWidth.value + CHROME_RESERVED),
    ),
  );
  state.sidebarWidth = Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidth + event.clientX - resizeStartX));
}
function stopSidebarResize() {
  if (!sidebarResizing.value) return;
  sidebarResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  workbench.setSidebarWidth(state.sidebarWidth);
  window.removeEventListener("pointermove", onSidebarPointerMove);
  window.removeEventListener("pointerup", stopSidebarResize);
  window.removeEventListener("pointercancel", stopSidebarResize);
}
function onPanelPointerMove(event) {
  if (!panelResizing.value) return;
  const max = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(
      PANEL_MAX_WIDTH,
      workspaceWidth.value - (effectiveSidebarWidth.value + STAGE_MIN_WIDTH + effectiveEditorWidth.value + CHROME_RESERVED),
    ),
  );
  const next = Math.min(max, Math.max(PANEL_MIN_WIDTH, resizeStartWidth - (event.clientX - resizeStartX)));
  workbench.setPanelWidth(next);
}
function onEditorPointerMove(event) {
  if (!editorResizing.value) return;
  const next = Math.min(editorMaxWidth.value, Math.max(EDITOR_MIN_WIDTH, resizeStartWidth - (event.clientX - resizeStartX)));
  workbench.setEditorWidth(next);
}
function stopPanelResize() {
  if (!panelResizing.value) return;
  panelResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onPanelPointerMove);
  window.removeEventListener("pointerup", stopPanelResize);
  window.removeEventListener("pointercancel", stopPanelResize);
}
function stopEditorResize() {
  if (!editorResizing.value) return;
  editorResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onEditorPointerMove);
  window.removeEventListener("pointerup", stopEditorResize);
  window.removeEventListener("pointercancel", stopEditorResize);
}
function startPanelResize(event) {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  panelResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = effectivePanelWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPanelPointerMove);
  window.addEventListener("pointerup", stopPanelResize);
  window.addEventListener("pointercancel", stopPanelResize);
  event.preventDefault();
}
function startEditorResize(event) {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  editorResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = effectiveEditorWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onEditorPointerMove);
  window.addEventListener("pointerup", stopEditorResize);
  window.addEventListener("pointercancel", stopEditorResize);
  event.preventDefault();
}
function resizePanelByKeyboard(event) {
  const step = event.shiftKey ? 32 : 12;
  if (event.key === "ArrowLeft") workbench.setPanelWidth(Math.min(panelMaxWidth.value, effectivePanelWidth.value + step));
  else if (event.key === "ArrowRight") workbench.setPanelWidth(Math.max(PANEL_MIN_WIDTH, effectivePanelWidth.value - step));
  else if (event.key === "Home") workbench.setPanelWidth(PANEL_MIN_WIDTH);
  else if (event.key === "End") workbench.setPanelWidth(panelMaxWidth.value);
  else return;
  event.preventDefault();
}
function resizeEditorByKeyboard(event) {
  const step = event.shiftKey ? 32 : 12;
  if (event.key === "ArrowLeft") workbench.setEditorWidth(Math.min(editorMaxWidth.value, effectiveEditorWidth.value + step));
  else if (event.key === "ArrowRight") workbench.setEditorWidth(Math.max(EDITOR_MIN_WIDTH, effectiveEditorWidth.value - step));
  else if (event.key === "Home") workbench.setEditorWidth(EDITOR_MIN_WIDTH);
  else if (event.key === "End") workbench.setEditorWidth(editorMaxWidth.value);
  else return;
  event.preventDefault();
}
function startSidebarResize(event) {
  if (event.button !== 0) return;
  updateWorkspaceWidth();
  sidebarResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = effectiveSidebarWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onSidebarPointerMove);
  window.addEventListener("pointerup", stopSidebarResize);
  window.addEventListener("pointercancel", stopSidebarResize);
  event.preventDefault();
}
function resizeSidebarByKeyboard(event) {
  const step = event.shiftKey ? 32 : 12;
  if (event.key === "ArrowLeft") workbench.setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, effectiveSidebarWidth.value - step));
  else if (event.key === "ArrowRight") workbench.setSidebarWidth(Math.min(sidebarMaxWidth.value, effectiveSidebarWidth.value + step));
  else if (event.key === "Home") workbench.setSidebarWidth(SIDEBAR_MIN_WIDTH);
  else if (event.key === "End") workbench.setSidebarWidth(sidebarMaxWidth.value);
  else return;
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
  stopEditorResize();
  window.removeEventListener("resize", updateWorkspaceWidth);
  workspaceObserver?.disconnect();
});

function togglePanel(id) {
  const index = state.activePanels.indexOf(id);
  if (index >= 0) state.activePanels.splice(index, 1);
  else state.activePanels.push(id);
}
function togglePanelArea() {
  if (state.activePanels.length) state.activePanels.splice(0, state.activePanels.length);
  else if (panelViews.value[0]?.id) state.activePanels.push(panelViews.value[0].id);
}
function closePanel(id) {
  const index = state.activePanels.indexOf(id);
  if (index >= 0) state.activePanels.splice(index, 1);
}
</script>

<template>
  <div class="shell" :data-platform="platform">
    <header class="titlebar">
      <div class="tb-left">
        <span class="tb-logo" title="Pi Desktop">π</span>
        <button
          class="tb-btn"
          :class="{ active: state.sidebarOpen }"
          title="任务列表 (Ctrl+B)"
          @click="state.sidebarOpen = !state.sidebarOpen"
          v-html="icons.sidebar"
        />
        <component :is="item.component" v-for="item in titleItems" :key="item.id" />
      </div>
      <div class="tb-right">
        <component :is="item.component" v-for="item in statusItems" :key="item.id" />
        <button
          v-if="panelViews.length"
          class="tb-btn"
          :class="{ active: activePanels.length }"
          title="切换右侧面板"
          @click="togglePanelArea"
          v-html="icons.panel"
        />
      </div>
    </header>

    <div ref="workspaceEl" class="workspace">
      <aside v-if="activeSidebar" class="island sidebar" :style="{ width: `${effectiveSidebarWidth}px` }">
        <header v-if="sidebarViews.length > 1" class="pane-tabs">
          <button
            v-for="view in sidebarViews"
            :key="view.id"
            class="pane-tab"
            :class="{ active: activeSidebar.id === view.id }"
            @click="state.activeSidebar = view.id"
          >
            {{ view.title }}
          </button>
        </header>
        <component :is="activeSidebar.component" class="pane-body" />
      </aside>
      <div
        v-if="activeSidebar"
        class="sidebar-resizer"
        :class="{ dragging: sidebarResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        :aria-valuenow="effectiveSidebarWidth"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuemax="sidebarMaxWidth"
        tabindex="0"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown="startSidebarResize"
        @dblclick="workbench.setSidebarWidth(272)"
        @keydown="resizeSidebarByKeyboard"
      />

      <main class="island stage">
        <component :is="mainView.component" v-if="mainView" />
        <div v-else class="stage-empty">没有插件提供主视图</div>
      </main>

      <div
        v-if="activeEditor"
        class="editor-resizer"
        :class="{ dragging: editorResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整文件内容宽度"
        :aria-valuenow="effectiveEditorWidth"
        :aria-valuemin="EDITOR_MIN_WIDTH"
        :aria-valuemax="editorMaxWidth"
        tabindex="0"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown="startEditorResize"
        @dblclick="workbench.setEditorWidth(520)"
        @keydown="resizeEditorByKeyboard"
      />
      <main v-if="activeEditor" class="island editor" :style="{ width: `${effectiveEditorWidth}px` }">
        <component :is="activeEditor.component" />
      </main>

      <div
        v-if="activePanels.length"
        class="panel-resizer"
        :class="{ dragging: panelResizing }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧面板宽度"
        :aria-valuenow="effectivePanelWidth"
        :aria-valuemin="PANEL_MIN_WIDTH"
        :aria-valuemax="panelMaxWidth"
        tabindex="0"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown="startPanelResize"
        @dblclick="workbench.setPanelWidth(360)"
        @keydown="resizePanelByKeyboard"
      />
      <aside v-if="activePanels.length" class="island panel panel-stack" :style="{ width: `${effectivePanelWidth}px` }">
        <section v-for="panel in activePanels" :key="panel.id" class="panel-section">
          <header class="pane-head">
            <span>{{ panel.title }}</span>
            <button class="icon-btn small" title="关闭" @click="closePanel(panel.id)" v-html="icons.close" />
          </header>
          <component :is="panel.component" class="pane-body" />
        </section>
      </aside>

      <nav class="island toolstrip">
        <button
          v-for="view in panelViews"
          :key="view.id"
          class="strip-btn"
          :class="{ active: state.activePanels.includes(view.id) }"
          :title="view.title"
          @click="togglePanel(view.id)"
        >
          <span class="strip-icon" v-html="view.icon" />
          <span v-if="view.badge?.()" class="strip-badge">{{ view.badge() }}</span>
        </button>
        <div class="strip-spacer" />
        <button
          v-for="item in stripItems"
          :key="item.id"
          class="strip-btn"
          :class="{ active: item.active?.() }"
          :title="item.title"
          @click="item.run()"
        >
          <span class="strip-icon" v-html="typeof item.icon === 'function' ? item.icon() : item.icon" />
        </button>
      </nav>
    </div>

    <component :is="overlay.component" v-for="overlay in points.overlays" :key="overlay.id" />
  </div>
</template>
