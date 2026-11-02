<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import SearchHighlight from "../SearchHighlight.vue";

/**
 * 对话里的 `!` / `!!` 命令。
 *
 * 和工具卡片（Pi 的 bash 工具）是两回事：这条命令是人直接跑的，
 * 输出会被 Pi 记进会话，下一次提问时（`!!` 除外）作为用户上下文交给模型。
 * 所以标题写「运行」而不是工具名，并明确标出是否进入上下文。
 */
const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const { workbench, bus } = useKernel();
const running = computed(() => props.block.status === "running" || props.block.status === "pending");
const verb = computed(() => {
  if (running.value) return "正在运行";
  if (props.block.cancelled) return "已停止";
  return "运行";
});
const open = ref(running.value || Boolean(props.block.isError));
watch(
  () => [running.value, props.block.isError] as const,
  ([live, failed]) => {
    if (live || failed) open.value = true;
  },
);

const now = ref(Date.now());
let ticker: number | null = null;
const copied = ref(false);
let copyTimer: number | null = null;
function syncTicker(): void {
  if (running.value && ticker === null) {
    ticker = window.setInterval(() => {
      now.value = Date.now();
    }, 200);
  } else if (!running.value && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
}
watch(running, syncTicker, { immediate: true });
onMounted(syncTicker);
onBeforeUnmount(() => {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
  if (copyTimer !== null) window.clearTimeout(copyTimer);
  copyTimer = null;
});

const elapsedMs = computed(() => {
  if (props.block.durationMs != null) return props.block.durationMs;
  if (running.value && props.block.startedAt) return now.value - props.block.startedAt;
  return null;
});
const elapsedLabel = computed(() => {
  const ms = elapsedMs.value;
  if (ms == null) return "";
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
});
const exitLabel = computed(() => {
  if (props.block.cancelled) return "已取消";
  if (props.block.exitCode == null) return "";
  return `退出码 ${props.block.exitCode}`;
});
const promptMark = computed(() => (props.block.excludeFromContext ? "!!" : "!"));

const aborting = ref(false);
async function abort(): Promise<void> {
  if (aborting.value) return;
  aborting.value = true;
  try {
    await workbench.abortBash();
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    aborting.value = false;
  }
}

async function copyOutput(): Promise<void> {
  const text = props.block.output ?? "";
  if (!text) return;
  try {
    await navigator.clipboard?.writeText(text);
    copied.value = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copied.value = false;
      copyTimer = null;
    }, 1200);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}
</script>

<template>
  <div class="bash-card" :data-status="block.status" :data-block-id="block.id">
    <div class="bash-head-row">
      <button class="step-head" :aria-expanded="open" @click="open = !open">
        <span class="step-caret" :class="{ open }">
          <span v-if="running" class="mini-spinner" />
          <svg v-else viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
          </svg>
        </span>
        <span class="step-verb">{{ verb }}</span>
        <span class="step-target" :title="block.command">$ {{ block.command }}</span>
        <span v-if="block.excludeFromContext" class="step-badge">不加入上下文</span>
        <span v-if="block.truncated" class="step-badge">已截断</span>
        <span v-if="elapsedLabel" class="step-meta">{{ elapsedLabel }}</span>
        <span v-if="block.isError" class="step-error">失败</span>
      </button>
      <button
        v-if="running"
        type="button"
        class="bash-stop"
        :disabled="aborting"
        title="停止这条命令（Esc）"
        @click="abort"
      >
        <span v-if="aborting" class="mini-spinner" />
        {{ aborting ? "停止中…" : "停止" }}
      </button>
    </div>
    <div v-if="open || running" class="tool-body">
      <div class="term">
        <div class="term-cmd">
          <span class="term-prompt">{{ promptMark }}</span><SearchHighlight :text="block.command ?? ''" :query="query" />
        </div>
        <pre v-if="block.output" class="term-out" :class="{ err: block.isError }"><SearchHighlight :text="block.output" :query="query" /></pre>
        <div v-else-if="running" class="term-wait">等待输出…</div>
        <div v-else class="term-wait">（没有输出）</div>
        <div class="bash-foot">
          <span v-if="exitLabel" class="bash-meta">{{ exitLabel }}</span>
          <span v-if="block.truncated" class="bash-meta bash-warn" :title="block.fullOutputPath">
            输出已截断<template v-if="block.fullOutputPath"> · 完整输出：{{ block.fullOutputPath }}</template>
          </span>
          <span class="bash-meta">
            {{ block.excludeFromContext ? "不加入模型上下文" : "输出会在下一次提问时加入上下文" }}
          </span>
          <button v-if="block.output" type="button" class="bash-copy" @click="copyOutput">
            {{ copied ? "已复制" : "复制输出" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
