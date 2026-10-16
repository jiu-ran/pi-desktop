<script setup lang="ts">
import { computed } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import ToolCard from "./ToolCard.vue";

const props = defineProps<{
  block: TranscriptBlock;
}>();

const mcp = computed(() => {
  const parts = (props.block.name ?? "").split("__");
  return parts[0] === "mcp" && parts.length >= 3 ? { server: parts[1], method: parts.slice(2).join("__") } : null;
});

const verb = computed(() => {
  if (mcp.value) return mcp.value.method;
  const known: Record<string, string> = {
    codemode: "运行脚本",
    grep: "搜索",
    find: "查找文件",
    ls: "列出目录",
    web_search: "网页搜索",
    fetch: "抓取网页",
  };
  return (props.block.name && known[props.block.name]) ?? props.block.name ?? "工具";
});

const subtitle = computed(() => {
  const args = props.block.args ?? {};
  const first = args.command ?? args.query ?? args.pattern ?? args.path ?? args.url ?? args.repo ?? args.code;
  if (typeof first === "string") return first.replace(/\s+/g, " ").slice(0, 160);
  const keys = Object.keys(args);
  return keys.length ? keys.join(", ") : "";
});

const argsText = computed(() => {
  const args = props.block.args ?? {};
  if (props.block.name === "codemode" && typeof args.code === "string") return args.code;
  return Object.keys(args).length ? JSON.stringify(args, null, 2) : "";
});

const output = computed(() => {
  const text = props.block.output ?? "";
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… 已截断，共 ${text.length} 字符` : text;
});
</script>

<template>
  <ToolCard :block="block" :verb="verb" :subtitle="subtitle" :badge="mcp ? `MCP · ${mcp.server}` : ''">
    <div v-if="argsText" class="tool-section">
      <span class="tool-section-label">参数</span>
      <pre class="term-out">{{ argsText }}</pre>
    </div>
    <div v-if="output" class="tool-section">
      <span class="tool-section-label">结果</span>
      <pre class="term-out" :class="{ err: block.isError }">{{ output }}</pre>
    </div>
  </ToolCard>
</template>
