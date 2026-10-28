<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";

const props = withDefaults(
  defineProps<{
    block: TranscriptBlock;
    verb?: string;
    title?: string;
    subtitle?: string;
    meta?: string;
    badge?: string;
    added?: number | null;
    removed?: number | null;
    defaultOpen?: boolean;
  }>(),
  {
    verb: "",
    title: "",
    subtitle: "",
    meta: "",
    badge: "",
    added: null,
    removed: null,
    defaultOpen: false,
  },
);

/**
 * 时间线里展开的步骤：上面那行已经把「运行 cat > …」写过了，
 * 卡片再画一遍头部就是重复。由 BlockView 注入，头部直接不画、正文始终展开。
 */
const headless = inject<{ value: boolean } | null>("piBlockHeadless", null);
const bare = computed(() => Boolean(headless?.value));
const open = ref(Boolean(props.defaultOpen || props.block.isError));
watch(
  () => props.block.isError,
  (value) => {
    if (value) open.value = true;
  },
);
const running = computed(() => props.block.status === "running" || props.block.status === "pending");
const duration = computed(() => {
  const ms = props.block.durationMs;
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
});
</script>

<template>
  <div class="tool-card" :data-status="block.status" :data-block-id="block.id" :class="{ open, 'is-bare': bare }">
    <button v-if="!bare" class="step-head" @click="open = !open">
      <span class="step-caret" :class="{ open }">
        <span v-if="running" class="mini-spinner" />
        <svg v-else viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
        </svg>
      </span>
      <span class="step-verb">{{ verb || title || block.name }}</span>
      <span class="step-target" :title="subtitle">{{ subtitle }}</span>
      <span v-if="badge" class="step-badge">{{ badge }}</span>
      <span v-if="added != null" class="stat-add">+{{ added }}</span>
      <span v-if="removed != null" class="stat-del">−{{ removed }}</span>
      <span v-if="meta" class="step-meta">{{ meta }}</span>
      <span v-if="duration" class="step-meta">{{ duration }}</span>
      <span v-if="block.isError" class="step-error">失败</span>
    </button>
    <div v-if="open || bare" class="tool-body">
      <slot />
    </div>
  </div>
</template>
