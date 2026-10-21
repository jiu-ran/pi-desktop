<script setup lang="ts">
import { computed } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { baseName } from "../../../shared/util.ts";
import ToolCard from "./ToolCard.vue";
import ToolImages from "./ToolImages.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const { bus } = useKernel();
const path = computed(() => String(props.block.args?.path ?? ""));
const range = computed(() => {
  const { offset, limit } = props.block.args ?? {};
  if (offset && limit) return `L${offset}–${offset + limit - 1}`;
  if (offset) return `L${offset}+`;
  if (limit) return `${limit} 行`;
  return "";
});
const READ_IMAGE_NOTE = /^Read image file \[[^\]]+\]$/;

const images = computed(() => props.block.imageItems ?? []);

const preview = computed(() => {
  const hasImages = images.value.length > 0;
  const lines = (props.block.output ?? "")
    .split(/\r?\n/)
    // 图片已经渲染成缩略图，不再重复展示“Read image file”这类底层提示
    .filter((line) => !(hasImages && READ_IMAGE_NOTE.test(line.trim())));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const text = lines.join("\n");
  return lines.length > 60 ? `${lines.slice(0, 60).join("\n")}\n… 共 ${lines.length} 行` : text;
});

function openInEditor(): void {
  if (path.value) bus.emit("file:open", path.value);
}
</script>

<template>
  <ToolCard :block="block" :verb="block.status === 'running' ? '正在读取' : '读取'" :subtitle="baseName(path)" :meta="range">
    <div class="diff-file clickable" :title="`在代码编辑器中打开 ${path}`" @click="openInEditor">{{ path }}</div>
    <ToolImages v-if="images.length" :items="images" />
    <pre v-if="preview" class="term-out" :class="{ err: block.isError }"><SearchHighlight :text="preview" :query="query" /></pre>
  </ToolCard>
</template>
