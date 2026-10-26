<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

const settingsQuery = ref("");
const query = computed(() => settingsQuery.value.trim().toLocaleLowerCase());

const currentTabMeta = computed(() => findSettingsTab(settingsModalState.tab));
const currentSection = computed(() => sectionOfTab(settingsModalState.tab));
const currentSectionTabs = computed(() => sectionTabs(currentSection.value));
const searchResults = computed(() => searchSettings(settingsQuery.value));

function openSection(section: { tabs: SettingsTabId[] }): void {
  settingsModalState.tab = section.tabs[0]!;
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
    settingsVisible.value = false;
    requestAnimationFrame(() => {
      settingsVisible.value = true;
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
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
          <input v-model="settingsQuery" type="search" placeholder="搜索设置" />
        </label>

        <nav class="settings-nav-list">
          <template v-if="query">
            <div class="settings-nav-group">搜索结果</div>
            <button
              v-for="item in searchResults"
              :key="item.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: settingsModalState.tab === item.id }"
              :data-settings-tab="item.id"
              @click="settingsModalState.tab = item.id"
            >
              <span class="settings-nav-icon" v-html="item.icon" />
              <span class="settings-nav-label">{{ item.label }}</span>
              <span class="settings-nav-hint">{{ item.sectionLabel }}</span>
            </button>
            <div v-if="!searchResults.length" class="settings-nav-empty">没有匹配的设置项</div>
          </template>
          <template v-else>
            <button
              v-for="section in SECTIONS"
              :key="section.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: currentSection.id === section.id }"
              :data-settings-section="section.id"
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
        <header class="settings-head">
          <div class="settings-head-text">
            <h2 class="settings-title">{{ currentTabMeta.label }}</h2>
            <p class="settings-desc">{{ currentTabMeta.desc }}</p>
          </div>
          <button type="button" class="icon-btn" title="关闭设置" @click="requestCloseSettings" v-html="icons.close" />
          <div v-if="currentSectionTabs.length > 1" class="settings-subtabs">
            <button
              v-for="tab in currentSectionTabs"
              :key="tab.id"
              type="button"
              class="settings-subtab"
              :class="{ active: tab.id === settingsModalState.tab }"
              :data-settings-tab="tab.id"
              @click="settingsModalState.tab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </header>

        <div class="settings-body">
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

          <LogSettings v-else-if="settingsModalState.tab === 'logs'" />
        </div>
        <footer class="settings-footer">
          <span class="settings-footer-hint">改动会立即生效并保存</span>
          <button type="button" class="btn ghost small" @click="handleResetAll">恢复默认</button>
          <button type="button" class="btn primary small" @click="requestCloseSettings">完成</button>
        </footer>
      </section>
    </div>
    </div>
  </div>
</template>