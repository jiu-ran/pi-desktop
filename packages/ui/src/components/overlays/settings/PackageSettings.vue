<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { PiPackagesOverview, PiPackageItem } from "../../../env.d.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { icons, shortPath } from "../../../shared/util.ts";
import SelectMenu from "../../shared/SelectMenu.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;

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

// 打开设置页时加载；切项目后重拉（已装包与资源列表会变）
onMounted(loadPackagesOverview);
watch(() => state.activeCwd, loadPackagesOverview);
</script>

<template>
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
        <SelectMenu
          v-model="pkgInstallLocal"
          size="sm"
          align="right"
          aria-label="安装位置"
          :options="[
            { value: false, label: '全局安装' },
            { value: true, label: '当前项目 (-l)', hint: state.activeCwd ? '' : '未打开项目', disabled: !state.activeCwd },
          ]"
        />
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
