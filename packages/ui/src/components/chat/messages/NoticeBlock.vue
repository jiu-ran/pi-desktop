<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { retryCountdownLabel } from "../../../shared/retry-notice.ts";
import { icons } from "../../../shared/util.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const levelIcons: Record<string, string> = { info: "i", warning: "!", error: "×" };
const open = ref(false);

// 自动重试 / 上下文压缩的状态提示参考 ThinkRail 的 RetryIndicator 与 CompactionTurn（Apache-2.0）。
const kind = computed(() => (props.block.retry ? "retry" : props.block.compaction ? "compaction" : ""));
const summary = computed(() => props.block.compaction?.summary ?? "");
const title = computed(() => props.block.retry?.error ?? props.block.compaction?.error ?? undefined);
/** 正在等下一次重试（还没成功也没彻底失败） */
const retrying = computed(() => Boolean(props.block.retry && !props.block.retry.done));
const icon = computed(() => {
  if (props.block.compaction?.running) return "◌";
  if (props.block.retry) {
    if (!props.block.retry.done) return "↻";
    return props.block.retry.success ? "✓" : "×";
  }
  return levelIcons[props.block.level ?? ""] ?? "•";
});
const foldIcon = computed(() => (open.value ? icons.chevronDown : icons.chevronRight));

/**
 * 重试倒计时。
 *
 * 只在「正在重试」时走一个 200ms 的计时器：重试之间的退避时间全交给这里算，
 * 提示正文不再写死「3.0 秒后重试」那种一动不动的数字，第二次重试也不会沿用旧值。
 */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}
watch(
  retrying,
  (active) => {
    if (!active) {
      stopTicker();
      return;
    }
    now.value = Date.now();
    if (!ticker) ticker = setInterval(() => { now.value = Date.now(); }, 200);
  },
  { immediate: true },
);
onBeforeUnmount(stopTicker);
const countdown = computed(() => {
  const retry = props.block.retry;
  if (!retry || retry.done) return "";
  return retryCountdownLabel(retry.deadlineAt, now.value);
});
</script>

<template>
  <div class="notice" :data-level="block.level" :data-kind="kind || undefined" :title="title">
    <span class="notice-icon" :class="{ 'notice-spin': block.compaction?.running || retrying }">{{ icon }}</span>
    <div class="notice-main">
      <button
        v-if="summary"
        type="button"
        class="notice-fold"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="notice-fold-caret" v-html="foldIcon" />
        <SearchHighlight :text="block.text ?? ''" :query="query" />
      </button>
      <span v-else class="notice-text"><SearchHighlight :text="block.text ?? ''" :query="query" /></span>
      <span v-if="countdown" class="notice-countdown" role="timer">{{ countdown }}</span>
      <!-- 重试期间不再重复显示同一句错误（hover 里能看到的 title 已经带着），
           一条提示只占一行，省掉以前那半屏的重复内容 -->
      <span v-if="(block.count ?? 1) > 1" class="notice-count">×{{ block.count }}</span>
      <!-- 每次重试换一个 key：换条后进度条要重新从头走，否则上一轮已经走空就一直停着 -->
      <div
        v-if="retrying && block.retry"
        :key="block.retry.attempt"
        class="notice-retry-bar"
        :style="{ '--retry-ms': `${block.retry.delayMs}ms` }"
      >
        <i />
      </div>
      <div v-if="summary && open" class="notice-compaction">
        <MarkdownBody mode="docs" :content="summary" />
      </div>
    </div>
  </div>
</template>
