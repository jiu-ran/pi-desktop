<script setup>
import { computed } from "vue";
import { baseName } from "../../shared/util.js";
import ToolCard from "./ToolCard.vue";

const props = defineProps({ block: { type: Object, required: true } });
const path = computed(() => props.block.args?.path ?? "");
const range = computed(() => {
  const { offset, limit } = props.block.args ?? {};
  if (offset && limit) return `L${offset}–${offset + limit - 1}`;
  if (offset) return `L${offset}+`;
  if (limit) return `${limit} 行`;
  return "";
});
const preview = computed(() => {
  const text = props.block.output ?? "";
  const lines = text.split(/\r?\n/);
  return lines.length > 60 ? `${lines.slice(0, 60).join("\n")}\n… 共 ${lines.length} 行` : text;
});
</script>

<template>
  <ToolCard :block="block" :verb="block.status === 'running' ? '正在读取' : '读取'" :subtitle="baseName(path)" :meta="range">
    <div class="diff-file" :title="path">{{ path }}</div>
    <pre class="term-out" :class="{ err: block.isError }">{{ preview || "（空）" }}</pre>
  </ToolCard>
</template>
