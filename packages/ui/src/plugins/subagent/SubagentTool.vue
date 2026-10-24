<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TranscriptBlock } from "../../kernel/transcript.ts";
import SearchHighlight from "../../components/chat/SearchHighlight.vue";
import { formatDuration, subagentModeLabel, subagentStateLabel, summarizeSubagent, type SubagentState } from "./summary.ts";
import SubagentDialog from "./SubagentDialog.vue";
import "../../styles/subagent.css";

/**
 * 子代理类工具（subagent / parallel / review / bg_wait）：单独占一行，不再折进活动组。
 *
 * 一行里给出「在跑什么、跑到哪、多久了」，点一下打开这个子代理自己的对话。
 * details 缺失时退回普通工具卡片（参数 + 文本结果），与停用插件时的表现一致。
 */
const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const settled = computed(() => props.block.status !== "running" && props.block.status !== "pending");
const summary = computed(() => summarizeSubagent(props.block.details, settled.value));
const rows = computed(() => summary.value?.rows ?? []);

/** 打开第 N 个子任务的对话；null 表示关闭。 */
const dialogIndex = ref<number | null>(null);

/** 运行中每秒钟刷新一次已用时长，卡住时也能看出时间在走。 */
const now = ref(Date.now());
let ticker = 0;
const running = computed(() => !settled.value || rows.value.some((row) => row.state === "running"));
onMounted(() => {
  if (!running.value) return;
  ticker = window.setInterval(() => { now.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => { if (ticker) window.clearInterval(ticker); });

const elapsedMs = computed(() => {
  if (settled.value) return props.block.durationMs ?? null;
  const started = props.block.startedAt;
  return typeof started === "number" ? Math.max(0, now.value - started) : null;
});

const task = computed(() => {
  const args = props.block.args ?? {};
  const raw = String(args.task ?? args.prompt ?? rows.value[0]?.task ?? "").replace(/\s+/g, " ").trim();
  return raw;
});

const title = computed(() => {
  const list = rows.value;
  if (list.length > 1) return `子代理 · ${subagentModeLabel(summary.value?.mode ?? "") || "并行"} ${list.length} 个子任务`;
  const agent = list[0]?.agent || String(props.block.args?.agent ?? "").trim() || "子代理";
  return `子代理 · ${agent}`;
});

/** 卡片整体状态取「最需要关注」的那个：失败 > 超时 > 停止 > 运行中 > 完成。 */
const state = computed<SubagentState>(() => {
  const states = rows.value.map((row) => row.state);
  if (states.includes("failed")) return "failed";
  if (states.includes("timeout")) return "timeout";
  if (states.includes("stopped")) return "stopped";
  if (states.includes("running") || !settled.value) return "running";
  return "ok";
});

const meta = computed(() => {
  const list = rows.value;
  const parts: string[] = [];
  const tools = list.reduce((sum, row) => sum + (row.tools ?? 0), 0);
  const tokens = list.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  if (tools) parts.push(`${tools} 工具`);
  if (tokens) parts.push(`${tokens} tok`);
  if (list.length > 1) {
    const ok = list.filter((row) => row.state === "ok").length;
    if (ok) parts.push(`${ok} 完成`);
  }
  const duration = formatDuration(elapsedMs.value);
  if (duration) parts.push(duration);
  return parts.join(" · ");
});

const errors = computed(() =>
  rows.value
    .filter((row) => row.error)
    .slice(0, 2)
    .map((row) => ({ agent: row.agent, error: row.error, state: row.state })),
);

/** 没有结构化结果时的原始输出：截断成一小块，避免整段结果把对话撑长。 */
const rawOutput = computed(() => {
  const text = props.block.output ?? "";
  if (!text.trim()) return "";
  return text.length > 1200 ? `${text.slice(0, 1200).trimEnd()}\n… 已截断，共 ${text.length} 字符` : text;
});
const canOpen = computed(() => rows.value.length > 0);
</script>

<template>
  <section class="subagent-card" :data-state="state" :data-block-id="block.id">
    <button
      type="button"
      class="subagent-card-main"
      :aria-label="canOpen ? `查看${title}的对话` : title"
      :title="canOpen ? (task || title) : task"
      :disabled="!canOpen"
      @click="canOpen && (dialogIndex = 0)"
    >
      <span class="subagent-dot" :data-state="state" aria-hidden="true" />
      <span class="subagent-card-title">{{ title }}</span>
      <span class="subagent-card-state" :data-state="state">
        <span v-if="state === 'running'" class="mini-spinner" aria-hidden="true" />
        {{ subagentStateLabel(state) }}
      </span>
      <span v-if="task && rows.length <= 1" class="subagent-card-task"><SearchHighlight :text="task" :query="query" /></span>
      <span class="subagent-card-meta">{{ meta }}</span>
      <span v-if="canOpen" class="subagent-card-open">查看对话 ›</span>
    </button>
    <p v-for="item in errors" :key="item.agent" class="subagent-card-error" :title="item.error">
      <span class="subagent-card-error-agent">{{ item.agent }}</span>
      <span class="subagent-card-error-text">{{ item.error }}</span>
    </p>
    <!-- 没有结构化结果（老版本扩展 / 还没回传进度）时，给一小块原始输出，别把整段结果铺满。 -->
    <pre v-if="!canOpen && rawOutput" class="subagent-card-raw" :class="{ err: block.isError }"><SearchHighlight :text="rawOutput" :query="query" /></pre>
  </section>

  <SubagentDialog
    v-if="dialogIndex !== null && rows.length"
    :rows="rows"
    :initial-index="dialogIndex"
    @close="dialogIndex = null"
  />
</template>
