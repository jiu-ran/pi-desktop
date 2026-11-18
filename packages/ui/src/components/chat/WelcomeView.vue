<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { openCloneDialog } from "../../services/clone-dialog.ts";
import { openSettingsModal } from "../../services/settings.ts";
import { displayProjectName, icons, projectPathKey, shortPath } from "../../shared/util.ts";

const { workbench } = useKernel();
const state = workbench.state;

const recent = computed(() => {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const cwd of state.recent) {
    const key = projectPathKey(cwd);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(cwd);
  }
  return list.slice(0, 5);
});

const agents = computed<any[]>(() => state.agents?.agents ?? []);
const found = computed(() => agents.value.filter((agent: any) => agent?.found));
const checking = computed(() => !state.agents.loaded);

function openAntigravityDocs(): void {
  (globalThis as any).piDesktop?.openExternalUrl?.("https://antigravity.google/docs/cli/overview");
}
</script>

<template>
  <section class="welcome">
    <div class="welcome-glow" aria-hidden="true" />
    <div class="welcome-shell">
      <div class="welcome-hero">
        <div class="pi-emblem" aria-hidden="true">
          <span class="pi-emblem-glyph">π</span>
        </div>

        <div class="welcome-heading">
          <h1>Pi Desktop</h1>
          <span v-if="checking" class="welcome-status checking">
            <span class="mini-spinner" />
            检测本机 Agent…
          </span>
          <span v-else-if="found.length" class="welcome-status ready" title="打开项目后选择这个项目使用的 Agent">
            <span class="welcome-status-dot" />
            {{ found.length }} 个 Agent 可用
          </span>
          <span v-else class="welcome-status error">未找到 Agent</span>
        </div>

        <p class="welcome-sub">
          Pi Desktop 可以驱动本机 Pi 或 Antigravity。打开项目后先选择这个项目使用的 Agent，
          选择会按项目记住，之后在标题栏左侧随时切换。
        </p>

        <div class="welcome-agents">
          <span
            v-for="agent in agents"
            :key="agent.kind"
            class="welcome-agent"
            :class="{ missing: !agent.found }"
            :title="agent.error || agent.path"
          >
            <span class="welcome-agent-dot" :data-state="agent.found ? 'ready' : 'error'" />
            <strong>{{ agent.label }}</strong>
            <span v-if="agent.found" class="welcome-agent-version">v{{ agent.version }}</span>
            <span v-else class="welcome-agent-version">未安装</span>
          </span>
          <span v-if="checking" class="welcome-agent muted">正在检测…</span>
        </div>

        <div class="welcome-actions">
          <button type="button" class="btn primary large welcome-btn-primary" @click="workbench.chooseAndOpen()">
            <span v-html="icons.folder" />
            <span>打开项目</span>
          </button>
          <button type="button" class="btn large welcome-btn" @click="openCloneDialog()">
            <span v-html="icons.branch" />
            <span>从 Git 克隆</span>
          </button>
        </div>

        <template v-if="!checking && !found.length">
          <p class="welcome-sub welcome-install-hint">
            没有检测到可用的 Agent。安装 Pi 或 Antigravity CLI 后重开窗口即可。
          </p>
          <div class="welcome-actions welcome-install-actions">
            <button type="button" class="btn welcome-btn" @click="openSettingsModal('pi-cli')">
              <span v-html="icons.sliders" />配置 Pi 路径
            </button>
            <button type="button" class="btn welcome-btn" @click="openAntigravityDocs">
              <span v-html="icons.download" />安装 Antigravity
            </button>
          </div>
        </template>
      </div>

      <div v-if="recent.length" class="welcome-panel">
        <div class="welcome-panel-head">
          <span class="welcome-panel-title">最近项目</span>
        </div>
        <div class="recent-list">
          <button
            v-for="cwd in recent"
            :key="cwd"
            type="button"
            class="recent-row"
            :title="cwd"
            @click="workbench.open(cwd)"
          >
            <span class="recent-icon" v-html="icons.folder" />
            <span class="recent-copy">
              <strong>{{ displayProjectName(cwd) }}</strong>
              <span class="recent-path">{{ shortPath(cwd, 3) }}</span>
            </span>
            <span class="recent-go" v-html="icons.chevronRight" />
          </button>
        </div>
      </div>

      <div class="welcome-hint">
        <span><kbd>Ctrl O</kbd> 打开项目</span>
        <span><kbd>Ctrl K</kbd> 命令面板</span>
        <span><kbd>Ctrl ,</kbd> 偏好设置</span>
      </div>
    </div>
  </section>
</template>
