<script setup lang="ts">
import { computed, ref } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
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
const icon = computed(() => {
  if (props.block.compaction?.running) return "◌";
  if (props.block.retry) {
    if (!props.block.retry.done) return "↻";
    return props.block.retry.success ? "✓" : "×";
  }
  return levelIcons[props.block.level ?? ""] ?? "•";
});
const foldIcon = computed(() => (open.value ? icons.chevronDown : icons.chevronRight));
</script>

<template>
  <div class="notice" :data-level="block.level" :data-kind="kind || undefined" :title="title">
    <span class="notice-icon" :class="{ 'notice-spin': block.compaction?.running }">{{ icon }}</span>
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
      <!-- 重试期间不再重复显示同一句错误（hover 里能看到的 title 已经带着），
           一条提示只占一行，省掉以前那半屏的重复内容 -->
      <span v-if="(block.count ?? 1) > 1" class="notice-count">×{{ block.count }}</span>
      <div
        v-if="block.retry && !block.retry.done"
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
