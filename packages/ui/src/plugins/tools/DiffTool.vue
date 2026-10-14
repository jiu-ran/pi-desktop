<script setup lang="ts">
import { computed } from "vue";
import { baseName } from "../../shared/util.ts";
import { blockDiff, diffStat } from "../../shared/diff.ts";
import DiffView from "./DiffView.vue";
import ToolCard from "./ToolCard.vue";

/**
 * edit / write 步骤。优先使用 Pi 在结果 details.diff 里算好的带行号 diff；
 * 尚未执行完时用参数里的 oldText/newText 预览。
 */
const props = defineProps({ block: { type: Object, required: true } });

const path = computed(() => props.block.args?.path ?? "");
const isWrite = computed(() => props.block.name === "write");
const lines = computed(() => blockDiff(props.block));
const stat = computed(() => diffStat(lines.value));
const running = computed(() => props.block.status === "running" || props.block.status === "pending");
const verb = computed(() => {
  if (isWrite.value) return running.value ? "正在写入" : "写入";
  return running.value ? "正在编辑" : "编辑";
});
</script>

<template>
  <ToolCard
    :block="block"
    :verb="verb"
    :subtitle="baseName(path)"
    :added="stat.added"
    :removed="isWrite ? null : stat.removed"
  >
    <div class="diff-file" :title="path">{{ path }}</div>
    <DiffView :lines="lines" />
    <pre v-if="block.isError" class="term-out err">{{ block.output }}</pre>
  </ToolCard>
</template>
