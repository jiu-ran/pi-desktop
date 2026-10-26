<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { appSettings } from "../../services/settings.ts";
import { pushToast } from "../../services/extension-ui.ts";
import { localizeNotification } from "../../shared/notify-text.ts";
import { icons } from "../../shared/util.ts";
import SelectMenu from "../shared/SelectMenu.vue";

const { terminal, plugins, platform } = useKernel();
const selected = ref(appSettings.terminalProfile);
const pathDraft = ref(appSettings.terminalCustomPath);
const argsDraft = ref(JSON.stringify(appSettings.terminalCustomArgs));
const saving = ref(false);
const toggling = ref(false);
const error = ref("");
const selectedProfile = computed(() => terminal.state.profiles.find((profile) => profile.id === appSettings.terminalProfile));
const unavailable = computed(() => appSettings.terminalProfile !== "custom" && !selectedProfile.value && !terminal.state.profilesLoading);

async function togglePlugin(): Promise<void> {
  if (toggling.value) return;
  toggling.value = true;
  try { await plugins.setEnabled("terminal", !terminal.state.enabled); }
  finally { toggling.value = false; }
}

async function selectProfile(id: string): Promise<void> {
  selected.value = id;
  error.value = "";
  if (id === "custom") return;
  saving.value = true;
  try {
    await window.piDesktop?.validateTerminalProfile({ profileId: id });
    appSettings.terminalProfile = id;
    pushToast("info", "默认终端已更新，下次新建终端时生效；已有会话不受影响");
  } catch (err: any) {
    error.value = localizeNotification(err?.message || String(err));
    selected.value = appSettings.terminalProfile;
  } finally { saving.value = false; }
}

async function browse(): Promise<void> {
  try {
    const chosen = await window.piDesktop?.chooseTerminalExecutable();
    if (chosen) pathDraft.value = chosen;
  } catch (err: any) {
    error.value = localizeNotification(err?.message || String(err));
  }
}

async function saveCustom(): Promise<void> {
  if (saving.value) return;
  error.value = "";
  let args: string[];
  try {
    args = JSON.parse(argsDraft.value || "[]");
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error();
  } catch {
    error.value = '启动参数请填写 JSON 字符串数组，例如 ["--login", "-i"]';
    return;
  }
  saving.value = true;
  try {
    const profile = await window.piDesktop?.validateTerminalProfile({
      profileId: "custom", customPath: pathDraft.value.trim(), customArgs: args,
    });
    if (!profile) throw new Error("终端配置仅在桌面端可用");
    appSettings.terminalCustomPath = profile.file;
    appSettings.terminalCustomArgs = [...profile.args];
    appSettings.terminalProfile = "custom";
    pathDraft.value = profile.file;
    pushToast("info", "已保存自定义终端，下次新建会话使用此配置");
  } catch (err: any) {
    error.value = localizeNotification(err?.message || String(err));
  } finally { saving.value = false; }
}

async function stopAll(): Promise<void> {
  if (!window.confirm(`确定结束 ${terminal.runningCount.value} 个终端 / 后台任务吗？正在运行的程序会被停止。`)) return;
  for (const task of [...terminal.state.tasks]) if (task.status === "running") await terminal.stop(task.id);
}

watch(() => appSettings.terminalProfile, (id) => { selected.value = id; });
watch(() => appSettings.terminalCustomPath, (file) => { pathDraft.value = file; });
watch(() => appSettings.terminalCustomArgs, (args) => { argsDraft.value = JSON.stringify(args); }, { deep: true });
onMounted(() => void terminal.refreshProfiles());
</script>

<template>
  <div class="settings-group">
    <div class="settings-group-title">可选终端插件</div>
    <div class="settings-row">
      <div class="settings-row-info">
        <strong>启用终端与后台任务</strong>
        <span>默认关闭。启用后显示底部面板、标题栏入口与 Ctrl/Cmd + 反引号快捷键。</span>
      </div>
      <input class="settings-switch" type="checkbox" :checked="terminal.state.enabled" :disabled="toggling" @change="togglePlugin" />
    </div>
    <div v-if="!terminal.state.enabled && terminal.runningCount.value" class="settings-row">
      <div class="settings-row-info">
        <strong>{{ terminal.runningCount.value }} 个任务仍在后台运行</strong>
        <span>停用插件只隐藏界面，不会强制结束程序。重新启用可以接回会话。</span>
      </div>
      <button type="button" class="btn ghost small" @click="stopAll">结束所有任务</button>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-head">
      <span class="settings-group-title">新建终端的默认 shell</span>
      <button type="button" class="btn ghost small" :disabled="terminal.state.profilesLoading" @click="terminal.refreshProfiles()">
        <span class="settings-inline-icon" v-html="icons.refresh" />
        {{ terminal.state.profilesLoading ? "检测中…" : "重新检测" }}
      </button>
    </div>
    <div class="settings-row">
      <div class="settings-row-info">
        <strong>默认终端</strong>
        <span>仅改变新建会话。现有终端继续使用创建时的 shell，可在 + 旁的菜单临时新建其他 shell。</span>
      </div>
      <SelectMenu
        :model-value="selected"
        :disabled="saving || !terminal.available"
        aria-label="默认终端"
        :options="[
          ...(unavailable ? [{ value: appSettings.terminalProfile, label: `配置已失效 · ${appSettings.terminalProfile}`, disabled: true }] : []),
          ...terminal.state.profiles.map((profile: any) => ({ value: profile.id, label: profile.label })),
          { value: 'custom', label: '自定义可执行文件…' },
        ]"
        @change="(value) => void selectProfile(String(value))"
      />
    </div>
    <p class="terminal-settings-note">
      <template v-if="platform === 'win32'">系统默认使用 %ComSpec%（通常是 CMD）；pwsh、Windows PowerShell 和 Git Bash 安装后会自动列出。这里切换的是 shell，不会修改 Windows Terminal 等外部终端应用的设置。</template>
      <template v-else>系统默认使用 $SHELL / 用户登录 shell；可切换已安装的 Zsh、Bash、Fish、pwsh 等。</template>
    </p>
    <div v-if="selectedProfile && selected !== 'custom'" class="terminal-settings-path">
      <strong>{{ selectedProfile.label }}</strong>
      <code>{{ selectedProfile.file }}</code>
      <small>启动参数：{{ JSON.stringify(selectedProfile.args) }}</small>
    </div>
    <p v-if="terminal.state.profilesError" class="terminal-settings-error">{{ localizeNotification(terminal.state.profilesError) }}</p>
    <div v-if="selected === 'custom'" class="settings-card-form">
      <div class="settings-form-head"><strong>自定义 shell</strong></div>
      <label class="terminal-settings-field">
        <span>可执行文件的绝对路径</span>
        <div class="terminal-settings-browse">
          <input v-model="pathDraft" class="settings-input mono" spellcheck="false" :placeholder="platform === 'win32' ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : '/bin/zsh'" aria-label="自定义终端路径" />
          <button type="button" class="btn ghost small" @click="browse">选择文件…</button>
        </div>
      </label>
      <label class="terminal-settings-field">
        <span>启动参数（JSON 字符串数组；不是整条命令）</span>
        <input v-model="argsDraft" class="settings-input mono" spellcheck="false" placeholder='["--login", "-i"]' aria-label="终端启动参数" />
      </label>
      <p class="terminal-settings-note">路径和参数分开传递，不经过 shell 拼接。Windows 请选择 .exe；Git Bash 使用 bin/bash.exe，参数 ["--login", "-i"]，不要选择 git-bash.exe 启动器。</p>
      <div class="settings-form-foot">
        <button type="button" class="btn small" :disabled="saving || !pathDraft.trim()" @click="saveCustom">{{ saving ? "校验中…" : "校验并保存" }}</button>
      </div>
    </div>
    <p v-if="error" class="terminal-settings-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.terminal-settings-note { margin: 8px 0; color: var(--fg-3); font-size: 11.5px; line-height: 1.65; }
.terminal-settings-path { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg-1); }
.terminal-settings-path strong { color: var(--fg-2); font-size: 12px; }
.terminal-settings-path code { color: var(--fg-2); font-size: 11.5px; overflow-wrap: anywhere; }
.terminal-settings-path small { color: var(--fg-3); font-size: 11px; }
.terminal-settings-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px; color: var(--fg-2); font-size: 12px; }
.terminal-settings-browse { display: flex; gap: 8px; }
.terminal-settings-browse input { flex: 1; min-width: 0; }
.terminal-settings-browse button { flex: none; }
.terminal-settings-error { margin: 10px 0; color: var(--err); font-size: 12px; overflow-wrap: anywhere; }
</style>
