<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
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
        <p>Pi Desktop 只使用你已安装的 <code>pi</code>，不会内置或下载。安装后重新打开窗口。</p>
        <pre class="install">npm install -g @earendil-works/pi-coding-agent</pre>
      </template>

      <template v-else>
        <h1>Pi Desktop</h1>
        <p>打开一个本地项目，开始编码、查看文件修改，并使用本机 Pi 的模型、Skills 与 MCP。</p>
        <div class="welcome-actions">
          <button class="btn primary large welcome-open" @click="workbench.chooseAndOpen()">
            <span v-html="icons.folder" />打开项目
          </button>
          <span class="version-tag">Pi {{ state.pi.version }}</span>
        </div>

        <div class="welcome-features" aria-label="主要功能">
          <span><i v-html="icons.folder" />项目文件</span>
          <span><i v-html="icons.diff" />版本控制</span>
          <span><i v-html="icons.terminal" />终端任务</span>
        </div>

        <div v-if="recent.length" class="recent">
          <p class="eyebrow">最近项目</p>
          <div class="recent-list">
            <button v-for="cwd in recent" :key="cwd" class="recent-row" :title="cwd" @click="workbench.open(cwd)">
              <span class="recent-icon" v-html="icons.folder" />
              <span class="recent-copy">
                <strong>{{ displayProjectName(cwd) }}</strong>
                <span class="recent-path">{{ shortPath(cwd, 3) }}</span>
              </span>
              <span class="recent-go" v-html="icons.chevronRight" />
            </button>
          </div>
        </div>

        <p class="welcome-hint"><kbd>@</kbd> 引用文件 <span>·</span> <kbd>/</kbd> 使用命令 <span>·</span> <kbd>Ctrl P</kbd> 快速打开</p>
      </template>
    </div>
  </section>
</template>
