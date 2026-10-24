<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TranscriptBlock } from "../../kernel/transcript.ts";
import ToolCard from "../../components/chat/tools/ToolCard.vue";
import SearchHighlight from "../../components/chat/SearchHighlight.vue";
import { formatDuration, subagentModeLabel, subagentStateLabel, summarizeSubagent } from "./summary.ts";
import "../../styles/subagent.css";

/**
 * 子代理 / 并行 / 评审类工具：把 details.results 渲染成子任务清单。
 * details 缺失时退回普通文本结果（与 GenericTool 行为一致）。
 */
const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const settled = computed(() => props.block.status !== "running" && props.block.status !== "pending");
const summary = computed(() => summarizeSubagent(props.block.details, settled.value));

const agentName = computed(() => {
  const agent = String(props.block.args?.agent ?? "").trim();
  if (agent) return agent;
  return summary.value?.agents[0] ?? "";
});

const verb = computed(() => (settled.value ? "子代理" : "子代理运行中"));

const subtitle = computed(() => {
  const task = String(props.block.args?.task ?? props.block.args?.prompt ?? "").replace(/\s+/g, " ").trim();
  if (task) return task.slice(0, 160);
  const rows = summary.value?.rows ?? [];
  if (rows.length === 1) return rows[0].output.replace(/\s+/g, " ").slice(0, 160);
  if (rows.length > 1) return `${rows.length} 个子任务`;
  return agentName.value;
});

const badge = computed(() => {
  const mode = summary.value?.mode ?? "";
  const asyncRun = props.block.args?.async === true || props.block.args?.async === "true";
  const parts = [mode ? subagentModeLabel(mode) : "", asyncRun ? "后台" : ""].filter(Boolean);
  return parts.join(" · ");
});

const argsText = computed(() => {
  const args = props.block.args ?? {};
  const task = typeof args.task === "string" ? args.task : typeof args.prompt === "string" ? args.prompt : "";
  const rest = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "task" && key !== "prompt"));
  const head = task ? `# 任务\n${task}` : "";
  const tail = Object.keys(rest).length ? `# 参数\n${JSON.stringify(rest, null, 2)}` : "";
  return [head, tail].filter(Boolean).join("\n\n");
});

const output = computed(() => {
  const text = props.block.output ?? "";
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… 已截断，共 ${text.length} 字符` : text;
});

function metaOf(row: NonNullable<ReturnType<typeof summarizeSubagent>>["rows"][number]): string {
  const parts: string[] = [];
  const duration = formatDuration(row.durationMs);
  if (duration) parts.push(duration);
  if (row.tools !== null) parts.push(`${row.tools} 工具`);
  if (row.turns !== null) parts.push(`${row.turns} 轮`);
  if (row.tokens !== null) parts.push(`${row.tokens} tok`);
  return parts.join(" · ");
}

const expanded = ref(false);
// 有失败项时默认展开明细，方便直接定位问题。
watch(
  () => summary.value?.failed ?? 0,
  (failed) => {
    if (failed > 0) expanded.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <ToolCard
    :block="block"
    :verb="verb"
    :subtitle="subtitle"
    :badge="badge"
    :query="query"
  >
    <div v-if="summary?.rows.length" class="tool-section subagent-list">
      <button type="button" class="subagent-head" @click="expanded = !expanded">
        <span class="subagent-caret" :class="{ open: expanded }">›</span>
        <span>{{ summary.rows.length }} 个子任务</span>
        <span v-if="summary.ok" class="subagent-stat ok">{{ summary.ok }} 完成</span>
        <span v-if="summary.failed" class="subagent-stat err">{{ summary.failed }} 失败</span>
        <span v-if="summary.running" class="subagent-stat run">{{ summary.running }} 运行中</span>
      </button>
      <ul v-if="expanded" class="subagent-rows">
        <li v-for="(row, index) in summary.rows" :key="`${row.agent}-${index}`" class="subagent-row" :data-state="row.state">
          <span class="subagent-dot" aria-hidden="true" />
          <span class="subagent-agent">{{ row.agent }}</span>
          <span class="subagent-state">{{ subagentStateLabel(row.state) }}</span>
          <span v-if="row.currentTool && row.state === 'running'" class="subagent-current">{{ row.currentTool }}</span>
          <span class="subagent-meta">{{ metaOf(row) }}</span>
          <span v-if="row.error" class="subagent-error" :title="row.error">{{ row.error }}</span>
        </li>
      </ul>
    </div>

    <div v-if="argsText" class="tool-section">
      <span class="tool-section-label">参数</span>
      <pre class="term-out"><SearchHighlight :text="argsText" :query="query" /></pre>
    </div>

    <div v-if="output" class="tool-section">
      <span class="tool-section-label">结果</span>
      <pre class="term-out" :class="{ err: block.isError }"><SearchHighlight :text="output" :query="query" /></pre>
    </div>
  </ToolCard>
</template>
