<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { extState } from "../../services/extension-ui.ts";
import { openSettingsModal, settingsModalState } from "../../services/settings.ts";
import { icons } from "../../shared/util.ts";
import WindowControls from "./WindowControls.vue";

/**
 * 顶部标题栏：
 * 左侧：应用徽标 · 项目与会话栏开关 · 新建任务 · 项目/分支/任务面包屑
 * 右侧：扩展状态 · Pi CLI 连接状态 · 主题切换 · 偏好设置 · 扩展工具面板开关
 */
const platform = (globalThis as any).piDesktop?.platform ?? "web";
const windowControls = (globalThis as any).piDesktop?.windowControls as
  | { toggleMaximize: () => Promise<boolean> }
  | undefined;

/** 无边框窗口不再有系统标题栏，双击最大化要自己接（点按钮不算） */
function onTitlebarDoubleClick(event: MouseEvent): void {
  if (!windowControls) return;
  if ((event.target as HTMLElement | null)?.closest("button")) return;
  void windowControls.toggleMaximize();
}
const { workbench, plugins, theme, terminal } = useKernel();
const state = workbench.state;
const terminalRunning = terminal.runningCount;
const terminalTitle = computed(() => {
  const suffix = terminalRunning.value ? ` · ${terminalRunning.value} 个运行中` : "";
  return `${terminal.state.open ? "收起" : "打开"}终端与后台任务 (Ctrl/Cmd+\`)${suffix}`;
});
const ws = computed(() => workbench.active.value);
const pi = computed(() => state.pi);
const enabledPlugins = computed(() => plugins.sidebarPlugins.value);
const hasOpenPanel = computed(() => Boolean(state.activePanelId && enabledPlugins.value.some((p) => p.id === state.activePanelId)));

const title = computed(() => {
  if (!ws.value) return "";
  const current = ws.value.sessions.find((item: any) => item.path === ws.value?.sessionFile);
  return ws.value.sessionName || current?.title || "新任务";
});

function showSidebar(): void {
  state.sidebarOpen = true;
}

function togglePanelArea(): void {
  if (hasOpenPanel.value) {
    workbench.closePanel();
  } else if (enabledPlugins.value[0]?.id) {
    state.activePanelId = enabledPlugins.value[0].id;
  }
}

// 扩展状态项
const extEntries = computed(() => Object.entries(extState.statuses[state.activeCwd] ?? {}));

// 连接状态
const connLabel = computed(() => {
  if (!pi.value.checked) return "检测 Pi…";
  if (!pi.value.found) return "未找到 Pi CLI";
  if (!ws.value) return `Pi ${pi.value.version}`;
  if (ws.value.status === "starting") return "启动中";
  if (ws.value.status === "error") return "进程出错";
  if ((ws.value.runningSessionCount ?? 0) > 1) return `${ws.value.runningSessionCount} 任务并行中`;
  if (ws.value.compacting) return "压缩上下文";
  if (ws.value.hasAnyRunning || ws.value.streaming) return "运行中";
  return `Pi ${pi.value.version}`;
});

const connTone = computed(() => {
  if (pi.value.checked && !pi.value.found) return "error";
  if (ws.value?.status === "error") return "error";
  if (ws.value?.hasAnyRunning || ws.value?.streaming || ws.value?.compacting || ws.value?.status === "starting") return "running";
  return "ready";
});

const piTitle = computed(() => {
  const current = pi.value.version ? `本机 Pi CLI ${pi.value.version}` : "本机 Pi CLI";
  return pi.value.updateAvailable ? `${current}，可更新到 ${pi.value.latest}` : current;
});
</script>

<template>
  <header class="titlebar" @dblclick="onTitlebarDoubleClick">
    <div class="tb-left">
      <img class="tb-logo" src="../../assets/pi-icon.png" alt="Pi Desktop" title="Pi Desktop" />
      <button
        class="tb-btn"
        :class="{ active: state.sidebarOpen }"
        title="切换项目与会话栏 (Ctrl+B)"
        @click="state.sidebarOpen = !state.sidebarOpen"
        v-html="icons.sidebar"
      />
      <button
        class="tb-btn"
        :disabled="!ws || ws.status === 'starting'"
        title="新建并行任务 (Ctrl+N)"
        @click="workbench.newSession()"
        v-html="icons.plus"
      />
      <nav v-if="ws" class="crumbs">
        <button class="crumb" :title="ws.cwd" @click="showSidebar"><span class="crumb-text">{{ ws.name }}</span></button>
        <span v-if="ws.branch" class="crumb crumb-branch" :title="`分支 ${ws.branch}`"><span v-html="icons.branch" /><span class="crumb-text">{{ ws.branch }}</span></span>
        <span class="crumb-slash">/</span>
        <span class="crumb-title" :title="title">
          <span
            class="crumb-state"
            :data-state="ws.compacting ? 'compacting' : ws.streaming ? 'running' : ws.status === 'error' ? 'error' : 'ready'"
          >
            <span v-if="ws.streaming || ws.compacting" class="task-orbit" />
            <span v-else class="task-dot" />
          </span>
          <span>{{ title }}</span>
          <span v-if="ws.compacting" class="crumb-badge compacting">整理中</span>
          <span v-else-if="ws.streaming" class="crumb-badge running">运行中</span>
        </span>
      </nav>
    </div>

    <div class="tb-right">
      <span v-for="[key, text] in extEntries" :key="key" class="status-item" :title="key">◆ {{ text }}</span>

      <span class="status-item" :data-tone="connTone" :title="piTitle">
        <span class="status-dot" :data-state="connTone" />
        {{ connLabel }}
      </span>
      <button
        v-if="state.appUpdate.updateAvailable || pi.updateAvailable"
        class="status-item clickable pi-update-hint"
        :title="state.appUpdate.updateAvailable ? `Pi Desktop ${state.appUpdate.latest} 已发布，当前 ${state.appUpdate.current}` : `Pi ${pi.latest} 可用，当前 ${pi.version}`"
        @click="openSettingsModal('environment')"
      >
        <span class="pi-update-dot" />
        有新版本 {{ state.appUpdate.updateAvailable ? state.appUpdate.latest : pi.latest }}
      </button>

      <button
        v-if="terminal.available && terminal.state.enabled"
        class="tb-btn tb-terminal-btn"
        :class="{ active: terminal.state.open }"
        :title="terminalTitle"
        @click="terminal.toggle()"
      >
        <span v-html="icons.terminal" />
        <span v-if="terminalRunning" class="tb-terminal-badge">{{ terminalRunning }}</span>
      </button>

      <button
        class="tb-btn"
        :title="state.theme === 'dark' ? '当前：深色主题（点击切换浅色）' : '当前：浅色主题（点击切换深色）'"
        @click="theme.toggleTheme()"
        v-html="state.theme === 'dark' ? icons.moon : icons.sun"
      />

      <button
        class="tb-btn"
        :class="{ active: settingsModalState.open }"
        title="偏好设置 (Ctrl+,)"
        @click="openSettingsModal()"
        v-html="icons.gear"
      />

      <button
        v-if="enabledPlugins.length"
        class="tb-btn"
        :class="{ active: hasOpenPanel }"
        title="切换扩展工具面板"
        @click="togglePanelArea"
        v-html="icons.panel"
      />
    </div>

    <WindowControls v-if="platform !== 'darwin'" />
  </header>
</template>
