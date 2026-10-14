<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";
import { collectChanges, totals } from "./collect.js";

/** 对话末尾的变更摘要（Air：任务完成后显示 +512 −4，点击打开 Task Changes） */
const { workbench } = useKernel();
const ws = computed(() => workbench.active.value);
const files = computed(() => collectChanges(ws.value?.blocks));
const sum = computed(() => totals(files.value));

function openChanges() {
  if (!workbench.state.activePanels.includes("changes")) workbench.state.activePanels.push("changes");
}
</script>

<template>
  <button v-if="files.length && !ws?.streaming" class="change-chip" title="查看任务变更" @click="openChanges">
    <span class="change-chip-icon" v-html="icons.diff" />
    <span>{{ files.length }} 个文件</span>
    <span class="stat-add">+{{ sum.added }}</span>
    <span class="stat-del">−{{ sum.removed }}</span>
    <span class="change-chip-go">审查变更</span>
  </button>
</template>
