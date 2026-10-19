<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons, shortPath } from "../../shared/util.ts";

const { workbench } = useKernel();
const state = workbench.state;
const recent = computed(() => state.recent.slice(0, 6));
</script>

<template>
  <section class="welcome">
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
          <button class="btn primary large" @click="workbench.chooseAndOpen()">打开项目</button>
          <span class="version-tag">Pi {{ state.pi.version }}</span>
        </div>

        <div v-if="recent.length" class="recent">
          <p class="eyebrow">最近的项目</p>
          <button v-for="cwd in recent" :key="cwd" class="recent-row" :title="cwd" @click="workbench.open(cwd)">
            <span class="recent-icon" v-html="icons.folder" />
            <strong>{{ baseName(cwd) }}</strong>
            <span class="recent-path">{{ shortPath(cwd, 3) }}</span>
          </button>
        </div>
      </template>
    </div>
  </section>
</template>
