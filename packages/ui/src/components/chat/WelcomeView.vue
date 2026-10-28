<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { openCloneDialog } from "../../services/clone-dialog.ts";
import { displayProjectName, icons, projectPathKey, shortPath } from "../../shared/util.ts";

const { workbench, plugins } = useKernel();
const state = workbench.state;
// 终端是可关闭的可选插件，未启用时不要把它列成已有功能。
const terminalEnabled = computed(() => Boolean(plugins.get("terminal")?.enabled));
const recent = computed(() => {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const cwd of state.recent) {
    const key = projectPathKey(cwd);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(cwd);
  }
  return list.slice(0, 6);
});
</script>

<template>
  <section class="welcome">
    <div class="welcome-glow" aria-hidden="true" />
    <div class="welcome-card">
      <img class="welcome-logo" src="../../assets/pi-icon.png" alt="Pi Desktop" />

      <template v-if="!state.pi.checked">
        <h1>正在查找本机 Pi…</h1>
      </template>

      <template v-else-if="!state.pi.found">
        <h1>没有找到本机 Pi CLI</h1>
        <p class="welcome-sub">Pi Desktop 只使用你已安装的 <code>pi</code>，不会内置或下载。安装后重新打开窗口。</p>
        <pre class="install">npm install -g @earendil-works/pi-coding-agent</pre>
      </template>

      <template v-else>
        <div class="welcome-heading">
          <h1>Pi Desktop</h1>
          <span class="welcome-version" :title="`本机 Pi CLI ${state.pi.version}`">Pi {{ state.pi.version }}</span>
        </div>
        <p class="welcome-sub">打开本地项目，开始编码、查看改动，并使用本机 Pi 的模型、Skills 与 MCP。</p>

        <div class="welcome-actions">
          <button type="button" class="btn primary large welcome-open" @click="workbench.chooseAndOpen()">
            <span v-html="icons.folder" />打开项目
          </button>
          <button type="button" class="btn large welcome-open" @click="openCloneDialog()">
            <span v-html="icons.branch" />从 Git 克隆
          </button>
        </div>

        <ul class="welcome-features" aria-label="主要能力">
          <li><span v-html="icons.folder" />项目文件</li>
          <li><span v-html="icons.diff" />版本控制</li>
          <li v-if="terminalEnabled"><span v-html="icons.terminal" />终端任务</li>
        </ul>

        <div v-if="recent.length" class="recent">
          <p class="eyebrow">最近项目</p>
          <div class="recent-list">
            <button v-for="cwd in recent" :key="cwd" type="button" class="recent-row" :title="cwd" @click="workbench.open(cwd)">
              <span class="recent-icon" v-html="icons.folder" />
              <span class="recent-copy">
                <strong>{{ displayProjectName(cwd) }}</strong>
                <span class="recent-path">{{ shortPath(cwd, 3) }}</span>
              </span>
              <span class="recent-go" v-html="icons.chevronRight" />
            </button>
          </div>
        </div>

        <p class="welcome-hint">
          <span><kbd>Ctrl O</kbd> 打开项目</span>
          <span><kbd>@</kbd> 引用文件</span>
          <span><kbd>/</kbd> 使用命令</span>
          <span><kbd>Ctrl P</kbd> 快速打开文件</span>
        </p>
      </template>
    </div>
  </section>
</template>
