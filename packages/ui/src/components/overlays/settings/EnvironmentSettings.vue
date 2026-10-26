<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { appSettings, checkAppUpdateWithAutoDownload } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { icons } from "../../../shared/util.ts";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;
const ws = computed(() => workbench.active.value);

// ==================== 本机 Pi CLI 与软件更新 ====================
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

// 打开设置页时做一次轻量刷新：Pi 状态与软件更新的最新值都在 state 上
onMounted(() => {
  if (!state.pi.checking && !state.pi.updating) void workbench.checkPiUpdate?.();
});

/** 重启当前会话的 Pi 进程（改完路径 / 更新后让新进程生效） */
async function restartActiveProcess(): Promise<void> {
  if (!ws.value) return;
  await workbench.restart(ws.value);
  bus.emit("notify", { level: "info", text: "已重启当前会话的 Pi 进程" });
}
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
