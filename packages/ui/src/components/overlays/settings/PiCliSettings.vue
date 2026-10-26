<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { appSettings } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";

/**
 * Pi CLI：本机 pi 命令的路径、版本与更新。
 *
 * 单独做成一页（一级分区），因为它和「Pi Desktop 更新」是两件平级、独立的事：
 * 一个更新命令行工具，一个更新这个桌面应用，混在「环境与快捷键」里既难找也容易混。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;

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

// 打开这一页时做一次轻量刷新：Pi 状态与软件更新的最新值都在 state 上
onMounted(() => {
  if (!state.pi.checking && !state.pi.updating) void workbench.checkPiUpdate?.();
});
</script>

<template>
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
  </div>

  <p class="settings-note">
    Pi CLI 是命令行里的 <code>pi</code>；「Pi Desktop」那一页才是这个桌面应用自己的版本与安装包。
  </p>
</template>
