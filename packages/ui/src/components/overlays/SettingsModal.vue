<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type {
  McpExposureMode,
  McpOverview,
  McpServerItem,
  PiPackageItem,
  PiPackagesOverview,
  PiSkillsOverview,
} from "../../env.d.ts";
import { useKernel } from "../../kernel/use-kernel.ts";
import {
  appSettings,
  checkAppUpdateWithAutoDownload,
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
import AppearanceSettings from "./settings/AppearanceSettings.vue";
import ConversationSettings from "./settings/ConversationSettings.vue";
import LogSettings from "./settings/LogSettings.vue";
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

const exposureOptions: Array<{ value: McpExposureMode; label: string; hint: string }> = [
  { value: "codemode", label: "Codemode（推荐）", hint: "通过脚本按需检索并调用工具，节省上下文" },
  { value: "direct", label: "Direct（直接暴露）", hint: "所有工具直接声明给模型调用" },
  { value: "deferred", label: "Deferred（按需加载）", hint: "由 tool_search 搜索后再加载" },
  { value: "hidden", label: "Hidden（隐藏）", hint: "仅注册服务但不向模型暴露工具" },
];

function handleResetAll(): void {
  resetSettingsToDefault();
  workbench.setSidebarWidth(272);
  workbench.setStageWidth(520);
  workbench.setPanelWidth(320);
  bus.emit("notify", { level: "info", text: "已恢复默认偏好设置" });
}

async function restartActiveProcess(): Promise<void> {
  if (!ws.value) return;
  await workbench.restart(ws.value);
  bus.emit("notify", { level: "info", text: "已重启当前会话的 Pi 进程" });
}

// ==================== 本机 Pi CLI 更新逻辑 ====================
const piUpdateStatus = computed(() => {
  if (!state.pi.found) return { tone: "err", label: "未安装" };
  if (state.pi.updating) return { tone: "warn", label: "更新中" };
  if (state.pi.checking) return { tone: "muted", label: "检查中" };
  if (state.pi.updateAvailable) return { tone: "warn", label: `有更新 ${state.pi.latest}` };
  if (state.pi.latest) return { tone: "ok", label: "已是最新" };
  return { tone: "muted", label: "未知" };
});

const piPathDraft = ref(appSettings.piCustomPath);
const piPathEditing = ref(false);

async function checkPiUpdateNow(): Promise<void> {
  const result = await workbench.checkPiUpdate(appSettings.piCustomPath || undefined);
  if (!state.pi.found) return;
  bus.emit("notify", {
    level: "info",
    text: result.updateAvailable
      ? `发现 Pi 新版本 ${result.latest}（当前 ${result.current}），可点击“立即更新”`
      : `Pi 已是最新版本（${result.current || state.pi.version}）`,
  });
}

async function updatePiNow(): Promise<void> {
  await workbench.updatePi(appSettings.piCustomPath || undefined, appSettings.piUpdateScope);
}

const appUpdateStatus = computed(() => {
  if (state.appUpdate.phase === "downloading") return { tone: "muted", label: "下载中" };
  if (state.appUpdate.phase === "ready") return { tone: "warn", label: "准备完成" };
  if (state.appUpdate.phase === "installing") return { tone: "warn", label: "等待安装" };
  if (state.appUpdate.checking) return { tone: "muted", label: "检查中" };
  if (state.appUpdate.updateAvailable) return { tone: "warn", label: `有更新 ${state.appUpdate.latest}` };
  // 检查失败时保持「未知」，否则限流/断网会被误显示成「已是最新」
  if (state.appUpdate.error) return { tone: "warn", label: "检查失败" };
  if (state.appUpdate.checkedAt) return { tone: "ok", label: "已是最新" };
  return { tone: "muted", label: "未检查" };
});

async function checkAppUpdateNow(): Promise<void> {
  // 走统一的入口：开着「自动下载更新」时，手动检查也会顺手下载
  const result = (await checkAppUpdateWithAutoDownload({ manual: true })) ?? { current: "", latest: "", updateAvailable: false, url: "" };
  // 失败（限流 / 断网）与「有更新」workbench 已经提示过，这里只补「确实是最新」；
  // 以前把检查失败也说成「已是最新版本」，用户会以为真的没有新版本。
  if (result.error || result.updateAvailable) return;
  if (!result.current) return;
  bus.emit("notify", { level: "info", text: `Pi Desktop 已是最新版本（${result.current}）` });
}

async function downloadAppUpdateNow(): Promise<void> {
  await workbench.downloadAppUpdate();
}

async function installAppUpdateNow(): Promise<void> {
  await workbench.installAppUpdate();
}

async function openAppRelease(): Promise<void> {
  const opened = await workbench.openAppUpdate();
  if (!opened) bus.emit("notify", { level: "warning", text: "无法打开发布页面" });
}

/** 应用手动输入的 Pi 路径：探活成功才保存，失败直接报错不保存。 */
async function applyPiCustomPath(): Promise<void> {
  const input = piPathDraft.value.trim();
  if (!input) {
    await clearPiCustomPath();
    return;
  }
  const result = await workbench.refreshPi(input);
  if (!result.found) {
    bus.emit("notify", { level: "error", text: "该路径不可用：文件不存在，或无法运行 pi --version，请检查后重新输入" });
    return;
  }
  appSettings.piCustomPath = input;
  piPathEditing.value = false;
  bus.emit("notify", { level: "info", text: `已使用手动指定的 Pi：${result.version}（${result.path}）` });
}

function editPiPath(): void {
  piPathDraft.value = appSettings.piCustomPath || state.pi.path || "";
  piPathEditing.value = true;
}

function cancelPiPathEdit(): void {
  piPathDraft.value = appSettings.piCustomPath;
  piPathEditing.value = false;
}

async function clearPiCustomPath(): Promise<void> {
  appSettings.piCustomPath = "";
  piPathDraft.value = "";
  piPathEditing.value = false;
  await workbench.refreshPi();
  bus.emit("notify", { level: "info", text: "已恢复 PATH 自动识别" });
}

async function copyPiPath(): Promise<void> {
  if (!state.pi.path) return;
  try {
    await navigator.clipboard.writeText(state.pi.path);
    bus.emit("notify", { level: "info", text: "已复制 Pi 安装路径" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

function formatPiUpdateTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}

// ==================== MCP 服务配置逻辑 ====================
const mcpLoading = ref(false);
const mcpProbing = ref(false);
const mcpSaving = ref(false);
const mcpData = ref<McpOverview | null>(null);
const expandedTools = reactive<Record<string, boolean>>({});

const mcpFormOpen = ref(false);
const mcpJsonImportOpen = ref(false);
const mcpJsonScope = ref<"global" | "project">("global");
const mcpJsonText = ref("");

const mcpForm = reactive({
  editingName: "",
  scope: "global" as "global" | "project",
  name: "",
  type: "stdio" as "stdio" | "http",
  command: "npx",
  argsText: "-y @modelcontextprotocol/server-filesystem .",
  envText: "",
  cwd: "",
  url: "",
  headersText: "",
  exposure: "codemode" as McpExposureMode,
  description: "",
  enabled: true,
});

async function loadMcpOverview(): Promise<void> {
  mcpLoading.value = true;
  try {
    mcpData.value = await workbench.mcpOverview();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpLoading.value = false;
  }
}

async function runMcpProbe(): Promise<void> {
  if (mcpProbing.value) return;
  mcpProbing.value = true;
  try {
    mcpData.value = await workbench.mcpProbe();
    bus.emit("notify", { level: "info", text: "已完成 MCP 服务连接与工具检测" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpProbing.value = false;
  }
}

function openAddMcpForm(): void {
  mcpJsonImportOpen.value = false;
  mcpForm.editingName = "";
  mcpForm.scope = "global";
  mcpForm.name = "";
  mcpForm.type = "stdio";
  mcpForm.command = "npx";
  mcpForm.argsText = "";
  mcpForm.envText = "";
  mcpForm.cwd = "";
  mcpForm.url = "";
  mcpForm.headersText = "";
  mcpForm.exposure = "codemode";
  mcpForm.description = "";
  mcpForm.enabled = true;
  mcpFormOpen.value = true;
}

function openEditMcpForm(item: McpServerItem): void {
  mcpJsonImportOpen.value = false;
  mcpForm.editingName = item.name;
  mcpForm.scope = item.scope;
  mcpForm.name = item.name;
  mcpForm.type = item.type;
  mcpForm.command = item.command ?? "npx";
  mcpForm.argsText = (item.args ?? []).join(" ");
  mcpForm.envText = Object.entries(item.env ?? {})
    .map(([k, v]) => `${k}=${v === "••••••" ? "" : v}`)
    .join("\n");
  mcpForm.cwd = item.cwd ?? "";
  mcpForm.url = item.url ?? "";
  mcpForm.headersText = Object.entries(item.headers ?? {})
    .map(([k, v]) => `${k}: ${v === "••••••" ? "" : v}`)
    .join("\n");
  mcpForm.exposure = item.exposure ?? "codemode";
  mcpForm.description = item.description ?? "";
  mcpForm.enabled = item.enabled !== false;
  mcpFormOpen.value = true;
}

function parseKeyValueLines(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = sep === ":" ? line.indexOf(":") : line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseArgsText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.includes("\n")) {
    return trimmed
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((token) => token.replace(/^["']|["']$/g, ""));
}

async function submitMcpForm(): Promise<void> {
  if (mcpSaving.value) return;
  mcpSaving.value = true;
  try {
    const config: Record<string, any> = {
      exposure: mcpForm.exposure,
      enabled: mcpForm.enabled,
      description: mcpForm.description.trim() || undefined,
    };
    if (mcpForm.type === "http") {
      config.url = mcpForm.url.trim();
      const headers = parseKeyValueLines(mcpForm.headersText, ":");
      if (Object.keys(headers).length) config.headers = headers;
    } else {
      config.command = mcpForm.command.trim();
      const args = parseArgsText(mcpForm.argsText);
      if (args.length) config.args = args;
      const env = parseKeyValueLines(mcpForm.envText, "=");
      if (Object.keys(env).length) config.env = env;
      if (mcpForm.cwd.trim()) config.cwd = mcpForm.cwd.trim();
    }
    mcpData.value = await workbench.mcpSaveServer({
      scope: mcpForm.scope,
      name: mcpForm.name.trim(),
      previousName: mcpForm.editingName || undefined,
      config,
    });
    mcpFormOpen.value = false;
    bus.emit("notify", {
      level: "info",
      text: mcpForm.editingName ? `已更新 MCP 服务「${mcpForm.name}」` : `已添加 MCP 服务「${mcpForm.name}」`,
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpSaving.value = false;
  }
}

async function submitMcpJsonImport(): Promise<void> {
  if (!mcpJsonText.value.trim() || mcpSaving.value) return;
  mcpSaving.value = true;
  try {
    mcpData.value = await workbench.mcpImportJson({
      scope: mcpJsonScope.value,
      jsonText: mcpJsonText.value,
    });
    mcpJsonImportOpen.value = false;
    mcpJsonText.value = "";
    bus.emit("notify", { level: "info", text: "已成功导入 MCP 服务配置" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    mcpSaving.value = false;
  }
}

async function toggleMcpServerEnabled(item: McpServerItem, enabled: boolean): Promise<void> {
  try {
    mcpData.value = await workbench.mcpUpdateServer({
      scope: item.scope,
      name: item.name,
      patch: { enabled },
    });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function changeMcpServerExposure(item: McpServerItem, exposure: McpExposureMode): Promise<void> {
  try {
    mcpData.value = await workbench.mcpUpdateServer({
      scope: item.scope,
      name: item.name,
      patch: { exposure },
    });
    bus.emit("notify", { level: "info", text: `已将「${item.name}」暴露策略设为 ${exposure}` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function deleteMcpServer(item: McpServerItem): Promise<void> {
  try {
    mcpData.value = await workbench.mcpRemoveServer({
      scope: item.scope,
      name: item.name,
    });
    bus.emit("notify", { level: "info", text: `已移除 MCP 服务「${item.name}」` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function toggleAutoCodemode(enabled: boolean): Promise<void> {
  try {
    mcpData.value = await workbench.mcpSetAutoCodemode({ scope: "global", enabled });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

function mcpTransportText(item: McpServerItem): string {
  if (item.type === "http") return item.url || "";
  return [item.command, ...(item.args ?? [])].filter(Boolean).join(" ");
}

function mcpStatusMeta(item: McpServerItem): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  if (!item.enabled) return { label: "已禁用", tone: "muted" };
  if (item.state === "connected") {
    const count = item.tools?.length ?? 0;
    return { label: count ? `已连接 · ${count} 工具` : "已连接", tone: "ok" };
  }
  if (item.state === "error" || item.error) return { label: "连接异常", tone: "err" };
  if (item.state === "needs_auth") return { label: "需 OAuth 授权", tone: "warn" };
  return { label: "已配置", tone: "muted" };
}

function toggleToolsExpand(key: string): void {
  expandedTools[key] = !expandedTools[key];
}

// ==================== Pi 软件包管理逻辑 ====================
const pkgLoading = ref(false);
const pkgBusy = ref(false);
const pkgBusyText = ref("");
const pkgData = ref<PiPackagesOverview | null>(null);
const pkgInstallSource = ref("");
const pkgInstallLocal = ref(false);

async function loadPackagesOverview(): Promise<void> {
  pkgLoading.value = true;
  try {
    pkgData.value = await workbench.packagesOverview();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    pkgLoading.value = false;
  }
}

function fillInstallPrefix(prefix: string): void {
  const cur = pkgInstallSource.value.trim();
  if (!cur) {
    pkgInstallSource.value = prefix;
    return;
  }
  const stripped = cur.replace(/^(npm:|git:https?:\/\/github\.com\/|git:github\.com\/|\.\/)/, "");
  pkgInstallSource.value = `${prefix}${stripped}`;
}

async function installPackage(): Promise<void> {
  const src = pkgInstallSource.value.trim();
  if (!src || pkgBusy.value) return;
  pkgBusy.value = true;
  pkgBusyText.value = `正在安装 ${src}…`;
  try {
    pkgData.value = await workbench.packagesInstall({
      source: src,
      local: pkgInstallLocal.value,
    });
    pkgInstallSource.value = "";
    bus.emit("notify", { level: "info", text: `已成功安装软件包：${src}` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    pkgBusy.value = false;
    pkgBusyText.value = "";
  }
}

async function removePackage(item: PiPackageItem): Promise<void> {
  if (pkgBusy.value) return;
  pkgBusy.value = true;
  pkgBusyText.value = `正在卸载 ${item.displayName}…`;
  try {
    pkgData.value = await workbench.packagesRemove({
      source: item.source,
      local: item.scope === "project",
    });
    bus.emit("notify", { level: "info", text: `已卸载软件包：${item.displayName}` });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    pkgBusy.value = false;
    pkgBusyText.value = "";
  }
}

async function updatePackage(source?: string): Promise<void> {
  if (pkgBusy.value) return;
  pkgBusy.value = true;
  pkgBusyText.value = source ? `正在更新 ${source}…` : "正在检查并更新全部已安装软件包…";
  try {
    pkgData.value = await workbench.packagesUpdate(source ? { source } : undefined);
    bus.emit("notify", { level: "info", text: source ? `已更新软件包：${source}` : "已完成全部软件包更新" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    pkgBusy.value = false;
    pkgBusyText.value = "";
  }
}

const resourceTypeLabels: Record<string, string> = {
  extensions: "扩展",
  skills: "技能",
  prompts: "提示词",
  themes: "主题",
};

const skillsLoading = ref(false);
const skillsData = ref<PiSkillsOverview | null>(null);
const skillsFilter = ref<"all" | "user" | "project" | "temporary">("all");

const visibleSkills = computed(() => {
  const list = skillsData.value?.skills ?? [];
  return skillsFilter.value === "all" ? list : list.filter((skill) => skill.scope === skillsFilter.value);
});

async function loadSkillsOverview(): Promise<void> {
  skillsLoading.value = true;
  try {
    skillsData.value = await workbench.skillsOverview();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    skillsLoading.value = false;
  }
}

const skillScopeLabels: Record<string, string> = { user: "全局", project: "当前项目", temporary: "临时" };
const skillOriginLabels: Record<string, string> = { package: "软件包", "top-level": "本地目录" };

watch(
  () => [settingsModalState.open, settingsModalState.tab, state.activeCwd] as const,
  ([open, tab]) => {
    if (!open) return;
    if (tab === "mcp") {
      loadMcpOverview();
    } else if (tab === "packages") {
      loadPackagesOverview();
    } else if (tab === "skills") {
      loadSkillsOverview();
    }
  },
  { immediate: true },
);

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

          <template v-else-if="settingsModalState.tab === 'terminal'">
            <TerminalSettings />
          </template>

          <!-- 3. MCP 服务配置 -->
          <template v-else-if="settingsModalState.tab === 'mcp'">
            <div class="settings-group">
              <div class="settings-group-head">
                <span class="settings-group-title">
                  已配置的 MCP 服务（{{ mcpData?.servers.length ?? 0 }}）
                </span>
                <div class="settings-toolbar-actions">
                  <button
                    type="button"
                    class="btn ghost small"
                    :disabled="mcpProbing"
                    @click="runMcpProbe"
                  >
                    <span v-if="mcpProbing" class="mini-spinner" />
                    <span v-else class="settings-inline-icon" v-html="icons.refresh" />
                    {{ mcpProbing ? "正在检测…" : "检测连接与工具" }}
                  </button>
                  <button
                    type="button"
                    class="btn ghost small"
                    @click="mcpJsonImportOpen = !mcpJsonImportOpen; mcpFormOpen = false"
                  >
                    <span class="settings-inline-icon" v-html="icons.json" />
                    粘贴 JSON 导入
                  </button>
                  <button type="button" class="btn small" @click="openAddMcpForm">
                    <span class="settings-inline-icon" v-html="icons.plus" />
                    新增服务
                  </button>
                </div>
              </div>

              <!-- 粘贴 JSON 导入面板 -->
              <div v-if="mcpJsonImportOpen" class="settings-card-form">
                <div class="settings-form-head">
                  <strong>从 JSON 导入 MCP 服务配置</strong>
                  <select v-model="mcpJsonScope" class="settings-select">
                    <option value="global">全局配置</option>
                    <option value="project" :disabled="!state.activeCwd">当前项目 (.pi/mcp.json)</option>
                  </select>
                </div>
                <textarea
                  v-model="mcpJsonText"
                  rows="5"
                  class="settings-textarea mono"
                  placeholder='粘贴标准 mcpServers JSON，例如：&#10;{&#10;  "mcpServers": {&#10;    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }&#10;  }&#10;}'
                  spellcheck="false"
                />
                <div class="settings-form-foot">
                  <button type="button" class="btn ghost small" @click="mcpJsonImportOpen = false">取消</button>
                  <button
                    type="button"
                    class="btn small"
                    :disabled="!mcpJsonText.trim() || mcpSaving"
                    @click="submitMcpJsonImport"
                  >
                    解析并写入配置
                  </button>
                </div>
              </div>

              <!-- 新增 / 编辑 MCP 服务表单 -->
              <div v-if="mcpFormOpen" class="settings-card-form">
                <div class="settings-form-head">
                  <strong>{{ mcpForm.editingName ? `编辑服务「${mcpForm.editingName}」` : "新增 MCP 服务" }}</strong>
                  <select v-model="mcpForm.scope" class="settings-select">
                    <option value="global">全局 (~/.pi/agent/mcp.json)</option>
                    <option value="project" :disabled="!state.activeCwd">当前项目 (.pi/mcp.json)</option>
                  </select>
                </div>

                <div class="settings-form-grid">
                  <label class="settings-field">
                    <span>服务名称 *</span>
                    <input
                      v-model="mcpForm.name"
                      type="text"
                      class="settings-input mono"
                      placeholder="例如：filesystem、github、postgres"
                    />
                  </label>

                  <div class="settings-field">
                    <span>传输类型</span>
                    <select v-model="mcpForm.type" class="settings-select">
                      <option value="stdio">STDIO 本地进程</option>
                      <option value="http">HTTP 远程服务</option>
                    </select>
                  </div>
                </div>

                <template v-if="mcpForm.type === 'stdio'">
                  <div class="settings-form-grid">
                    <label class="settings-field">
                      <span>启动命令 (command) *</span>
                      <input
                        v-model="mcpForm.command"
                        type="text"
                        class="settings-input mono"
                        placeholder="npx / node / uvx / python"
                      />
                    </label>
                    <label class="settings-field">
                      <span>命令参数 (args，空格分隔)</span>
                      <input
                        v-model="mcpForm.argsText"
                        type="text"
                        class="settings-input mono"
                        placeholder="-y @modelcontextprotocol/server-filesystem ."
                      />
                    </label>
                  </div>
                  <label class="settings-field">
                    <span>环境变量 (env，每行一个 KEY=VALUE，可选)</span>
                    <textarea
                      v-model="mcpForm.envText"
                      rows="2"
                      class="settings-textarea mono"
                      placeholder="API_KEY=your_key_here"
                      spellcheck="false"
                    />
                  </label>
                </template>

                <template v-else>
                  <label class="settings-field">
                    <span>远程 Streamable HTTP 地址 (url) *</span>
                    <input
                      v-model="mcpForm.url"
                      type="text"
                      class="settings-input mono"
                      placeholder="https://api.githubcopilot.com/mcp/"
                    />
                  </label>
                  <label class="settings-field">
                    <span>请求头 (headers，每行一个 Header: Value，可选)</span>
                    <textarea
                      v-model="mcpForm.headersText"
                      rows="2"
                      class="settings-textarea mono"
                      placeholder="Authorization: Bearer ${TOKEN}"
                      spellcheck="false"
                    />
                  </label>
                </template>

                <div class="settings-form-grid">
                  <label class="settings-field">
                    <span>工具暴露模式 (exposure)</span>
                    <select v-model="mcpForm.exposure" class="settings-select">
                      <option v-for="opt in exposureOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </label>
                  <label class="settings-field">
                    <span>服务功能描述（可选，提示给系统提示词）</span>
                    <input
                      v-model="mcpForm.description"
                      type="text"
                      class="settings-input"
                      placeholder="简述该 MCP 服务提供的能力"
                    />
                  </label>
                </div>

                <div class="settings-form-foot">
                  <button type="button" class="btn ghost small" @click="mcpFormOpen = false">取消</button>
                  <button
                    type="button"
                    class="btn small"
                    :disabled="!mcpForm.name.trim() || mcpSaving"
                    @click="submitMcpForm"
                  >
                    保存 MCP 服务
                  </button>
                </div>
              </div>

              <!-- 错误提示 -->
              <div v-if="mcpData?.errors?.length" class="settings-alert err">
                <div v-for="(err, idx) in mcpData.errors" :key="idx">{{ err }}</div>
              </div>

              <!-- MCP 服务列表 -->
              <div v-if="mcpLoading && !mcpData" class="settings-empty-card">
                <span class="mini-spinner" /> 正在读取 MCP 配置文件…
              </div>
              <div v-else-if="!mcpData?.servers.length" class="settings-empty-card">
                <span>尚未配置任何 MCP 服务。点击右上角「新增服务」或「粘贴 JSON 导入」即可快速接入。</span>
              </div>
              <div v-else class="settings-card-list">
                <div
                  v-for="srv in mcpData.servers"
                  :key="`${srv.scope}:${srv.name}`"
                  class="settings-item-card"
                  :class="{ 'is-disabled': !srv.enabled }"
                >
                  <div class="settings-item-top">
                    <div class="settings-item-main">
                      <span class="settings-plugin-icon" v-html="srv.type === 'http' ? icons.globe : icons.mcp" />
                      <div class="settings-row-info">
                        <strong>
                          {{ srv.name }}
                          <span class="settings-plugin-tag">{{ srv.scope === "project" ? "当前项目" : "全局" }}</span>
                          <span class="settings-plugin-tag mono">{{ srv.type.toUpperCase() }}</span>
                          <span class="settings-status-pill" :class="mcpStatusMeta(srv).tone">
                            {{ mcpStatusMeta(srv).label }}
                          </span>
                        </strong>
                        <span class="settings-mono-line" :title="mcpTransportText(srv)">
                          {{ mcpTransportText(srv) }}
                        </span>
                        <span v-if="srv.description">{{ srv.description }}</span>
                        <span v-if="srv.error" class="settings-err-text">{{ srv.error }}</span>
                      </div>
                    </div>

                    <div class="settings-item-controls">
                      <select
                        :value="srv.exposure"
                        class="settings-select compact"
                        title="工具暴露策略"
                        @change="changeMcpServerExposure(srv, ($event.target as HTMLSelectElement).value as McpExposureMode)"
                      >
                        <option value="codemode">Codemode</option>
                        <option value="direct">Direct</option>
                        <option value="deferred">Deferred</option>
                        <option value="hidden">Hidden</option>
                      </select>
                      <button
                        type="button"
                        class="btn ghost small"
                        title="编辑此服务"
                        @click="openEditMcpForm(srv)"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        class="icon-btn small"
                        title="删除此服务"
                        @click="deleteMcpServer(srv)"
                        v-html="icons.trash"
                      />
                      <input
                        type="checkbox"
                        class="settings-switch"
                        :checked="srv.enabled"
                        title="启用或禁用此 MCP 服务"
                        @change="toggleMcpServerEnabled(srv, ($event.target as HTMLInputElement).checked)"
                      />
                    </div>
                  </div>

                  <!-- 工具列表折叠区 -->
                  <div v-if="srv.tools?.length" class="settings-item-sub">
                    <button
                      type="button"
                      class="settings-link-btn"
                      @click="toggleToolsExpand(`${srv.scope}:${srv.name}`)"
                    >
                      <span
                        class="settings-inline-icon"
                        v-html="expandedTools[`${srv.scope}:${srv.name}`] ? icons.chevronDown : icons.chevronRight"
                      />
                      {{ expandedTools[`${srv.scope}:${srv.name}`] ? "收起工具列表" : `查看已挂载的 ${srv.tools.length} 个工具` }}
                    </button>
                    <div v-if="expandedTools[`${srv.scope}:${srv.name}`]" class="settings-tool-chips">
                      <span v-for="toolName in srv.tools" :key="toolName" class="settings-tool-chip">
                        {{ toolName }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-title">Codemode 与配置文件路径</div>

              <label class="settings-row clickable">
                <div class="settings-row-info">
                  <strong>自动启用 Codemode（autoEnableCodemode）</strong>
                  <span>当有暴露模式为 Codemode 的 MCP 服务连接时，自动激活 codemode 工具以按需检索和调用</span>
                </div>
                <input
                  type="checkbox"
                  class="settings-switch"
                  :checked="mcpData?.autoEnableCodemode ?? true"
                  @change="toggleAutoCodemode(($event.target as HTMLInputElement).checked)"
                />
              </label>

              <div v-if="mcpData?.globalConfigPath" class="settings-row">
                <div class="settings-row-info">
                  <strong>全局 MCP 配置文件</strong>
                  <span class="settings-mono-line">{{ mcpData.globalConfigPath }}</span>
                </div>
                <button
                  type="button"
                  class="btn ghost small"
                  @click="workbench.reveal(mcpData.globalConfigPath)"
                >
                  在文件夹中显示
                </button>
              </div>
            </div>
          </template>

          <!-- 4. Pi 软件包管理 -->
          <template v-else-if="settingsModalState.tab === 'packages'">
            <div class="settings-group">
              <div class="settings-group-title">安装新的 Pi 扩展软件包（支持 npm / Git 仓库 / 本地路径）</div>

              <div class="settings-card-form">
                <div class="settings-pkg-install-row">
                  <input
                    v-model="pkgInstallSource"
                    type="text"
                    class="settings-input mono"
                    placeholder="输入包来源，例如 npm:@datfooldive/pi-ask 或 git:github.com/user/repo"
                    :disabled="pkgBusy"
                    @keydown.enter.prevent="installPackage"
                  />
                  <select v-model="pkgInstallLocal" class="settings-select">
                    <option :value="false">全局安装</option>
                    <option :value="true" :disabled="!state.activeCwd">当前项目 (-l)</option>
                  </select>
                  <button
                    type="button"
                    class="btn small"
                    :disabled="!pkgInstallSource.trim() || pkgBusy"
                    @click="installPackage"
                  >
                    <span v-if="pkgBusy" class="mini-spinner" />
                    <span v-else class="settings-inline-icon" v-html="icons.download" />
                    安装软件包
                  </button>
                </div>

                <div class="settings-pkg-quick-bar">
                  <span class="settings-pkg-hint">快捷来源前缀：</span>
                  <button type="button" class="settings-chip-btn" @click="fillInstallPrefix('npm:')">npm:@scope/pkg</button>
                  <button type="button" class="settings-chip-btn" @click="fillInstallPrefix('git:github.com/')">git:github.com/user/repo</button>
                  <button type="button" class="settings-chip-btn" @click="fillInstallPrefix('./')">./local/path</button>
                  <span v-if="pkgBusyText" class="settings-pkg-progress">
                    <span class="mini-spinner" /> {{ pkgBusyText }}
                  </span>
                </div>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-head">
                <span class="settings-group-title">
                  已安装的 Pi 软件包（{{ pkgData?.packages.length ?? 0 }}）
                </span>
                <div class="settings-toolbar-actions">
                  <button
                    type="button"
                    class="btn ghost small"
                    :disabled="pkgBusy || pkgLoading"
                    @click="loadPackagesOverview"
                  >
                    <span class="settings-inline-icon" v-html="icons.refresh" />
                    刷新
                  </button>
                  <button
                    type="button"
                    class="btn ghost small"
                    :disabled="pkgBusy || !(pkgData?.packages.length)"
                    @click="updatePackage()"
                  >
                    全部检查更新
                  </button>
                </div>
              </div>

              <div v-if="pkgLoading && !pkgData" class="settings-empty-card">
                <span class="mini-spinner" /> 正在读取已安装的 Pi 软件包…
              </div>
              <div v-else-if="!pkgData?.packages.length" class="settings-empty-card">
                <span>尚未安装任何 Pi 软件包。可在上方输入 `npm:` 或 `git:` 地址安装社区扩展、技能与主题。</span>
              </div>
              <div v-else class="settings-card-list">
                <div
                  v-for="pkg in pkgData.packages"
                  :key="`${pkg.scope}:${pkg.source}`"
                  class="settings-item-card"
                >
                  <div class="settings-item-top">
                    <div class="settings-item-main">
                      <span class="settings-plugin-icon" v-html="icons.package" />
                      <div class="settings-row-info">
                        <strong>
                          {{ pkg.displayName }}
                          <span v-if="pkg.version" class="settings-plugin-ver">v{{ pkg.version }}</span>
                          <span class="settings-plugin-tag mono">{{ pkg.kind.toUpperCase() }}</span>
                          <span class="settings-plugin-tag">{{ pkg.scope === "project" ? "当前项目" : "全局用户" }}</span>
                          <span class="settings-status-pill" :class="pkg.installed ? 'ok' : 'warn'">
                            {{ pkg.installed ? "已安装" : "待安装" }}
                          </span>
                        </strong>
                        <span v-if="pkg.description">{{ pkg.description }}</span>
                        <span class="settings-mono-line" :title="pkg.installedPath || pkg.source">
                          来源：{{ pkg.source }}
                          <template v-if="pkg.installedPath"> · 路径：{{ shortPath(pkg.installedPath, 3) }}</template>
                        </span>
                        <div class="plugin-caps">
                          <span v-if="pkg.counts.extensions" class="plugin-cap">扩展 {{ pkg.counts.extensions }}</span>
                          <span v-if="pkg.counts.skills" class="plugin-cap">技能 {{ pkg.counts.skills }}</span>
                          <span v-if="pkg.counts.prompts" class="plugin-cap">提示词 {{ pkg.counts.prompts }}</span>
                          <span v-if="pkg.counts.themes" class="plugin-cap">主题 {{ pkg.counts.themes }}</span>
                        </div>
                      </div>
                    </div>

                    <div class="settings-item-controls">
                      <button
                        v-if="pkg.installedPath"
                        type="button"
                        class="btn ghost small"
                        title="在文件夹中显示安装目录"
                        @click="workbench.reveal(pkg.installedPath)"
                      >
                        定位目录
                      </button>
                      <button
                        v-if="pkg.kind !== 'local'"
                        type="button"
                        class="btn ghost small"
                        :disabled="pkgBusy"
                        title="更新此软件包"
                        @click="updatePackage(pkg.source)"
                      >
                        更新
                      </button>
                      <button
                        type="button"
                        class="icon-btn small"
                        :disabled="pkgBusy"
                        title="卸载并从 settings.json 移除"
                        @click="removePackage(pkg)"
                        v-html="icons.trash"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="pkgData?.resources?.length" class="settings-group">
              <div class="settings-group-title">
                已发现的扩展与技能资源（{{ pkgData.resources.length }}）
              </div>
              <div class="settings-card-list">
                <div v-for="res in pkgData.resources" :key="`${res.type}:${res.path}`" class="settings-row">
                  <div class="settings-row-info">
                    <strong>
                      {{ res.name }}
                      <span class="settings-plugin-tag">{{ resourceTypeLabels[res.type] || res.type }}</span>
                      <span class="settings-plugin-tag">{{ res.origin === "package" ? "软件包" : "本地目录" }}</span>
                      <span class="settings-plugin-tag">{{ res.scope === "project" ? "当前项目" : "全局" }}</span>
                    </strong>
                    <span class="settings-mono-line" :title="res.path">{{ res.path }}</span>
                  </div>
                  <span class="settings-status-pill" :class="res.enabled ? 'ok' : 'muted'">
                    {{ res.enabled ? "已启用" : "已禁用" }}
                  </span>
                </div>
              </div>
            </div>

            <div v-if="pkgData?.globalSettingsPath" class="settings-group">
              <div class="settings-group-title">Pi 配置文件位置</div>
              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>全局 settings.json</strong>
                  <span class="settings-mono-line">{{ pkgData.globalSettingsPath }}</span>
                </div>
                <button
                  type="button"
                  class="btn ghost small"
                  @click="workbench.reveal(pkgData.globalSettingsPath)"
                >
                  在文件夹中显示
                </button>
              </div>
            </div>
          </template>

          <!-- 5. Skills 设置 -->
          <AgentSettings v-else-if="settingsModalState.tab === 'agents'" />
          <template v-else-if="settingsModalState.tab === 'skills'">
            <div class="settings-group">
              <div class="settings-group-head">
                <span class="settings-group-title">已加载的技能（{{ visibleSkills.length }}）</span>
                <div class="settings-toolbar-actions">
                  <select v-model="skillsFilter" class="settings-select">
                    <option value="all">全部</option>
                    <option value="user">全局</option>
                    <option value="project">当前项目</option>
                  </select>
                  <button type="button" class="btn ghost small" :disabled="skillsLoading" @click="loadSkillsOverview">
                    <span class="settings-inline-icon" v-html="icons.refresh" />
                    刷新
                  </button>
                </div>
              </div>

              <div v-if="skillsData?.diagnostics?.length" class="settings-alert err">
                <div v-for="(err, idx) in skillsData.diagnostics" :key="idx">{{ err }}</div>
              </div>

              <div v-if="skillsLoading && !skillsData" class="settings-empty-card">
                <span class="mini-spinner" /> 正在扫描技能目录…
              </div>
              <div v-else-if="!visibleSkills.length" class="settings-empty-card">
                <span>未发现技能。将 SKILL.md 放入全局或项目的 skills 目录即可被 Pi 加载，并可通过 /skill:名称 调用。</span>
              </div>
              <div v-else class="settings-card-list">
                <div v-for="skill in visibleSkills" :key="skill.filePath" class="settings-item-card">
                  <div class="settings-item-top">
                    <div class="settings-item-main">
                      <span class="settings-plugin-icon" v-html="icons.brain" />
                      <div class="settings-row-info">
                        <strong>
                          {{ skill.name }}
                          <span class="settings-plugin-tag">{{ skillScopeLabels[skill.scope] || skill.scope }}</span>
                          <span class="settings-plugin-tag">{{ skillOriginLabels[skill.origin] || skill.origin }}</span>
                          <span class="settings-status-pill" :class="skill.disableModelInvocation ? 'muted' : 'ok'">
                            {{ skill.disableModelInvocation ? "仅手动调用" : "可自动调用" }}
                          </span>
                        </strong>
                        <span v-if="skill.description">{{ skill.description }}</span>
                        <span class="settings-mono-line" :title="skill.filePath">{{ skill.filePath }}</span>
                      </div>
                    </div>
                    <div class="settings-item-controls">
                      <button
                        type="button"
                        class="btn ghost small"
                        title="在文件夹中显示技能文件"
                        @click="workbench.reveal(skill.filePath)"
                      >
                        定位文件
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="skillsData" class="settings-group">
              <div class="settings-group-title">技能目录</div>
              <div v-for="dir in skillsData.directories" :key="dir.path" class="settings-row">
                <div class="settings-row-info">
                  <strong>{{ dir.label }}</strong>
                  <span class="settings-mono-line">{{ dir.path }}</span>
                </div>
                <button type="button" class="btn ghost small" @click="workbench.reveal(dir.path)">
                  在文件夹中显示
                </button>
              </div>
            </div>
          </template>

          <!-- 6. 插件（按界面区域分组） -->
          <PluginSettings v-else-if="settingsModalState.tab === 'plugins'" />

          <!-- 6. 环境与快捷键 -->
          <template v-else-if="settingsModalState.tab === 'environment'">
            <div class="settings-group">
              <div class="settings-group-title">本机 Pi CLI</div>

              <!-- 状态与版本合成一行：以前「已连接 · 版本」和「当前 · 最新」分在两张卡里，说的是同一件事 -->
              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>Pi Coding Agent CLI</strong>
                  <span v-if="state.pi.found">已连接 · 当前 {{ state.pi.version || "未知" }}{{ state.pi.latest ? ` · 最新 ${state.pi.latest}` : "" }}</span>
                  <span v-else>未检测到本机 pi 命令，请检查 PATH，或在下方手动指定路径</span>
                </div>
                <span class="settings-status-pill" :class="piUpdateStatus.tone">
                  {{ piUpdateStatus.label }}
                </span>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>Pi 路径</strong>
                  <span v-if="!piPathEditing">{{ state.pi.path || "未在 PATH 中识别到 pi，可手动指定" }}</span>
                  <span v-else>{{ appSettings.piCustomPath ? "正在使用手动路径，探活成功后替换" : "默认使用 PATH 自动识别，探活成功后才会保存" }}</span>
                </div>
                <span v-if="!piPathEditing" class="settings-status-pill" :class="appSettings.piCustomPath ? 'warn' : 'ok'">
                  {{ appSettings.piCustomPath ? "手动指定" : "自动识别" }}
                </span>
                <div style="display: flex; gap: 6px; flex: none;">
                  <button type="button" class="btn ghost small" :disabled="!state.pi.path" @click="copyPiPath">复制</button>
                  <button v-if="!piPathEditing" type="button" class="btn ghost small" @click="editPiPath">修改</button>
                  <button
                    v-if="!piPathEditing && appSettings.piCustomPath"
                    type="button"
                    class="btn ghost small"
                    @click="clearPiCustomPath"
                  >
                    恢复自动
                  </button>
                </div>
              </div>
              <div v-if="piPathEditing" class="settings-row">
                <input
                  v-model="piPathDraft"
                  class="search"
                  placeholder="粘贴 pi 或 pi.cmd 的完整路径"
                  spellcheck="false"
                  style="flex: 1; min-width: 0;"
                  @keydown.enter.prevent="applyPiCustomPath"
                  @keydown.esc.prevent="cancelPiPathEdit"
                />
                <div style="display: flex; gap: 6px; flex: none;">
                  <button type="button" class="btn ghost small" @click="applyPiCustomPath">使用此路径</button>
                  <button type="button" class="btn ghost small" @click="cancelPiPathEdit">取消</button>
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>检查并更新 Pi</strong>
                  <span>使用识别到的 Pi 执行更新，由它按实际安装方式（npm、pnpm 或官方安装器）处理；完成后展示版本变化与输出</span>
                </div>
                <div style="display: flex; gap: 6px; flex: none; align-items: center;">
                  <select v-model="appSettings.piUpdateScope" class="settings-select" :disabled="state.pi.updating" title="pi update 只更新 Pi；pi update --all 同时更新已安装扩展">
                    <option value="self">pi update</option>
                    <option value="all">update --all</option>
                  </select>
                  <button
                    type="button"
                    class="btn ghost small"
                    :disabled="(!state.pi.found && !appSettings.piCustomPath) || state.pi.checking || state.pi.updating"
                    @click="checkPiUpdateNow"
                  >
                    <span v-if="state.pi.checking" class="mini-spinner" />检查更新
                  </button>
                  <button
                    type="button"
                    class="btn ghost small"
                    :disabled="(!state.pi.found && !appSettings.piCustomPath) || state.pi.updating"
                    @click="updatePiNow"
                  >
                    <span v-if="state.pi.updating" class="mini-spinner" />立即更新
                  </button>
                </div>
              </div>

              <label class="settings-row clickable">
                <div class="settings-row-info">
                  <strong>Pi 自动更新</strong>
                  <span>启动并定位到本机 Pi 后，若发现新版本则按上方所选范围自动更新</span>
                </div>
                <input v-model="appSettings.piAutoUpdate" type="checkbox" class="settings-switch" />
              </label>

              <div v-if="state.pi.lastUpdate" class="settings-row">
                <div class="settings-row-info">
                  <strong>上次更新结果</strong>
                  <span :title="state.pi.lastUpdate.log">{{ state.pi.lastUpdate.from === state.pi.lastUpdate.to ? `已确认最新（${state.pi.lastUpdate.to || state.pi.version}）` : `已从 ${state.pi.lastUpdate.from || "未知版本"} 更新到 ${state.pi.lastUpdate.to}` }} · {{ formatPiUpdateTime(state.pi.lastUpdate.at) }}</span>
                </div>
              </div>

              <div v-if="ws" class="settings-row">
                <div class="settings-row-info">
                  <strong>当前活动项目目录</strong>
                  <span>{{ ws.cwd }}（当前活跃会话线程 {{ Object.keys(ws.threads).length }} 个，运行中 {{ ws.runningSessionCount }} 个）</span>
                </div>
                <button
                  type="button"
                  class="btn ghost small"
                  :disabled="ws.streaming"
                  @click="restartActiveProcess"
                >
                  重启当前会话进程
                </button>
              </div>
            </div>

            <div class="settings-group">
              <div class="settings-group-title">Pi Desktop 更新</div>
              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>软件版本</strong>
                  <span>当前 {{ state.appUpdate.current || "未知" }}{{ state.appUpdate.latest ? ` · 最新 ${state.appUpdate.latest}` : "" }}</span>
                  <span v-if="state.appUpdate.error" class="settings-row-hint">上次检查失败：{{ state.appUpdate.error }}</span>
                </div>
                <span class="settings-status-pill" :class="appUpdateStatus.tone">{{ appUpdateStatus.label }}</span>
              </div>
              <div class="settings-row">
                <div class="settings-row-info">
                  <strong>检查软件更新</strong>
                  <span>检查后可下载并校验安装包；只有点击“安装并重启”才会打开安装程序</span>
                </div>
                <div style="display: flex; gap: 6px; flex: none;">
                  <button type="button" class="btn ghost small" :disabled="state.appUpdate.checking || state.appUpdate.phase === 'downloading'" @click="checkAppUpdateNow">
                    <span v-if="state.appUpdate.checking" class="mini-spinner" />检查更新
                  </button>
                  <button v-if="state.appUpdate.phase === 'downloading'" type="button" class="btn ghost small" @click="workbench.cancelAppUpdate()">取消下载</button>
                  <button v-if="state.appUpdate.updateAvailable && state.appUpdate.phase !== 'ready'" type="button" class="btn ghost small" :disabled="state.appUpdate.phase === 'downloading'" @click="downloadAppUpdateNow">
                    <span v-if="state.appUpdate.phase === 'downloading'" class="mini-spinner" />下载更新
                  </button>
                  <button v-if="state.appUpdate.phase === 'ready' || state.appUpdate.phase === 'installing'" type="button" class="btn ghost small" :disabled="state.appUpdate.phase === 'installing'" @click="installAppUpdateNow">安装并重启</button>
                  <button v-if="state.appUpdate.url" type="button" class="btn ghost small" @click="openAppRelease">查看发布</button>
                </div>
              </div>
              <label class="settings-row clickable">
                <div class="settings-row-info">
                  <strong>启动时检查更新</strong>
                  <span>启动后自动查一次 GitHub 发布页（结果缓存 6 小时，不会反复请求）</span>
                </div>
                <input v-model="appSettings.appUpdateCheck" type="checkbox" class="settings-switch" />
              </label>
              <label class="settings-row clickable">
                <div class="settings-row-info">
                  <strong>自动下载更新</strong>
                  <span>查到新版本就自动下载并校验安装包；安装仍要你点「安装并重启」</span>
                </div>
                <input v-model="appSettings.appUpdateAuto" type="checkbox" class="settings-switch" />
              </label>
            </div>

            <div class="settings-group">
              <div class="settings-group-title">全局快捷键速查</div>
              <div class="settings-shortcuts-grid">
                <div class="settings-shortcut-item"><span>打开偏好设置</span><kbd>Ctrl+,</kbd></div>
                <div class="settings-shortcut-item"><span>打开命令面板</span><kbd>Ctrl+K</kbd></div>
                <div class="settings-shortcut-item"><span>打开项目目录</span><kbd>Ctrl+O</kbd></div>
                <div class="settings-shortcut-item"><span>新建并行任务</span><kbd>Ctrl+N</kbd></div>
                <div class="settings-shortcut-item"><span>切换项目与会话栏</span><kbd>Ctrl+B</kbd></div>
                <div class="settings-shortcut-item"><span>手动保存当前编辑文件</span><kbd>Ctrl+S</kbd></div>
                <div class="settings-shortcut-item"><span>停止当前正在执行的任务</span><kbd>Esc</kbd></div>
                <div class="settings-shortcut-item"><span>引用项目文件或目录</span><kbd>@</kbd></div>
                <div class="settings-shortcut-item"><span>打开斜杠命令菜单</span><kbd>/</kbd></div>
              </div>
            </div>
          </template>

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