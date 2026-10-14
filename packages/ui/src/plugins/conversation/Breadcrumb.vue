<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";

/** 标题栏面包屑：项目  ⤴ 分支  /  ✓ 任务标题（与 Air 一致） */
const { workbench } = useKernel();
const ws = computed(() => workbench.active.value);
const title = computed(() => {
  if (!ws.value) return "";
  const current = ws.value.sessions.find((item) => item.path === ws.value.sessionFile);
  return ws.value.sessionName || current?.title || "新任务";
});

function showTasks() {
  workbench.state.activeSidebar = "tasks";
  workbench.state.sidebarOpen = true;
}
</script>

<template>
  <nav v-if="ws" class="crumbs">
    <button class="crumb" :title="ws.cwd" @click="showTasks">{{ ws.name }}</button>
    <span v-if="ws.branch" class="crumb" :title="`分支 ${ws.branch}`"><span v-html="icons.branch" />{{ ws.branch }}</span>
    <span class="crumb-slash">/</span>
    <span class="crumb-title" :title="title">
      <span v-if="ws.streaming" class="state-icon running"><span class="mini-spinner" /></span>
      <span v-else-if="ws.status === 'ready'" class="state-icon" v-html="icons.checkCircle" />
      <span>{{ title }}</span>
    </span>
  </nav>
</template>
