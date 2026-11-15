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
</script>

<template>
  <section class="welcome">
    <div class="welcome-glow" aria-hidden="true" />
    <div class="welcome-shell">
      <div class="welcome-hero">
        <div class="pi-emblem" aria-hidden="true">
          <span class="pi-emblem-glyph">π</span>
        </div>

        <template v-if="!state.pi.checked">
          <div class="welcome-heading">
            <h1>Pi Desktop</h1>
            <span class="welcome-status checking">
              <span class="mini-spinner" />
              检测本机 Pi…
            </span>
          </div>
          <p class="welcome-sub">正在检查本机 Pi CLI 环境…</p>
        </template>

        <template v-else-if="!state.pi.found">
          <div class="welcome-heading">
            <h1>未找到 Pi CLI</h1>
            <span class="welcome-status error">未连接</span>
          </div>
          <p class="welcome-sub">Pi Desktop 直接驱动你本机已安装的 <code>pi</code>，安装后重开窗口即可。</p>
          <pre class="install">npm install -g @earendil-works/pi-coding-agent</pre>
          <div class="welcome-actions">
            <button type="button" class="btn large welcome-btn" @click="openSettingsModal('pi-cli')">
              <span v-html="icons.sliders" />配置路径
            </button>
          </div>
        </template>

        <template v-else>
          <div class="welcome-heading">
            <h1>Pi Desktop</h1>
            <span class="welcome-status ready" :title="`本机 Pi CLI ${state.pi.version}`">
              <span class="welcome-status-dot" />
              Pi {{ state.pi.version }}
            </span>
          </div>
          <p class="welcome-sub">打开或拖入本地项目，开始编码、审查改动与运行工具。</p>

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
        </template>
      </div>

      <template v-if="state.pi.checked && state.pi.found">
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
      </template>
    </div>
  </section>
</template>
