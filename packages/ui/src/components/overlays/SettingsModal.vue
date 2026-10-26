<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import {
  appSettings,
  closeSettingsModal,
  DEFAULT_SETTINGS,
  resetSettingsToDefault,
  settingsModalState,
  type SettingsTabId,
} from "../../services/settings.ts";
import {
  ACCENTS,
  COLUMN_WIDTHS,
  RADIUS_PRESETS,
  THEME_MODES,
  emphasisColor,
  normalizeHex,
  type EmphasisMode,
  type ThemeMode,
} from "../../shared/appearance.ts";
import { icons, shortPath, thinkingLabel } from "../../shared/util.ts";
import AgentSettings from "./settings/AgentSettings.vue";
import SkillSettings from "./settings/SkillSettings.vue";
import AppearanceSettings from "./settings/AppearanceSettings.vue";
import ConversationSettings from "./settings/ConversationSettings.vue";
import EnvironmentSettings from "./settings/EnvironmentSettings.vue";
import LogSettings from "./settings/LogSettings.vue";
import McpSettings from "./settings/McpSettings.vue";
import PiCliSettings from "./settings/PiCliSettings.vue";
import PiDesktopSettings from "./settings/PiDesktopSettings.vue";
import PackageSettings from "./settings/PackageSettings.vue";
import PluginSettings from "./settings/PluginSettings.vue";
import {
  SETTINGS_SECTIONS as SECTIONS,
  findSettingsTab,
  searchSettings,
  sectionOfTab,
  sectionTabs,
} from "./settings/settings-tabs.ts";

const TerminalSettings = defineAsyncComponent(() => import("../terminal/TerminalSettings.vue"));
const { workbench, plugins, bus } = useKernel();
const state = workbench.state;
const ws = computed(() => workbench.active.value);

const searchShortcut = (globalThis as any).piDesktop?.platform === "darwin" ? "⌘K" : "Ctrl K";
/** 内容区滚动后给页头补一条阴影（细节：否则长页面滚上去会和标题糊在一起） */
const bodyScrolled = ref(false);
function onBodyScroll(): void {
  bodyScrolled.value = (bodyRef.value?.scrollTop ?? 0) > 4;
}
const settingsQuery = ref("");
const query = computed(() => settingsQuery.value.trim().toLocaleLowerCase());
const searchInput = ref<HTMLInputElement | null>(null);
const bodyRef = ref<HTMLElement | null>(null);
const searchIndex = ref(0);

const currentTabMeta = computed(() => findSettingsTab(settingsModalState.tab));
const currentSection = computed(() => sectionOfTab(settingsModalState.tab));
const currentSectionTabs = computed(() => sectionTabs(currentSection.value));
const searchResults = computed(() => searchSettings(settingsQuery.value));

/** 改动计数：和默认值不同的字段（数组按内容比） */
const changedCount = computed(() => {
  const current = appSettings as unknown as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  return Object.keys(defaults).filter((key) => {
    const left = current[key];
    const right = defaults[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length !== right.length || left.some((item, index) => item !== right[index]);
    }
    return left !== right;
  }).length;
});

watch(searchResults, () => {
  searchIndex.value = 0;
});

/** 换页 / 换分区后回到顶部：否则会停在上一页滚到的位置 */
watch(
  () => settingsModalState.tab,
  () => {
    bodyRef.value?.scrollTo({ top: 0 });
    bodyScrolled.value = false;
  },
);

function openSection(section: { tabs: SettingsTabId[] }): void {
  settingsModalState.tab = section.tabs[0]!;
}

/** 选中搜索结果：切到那一页并收起搜索，回到正常导航 */
function selectResult(id: SettingsTabId): void {
  settingsModalState.tab = id;
  settingsQuery.value = "";
}

/** 二级 tab 用 ←/→ 切换（并保持焦点在 tab 条上） */
function moveSubtab(delta: number): void {
  const tabs = currentSectionTabs.value;
  if (tabs.length < 2) return;
  const index = tabs.findIndex((tab) => tab.id === settingsModalState.tab);
  const next = tabs[Math.min(tabs.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
  if (!next || next.id === settingsModalState.tab) return;
  settingsModalState.tab = next.id;
  void nextTick(() => document.querySelector<HTMLElement>(`.settings-subtab[data-settings-tab="${next.id}"]`)?.focus());
}

function focusSearch(): void {
  searchInput.value?.focus();
  searchInput.value?.select();
}

function onSearchKeydown(event: KeyboardEvent): void {
  const total = searchResults.value.length;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    searchIndex.value = total ? Math.min(total - 1, searchIndex.value + 1) : 0;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    searchIndex.value = Math.max(0, searchIndex.value - 1);
  } else if (event.key === "Enter") {
    const target = searchResults.value[searchIndex.value];
    if (target) {
      event.preventDefault();
      selectResult(target.id);
    }
  }
}

/** Esc 先收搜索、再关窗口；Ctrl/Cmd+K 聚焦搜索 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (!settingsModalState.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (settingsQuery.value) settingsQuery.value = "";
    else requestCloseSettings();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    focusSearch();
  }
}

function handleResetAll(): void {
  resetSettingsToDefault();
  workbench.setSidebarWidth(272);
  workbench.setStageWidth(520);
  workbench.setPanelWidth(320);
  bus.emit("notify", { level: "info", text: "已恢复默认偏好设置" });
}

const settingsVisible = ref(false);
const settingsLeaving = ref(false);
const settingsOffset = ref({ x: 0, y: 0 });
let settingsLeaveTimer = 0;
let settingsDrag: { x: number; y: number; originX: number; originY: number } | null = null;

function startSettingsDrag(event: PointerEvent): void {
  const modal = event.currentTarget as HTMLElement;
  const bounds = modal.getBoundingClientRect();
  const edge = 8;
  const onEdge = event.clientX <= bounds.left + edge
    || event.clientX >= bounds.right - edge
    || event.clientY <= bounds.top + edge
    || event.clientY >= bounds.bottom - edge;
  if (!onEdge) return;
  settingsDrag = {
    x: event.clientX,
    y: event.clientY,
    originX: settingsOffset.value.x,
    originY: settingsOffset.value.y,
  };
  modal.setPointerCapture(event.pointerId);
}

function moveSettingsDrag(event: PointerEvent): void {
  if (!settingsDrag) return;
  settingsOffset.value = {
    x: settingsDrag.originX + event.clientX - settingsDrag.x,
    y: settingsDrag.originY + event.clientY - settingsDrag.y,
  };
}

function stopSettingsDrag(): void {
  settingsDrag = null;
}

function requestCloseSettings(): void {
  if (!settingsModalState.open || settingsLeaving.value) return;
  settingsLeaving.value = true;
  window.clearTimeout(settingsLeaveTimer);
  settingsLeaveTimer = window.setTimeout(() => {
    settingsLeaving.value = false;
    closeSettingsModal();
  }, 180);
}

watch(
  () => settingsModalState.open,
  (open) => {
    if (!open) {
      settingsVisible.value = false;
      return;
    }
    settingsLeaving.value = false;
    settingsOffset.value = { x: 0, y: 0 };
    settingsQuery.value = "";
    searchIndex.value = 0;
    settingsVisible.value = false;
    requestAnimationFrame(() => {
      settingsVisible.value = true;
    });
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("keydown", onWindowKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
  window.clearTimeout(settingsLeaveTimer);
});
</script>

<template>
  <div
    v-if="settingsModalState.open"
    class="overlay settings-overlay"
    :class="{ open: settingsVisible && !settingsLeaving, leaving: settingsLeaving }"
  >
    <div
      class="settings-modal-position"
      :style="{ '--settings-x': `${settingsOffset.x}px`, '--settings-y': `${settingsOffset.y}px` }"
      @pointerdown="startSettingsDrag"
      @pointermove="moveSettingsDrag"
      @pointerup="stopSettingsDrag"
      @pointercancel="stopSettingsDrag"
    >
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="偏好设置">
      <!-- 左侧导航栏 -->
      <aside class="settings-nav">
        <div class="settings-brand">
          <span class="settings-brand-icon" v-html="icons.sliders" />
          <div class="settings-brand-text">
            <div class="settings-brand-title">设置</div>
            <div class="settings-brand-sub">Pi Desktop</div>
          </div>
        </div>
        <label class="settings-search">
          <span v-html="icons.search" />
          <input
            ref="searchInput"
            v-model="settingsQuery"
            type="search"
            placeholder="搜索设置"
            aria-label="搜索设置"
            @keydown="onSearchKeydown"
          />
          <kbd v-if="!query" class="settings-search-kbd">{{ searchShortcut }}</kbd>
          <button v-else type="button" class="settings-search-clear" title="清除搜索" aria-label="清除搜索" @click="settingsQuery = ''" v-html="icons.close" />
        </label>

        <nav class="settings-nav-list">
          <template v-if="query">
            <div class="settings-nav-group">搜索结果</div>
            <button
              v-for="(item, index) in searchResults"
              :key="item.id"
              type="button"
              class="settings-nav-item settings-result-item"
              :class="{ active: settingsModalState.tab === item.id, keyboard: index === searchIndex }"
              :data-settings-tab="item.id"
              :data-settings-result="item.id"
              @click="selectResult(item.id)"
              @pointermove="searchIndex = index"
            >
              <span class="settings-nav-icon" v-html="item.icon" />
              <span class="settings-nav-label">{{ item.label }}</span>
              <span v-if="item.keyword" class="settings-nav-keyword">{{ item.keyword }}</span>
              <span class="settings-nav-hint">{{ item.sectionLabel }}</span>
            </button>
            <div v-if="!searchResults.length" class="settings-nav-empty">
              <p>没有匹配「{{ settingsQuery }}」的设置项</p>
              <p class="settings-nav-suggest">试试：深色 · 字号 · 快捷键 · 日志 · MCP</p>
            </div>
            <div v-else class="settings-nav-group settings-nav-keyhint">↑↓ 选择 · Enter 打开</div>
          </template>
          <template v-else>
            <button
              v-for="section in SECTIONS"
              :key="section.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: currentSection.id === section.id }"
              :data-settings-section="section.id"
              :aria-current="currentSection.id === section.id ? 'page' : undefined"
              :title="`${section.label} · ${section.desc}`"
              @click="openSection(section)"
            >
              <span class="settings-nav-icon" v-html="section.icon" />
              <span class="settings-nav-label">{{ section.label }}</span>
              <span class="settings-nav-count">{{ section.tabs.length }}</span>
            </button>
          </template>
        </nav>

        <div class="settings-nav-foot">
          <span><kbd>Esc</kbd> 关闭</span>
          <span>拖动边缘可移动</span>
        </div>
      </aside>

      <!-- 右侧内容区 -->
      <section class="settings-main">
        <header class="settings-head" :class="{ scrolled: bodyScrolled }">
          <div class="settings-head-text">
            <h2 class="settings-title">{{ currentTabMeta.label }}</h2>
            <p class="settings-desc">{{ currentTabMeta.desc }}</p>
          </div>
          <button type="button" class="icon-btn" title="关闭设置" @click="requestCloseSettings" v-html="icons.close" />
          <div
            v-if="currentSectionTabs.length > 1"
            class="settings-subtabs"
            role="tablist"
            aria-label="本分区页面"
            @keydown.left.prevent="moveSubtab(-1)"
            @keydown.right.prevent="moveSubtab(1)"
          >
            <button
              v-for="tab in currentSectionTabs"
              :key="tab.id"
              type="button"
              role="tab"
              class="settings-subtab"
              :class="{ active: tab.id === settingsModalState.tab }"
              :data-settings-tab="tab.id"
              :aria-selected="tab.id === settingsModalState.tab"
              :tabindex="tab.id === settingsModalState.tab ? 0 : -1"
              @click="settingsModalState.tab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </header>

        <div ref="bodyRef" class="settings-body" @scroll.passive="onBodyScroll">
          <ConversationSettings v-if="settingsModalState.tab === 'conversation'" />

          <!-- 2. 外观与布局 -->
          <AppearanceSettings v-else-if="settingsModalState.tab === 'appearance'" />

          <TerminalSettings v-else-if="settingsModalState.tab === 'terminal'" />
          <McpSettings v-else-if="settingsModalState.tab === 'mcp'" />

          <PackageSettings v-else-if="settingsModalState.tab === 'packages'" />

          <AgentSettings v-else-if="settingsModalState.tab === 'agents'" />
          <SkillSettings v-else-if="settingsModalState.tab === 'skills'" />

          <PluginSettings v-else-if="settingsModalState.tab === 'plugins'" />

          <!-- 6. 环境与快捷键 -->
          <EnvironmentSettings v-else-if="settingsModalState.tab === 'environment'" />

          <PiCliSettings v-else-if="settingsModalState.tab === 'pi-cli'" />

          <PiDesktopSettings v-else-if="settingsModalState.tab === 'pi-desktop'" />

          <LogSettings v-else-if="settingsModalState.tab === 'logs'" />
        </div>
        <footer class="settings-footer">
          <span class="settings-footer-hint">
            改动会立即生效并保存
            <template v-if="changedCount"> · 已改动 {{ changedCount }} 项</template>
          </span>
          <button type="button" class="btn ghost small" :disabled="!changedCount" @click="handleResetAll">恢复默认</button>
          <button type="button" class="btn primary small" @click="requestCloseSettings">完成</button>
        </footer>
      </section>
    </div>
    </div>
  </div>
</template>