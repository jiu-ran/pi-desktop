<script setup lang="ts">
import { computed } from "vue";
import { appSettings, checkAppUpdateWithAutoDownload } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";

/**
 * Pi Desktop：这个桌面应用自己的版本与安装包。
 *
 * 从「环境与快捷键」里独立出来，与「Pi CLI」平级——两者更新的是完全不同的东西，
 * 以前挤在一页里，用户分不清「检查更新」更新的是命令行工具还是这个应用。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;

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

import { NETWORK_MODES, normalizeProxyUrl, proxyPlanLabel, type NetworkMode } from "../../../shared/network-mode.ts";

/**
 * 出网方式（代理）。
 *
 * 桌面端有两条独立的网络路径，必须一起管：
 * - 应用自己（检查更新、下载安装包）走 Electron 的 session 代理；
 * - Pi 子进程（模型请求、MCP、`pi update`）只认 `HTTP(S)_PROXY` 环境变量。
 * 这里选一次，主进程同时落到两处；已经在跑的会话要重启才会用上新代理。
 */
const networkOptions = NETWORK_MODES;
const currentPlan = computed(() =>
  proxyPlanLabel({
    mode: (state.network.mode as NetworkMode) || "auto",
    proxy: state.network.proxy,
    source: (state.network.source as "env" | "system" | "custom" | "none") || "none",
  }),
);
const customProxyInvalid = computed(
  () =>
    appSettings.networkMode === "custom" &&
    appSettings.proxyUrl.trim().length > 0 &&
    !normalizeProxyUrl(appSettings.proxyUrl),
);

function selectNetworkMode(mode: NetworkMode): void {
  appSettings.networkMode = mode;
  // 选「自定义」时先填一个常见值，省得对着空框猜格式
  if (mode === "custom" && !appSettings.proxyUrl.trim()) appSettings.proxyUrl = "127.0.0.1:7890";
}

async function restartForNetwork(): Promise<void> {
  const result = await workbench.restartIdleWorkspaces();
  if (!result) return;
  const text = result.skipped
    ? `已重启 ${result.restarted} 个空闲会话；${result.skipped} 个正在输出的会话会在本轮结束后换上新代理`
    : `已重启 ${result.restarted} 个空闲会话`;
  bus.emit("notify", { level: "info", text });
}
</script>

<template>
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

  <p class="settings-note">
    安装包来自 GitHub Releases；下载后会校验 SHA256，校验不通过不会让你安装。
  </p>
  <div class="settings-group">
    <div class="settings-group-title">网络</div>
    <div class="settings-row">
      <div class="settings-row-info">
        <strong>出网方式</strong>
        <span>应用自身（检查更新、下载安装包）和 Pi（模型请求、MCP、<code>pi update</code>）都按这里选的方式联网</span>
        <span class="settings-row-hint">{{ currentPlan }}</span>
      </div>
      <div class="settings-segments" role="group" aria-label="出网方式">
        <button
          v-for="option in networkOptions"
          :key="option.value"
          type="button"
          class="settings-segment"
          :class="{ active: appSettings.networkMode === option.value }"
          :title="option.hint"
          @click="selectNetworkMode(option.value)"
        >{{ option.label }}</button>
      </div>
    </div>
    <label v-if="appSettings.networkMode === 'custom'" class="settings-row">
      <div class="settings-row-info">
        <strong>代理地址</strong>
        <span>支持 http / https / socks，例如 <code>127.0.0.1:7890</code>（可以省略 <code>http://</code>）</span>
        <span v-if="customProxyInvalid" class="settings-row-hint">地址无效，当前会按直连处理</span>
      </div>
      <input
        v-model="appSettings.proxyUrl"
        type="text"
        class="settings-input"
        placeholder="127.0.0.1:7890"
        spellcheck="false"
        aria-label="代理地址"
      />
    </label>
    <div class="settings-row">
      <div class="settings-row-info">
        <strong>让运行中的会话换用新规则</strong>
        <span>已经启动的 Pi 进程沿用启动时的环境变量，重启空闲会话即可切换；正在输出的会话会在本轮结束后生效</span>
      </div>
      <button type="button" class="btn ghost small" @click="restartForNetwork">重启空闲会话</button>
    </div>
  </div>
</template>
