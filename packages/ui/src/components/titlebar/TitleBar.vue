<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { extState } from "../../services/extension-ui.ts";
import { openSettingsModal, settingsModalState, updateSettingsTab } from "../../services/settings.ts";
import { icons } from "../../shared/util.ts";
import WindowControls from "./WindowControls.vue";

/**
 * 顶部标题栏：
 * 左侧：Pi 字标 · 项目与会话栏开关 · 新建任务 · 项目/分支/任务面包屑
 * 右侧：扩展状态 · Pi CLI 连接状态 · 主题切换 · 偏好设置 · 扩展工具面板开关
 */
const platform = (globalThis as any).piDesktop?.platform ?? "web";
const windowControls = (globalThis as any).piDesktop?.windowControls as
  | { toggleMaximize: () => Promise<boolean> }
  | undefined;

/** 无边框窗口不再有系统标题栏，双击最大化要自己接（点按钮不算） */
function onTitlebarDoubleClick(event: MouseEvent): void {
  // MyGo 的无边框窗口自己处理拖动区域的双击，再调一次会把最大化又还原。
  if ((globalThis as any).__piDesktopHost === "mygo") return;
  if (!windowControls) return;
  if ((event.target as HTMLElement | null)?.closest("button")) return;
  void windowControls.toggleMaximize();
}
const { workbench, plugins, theme, terminal, bus } = useKernel();
const state = workbench.state;
const terminalRunning = terminal.runningCount;
const terminalTitle = computed(() => {
  const suffix = terminalRunning.value ? ` · ${terminalRunning.value} 个运行中` : "";
  return `${terminal.state.open ? "收起" : "打开"}终端与后台任务 (Ctrl/Cmd+\`)${suffix}`;
});
const ws = computed(() => workbench.active.value);
const pi = computed(() => state.pi);

// ---------- Agent 切换 ----------
const agentsOpen = ref(false);
const agentPicker = ref<HTMLElement | null>(null);
const agents = computed<any[]>(() => state.agents?.agents ?? []);
const activeAgent = computed(() => ws.value?.agent || "");
const activeAgentInfo = computed<any>(() => agents.value.find((item: any) => item?.kind === activeAgent.value) ?? ws.value?.agentInfo ?? null);
const agentLabel = computed(() => activeAgent.value === "antigravity" ? "Antigravity" : activeAgent.value === "pi" ? "Pi" : "选择 Agent");
const agentDot = computed(() => {
  if (!activeAgent.value) return "idle";
  if (ws.value?.status === "error") return "error";
  if (!activeAgentInfo.value?.found && ws.value?.agent === "antigravity") return "error";
  if (ws.value?.streaming || ws.value?.compacting || ws.value?.status === "starting") return "running";
  return "ready";
});
const agentTitle = computed(() => {
  if (!activeAgent.value) return ws.value ? "这个项目还没有选择 Agent · 点击选择" : "打开项目后选择 Agent";
  const info = activeAgentInfo.value;
  const version = info?.version ? ` ${info.version}` : "";
  return `${agentLabel.value}${version}${info?.path ? ` · ${info.path}` : ""}`;
});

async function toggleAgentMenu(): Promise<void> {
  agentsOpen.value = !agentsOpen.value;
  if (agentsOpen.value) void workbench.refreshAgents(state.activeCwd || "");
}

async function pickAgent(kind: string): Promise<void> {
  if (!ws.value) {
    agentsOpen.value = false;
    bus.emit("notify", { level: "info", text: "先打开项目，再为这个项目选择 Agent" });
    return;
  }
  agentsOpen.value = false;
  try {
    await workbench.switchAgent(kind);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

function closeAgentMenu(event: MouseEvent): void {
  if (!agentsOpen.value) return;
  if (agentPicker.value?.contains(event.target as Node)) return;
  agentsOpen.value = false;
}
onMounted(() => document.addEventListener("mousedown", closeAgentMenu));
onBeforeUnmount(() => document.removeEventListener("mousedown", closeAgentMenu));
const enabledPlugins = computed(() => plugins.sidebarPlugins.value);
const hasOpenPanel = computed(() => Boolean(state.activePanelId && enabledPlugins.value.some((p) => p.id === state.activePanelId)));
// 没打开项目时侧栏是空的（Shell 里也不渲染它），按钮跟着置灰，点击不会「按了没反应」。
const sidebarVisible = computed(() => state.sidebarOpen && Boolean(state.activeCwd));

const title = computed(() => {
  if (!ws.value) return "";
  const current = ws.value.sessions.find((item: any) => item.path === ws.value?.sessionFile);
  return ws.value.sessionName || current?.title || "新任务";
});

function showSidebar(): void {
  state.sidebarOpen = true;
}

function toggleGitPanel(): void {
  workbench.togglePanel("git");
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
  if (!ws.value) {
    const found = agents.value.filter((item: any) => item?.found);
    if (!state.agents.agents.length && !pi.value.checked) return "检测 Agent…";
    return found.length ? "未选择 Agent" : "未找到 Agent";
  }
  if (ws.value.agent === "antigravity") {
    if (ws.value.status === "starting") return "启动中";
    if (ws.value.status === "error") return "进程出错";
    if (ws.value.compacting) return "压缩上下文";
    if (ws.value.hasAnyRunning || ws.value.streaming) return "运行中";
    const version = ws.value.agentInfo?.version;
    return version ? `Antigravity ${version}` : "Antigravity";
  }
  if (!ws.value.agent) return "未选择 Agent";
  if (!pi.value.checked) return "检测 Pi…";
  if (!pi.value.found) return "未找到 Pi CLI";
  if (ws.value.status === "starting") return "启动中";
  if (ws.value.status === "error") return "进程出错";
  if ((ws.value.runningSessionCount ?? 0) > 1) return `${ws.value.runningSessionCount} 任务并行中`;
  if (ws.value.compacting) return "压缩上下文";
  if (ws.value.hasAnyRunning || ws.value.streaming) return "运行中";
  return `Pi ${pi.value.version}`;
});

const connTone = computed(() => {
  if (!ws.value) {
    return agents.value.some((item: any) => item?.found) ? "idle" : "error";
  }
  if (ws.value.agent === "antigravity") {
    if (ws.value.status === "error") return "error";
    if (ws.value.hasAnyRunning || ws.value.streaming || ws.value.compacting || ws.value.status === "starting") return "running";
    return "ready";
  }
  if (!ws.value.agent) return "idle";
  if (pi.value.checked && !pi.value.found) return "error";
  if (ws.value.status === "error") return "error";
  if (ws.value.hasAnyRunning || ws.value.streaming || ws.value.compacting || ws.value.status === "starting") return "running";
  return "ready";
});

const piTitle = computed(() => {
  if (!ws.value) return "打开项目后选择这个项目使用的 Agent";
  if (ws.value.agent === "antigravity" || !ws.value.agent) return agentTitle.value;
  const current = pi.value.version ? `本机 Pi CLI ${pi.value.version}` : "本机 Pi CLI";
  return pi.value.updateAvailable ? `${current}，可更新到 ${pi.value.latest}` : current;
});
</script>

<template>
  <header class="titlebar" @dblclick="onTitlebarDoubleClick">
    <div class="tb-left">
      <span class="tb-brand" title="Pi Desktop">Pi</span>
      <div ref="agentPicker" class="agent-picker">
        <button
          class="agent-btn"
          :data-state="agentDot"
          :title="agentTitle + ' · 点击切换 Agent'"
          @click="toggleAgentMenu"
        >
          <span class="agent-dot" :data-state="agentDot" />
          <span class="agent-name">{{ agentLabel }}</span>
          <span class="agent-caret" :class="{ open: agentsOpen }" v-html="icons.chevronDown" />
        </button>
        <div v-if="agentsOpen" class="agent-menu">
          <button
            v-for="agent in agents"
            :key="agent.kind"
            class="agent-item"
            :class="{ active: agent.kind === activeAgent }"
            :disabled="!agent.found"
            :title="agent.error || agent.path"
            @click="pickAgent(agent.kind)"
          >
            <span class="agent-item-main">
              <strong>{{ agent.label }}</strong>
              <span v-if="agent.found" class="agent-item-meta">v{{ agent.version }}</span>
              <span v-else class="agent-item-meta error">未安装</span>
            </span>
            <span v-if="agent.kind === activeAgent" class="agent-item-tag">当前</span>
            <span v-else-if="agent.error" class="agent-item-hint">{{ agent.error }}</span>
          </button>
          <p class="agent-menu-hint">
            Antigravity 使用本机 <code>agy acp</code>，首次使用先在终端运行 <code>agy acp --login</code>。
          </p>
        </div>
      </div>
      <button
        class="tb-btn"
        :class="{ active: sidebarVisible }"
        :disabled="!state.activeCwd"
        :title="state.activeCwd ? '切换项目与会话栏 (Ctrl+B)' : '打开项目后可展开项目与会话栏'"
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
        <button
          v-if="ws.branch"
          type="button"
          class="crumb crumb-branch"
          :title="`当前分支：${ws.branch} · 点击切换版本控制面板`"
          @click="toggleGitPanel"
        ><span v-html="icons.branch" /><span class="crumb-text">{{ ws.branch }}</span></button>
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
        @click="openSettingsModal(updateSettingsTab(state.appUpdate.updateAvailable ? 'app' : 'pi'))"
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
        @click="theme.toggleTheme({ x: $event.clientX, y: $event.clientY })"
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
