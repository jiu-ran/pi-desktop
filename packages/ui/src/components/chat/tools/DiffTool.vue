<script setup lang="ts">
import { computed } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { baseName } from "../../../shared/util.ts";
import { blockDiff, diffStat } from "../../../shared/diff.ts";
import DiffView from "../../shared/DiffView.vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
  block: TranscriptBlock;
}>();

const { bus } = useKernel();
const path = computed(() => String(props.block.args?.path ?? ""));
const isWrite = computed(() => props.block.name === "write");
const lines = computed(() => blockDiff(props.block));
const stat = computed(() => diffStat(lines.value));
const running = computed(() => props.block.status === "running" || props.block.status === "pending");
const verb = computed(() => {
  if (isWrite.value) return running.value ? "正在写入" : "写入";
  return running.value ? "正在编辑" : "编辑";
});

function openInEditor(): void {
  if (path.value) bus.emit("file:open", path.value);
}
</script>

<template>
  <ToolCard
    :block="block"
    :verb="verb"
    :subtitle="baseName(path)"
    :added="stat.added"
    :removed="isWrite ? null : stat.removed"
  >
    <div class="diff-file clickable" :title="`在代码编辑器中打开 ${path}`" @click="openInEditor">{{ path }}</div>
    <DiffView :lines="lines" />
    <pre v-if="block.isError" class="term-out err">{{ block.output }}</pre>
  </ToolCard>
</template>
