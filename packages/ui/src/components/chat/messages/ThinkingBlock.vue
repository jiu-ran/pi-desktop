<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

/**
 * 时间线里展开的步骤：上面那行已经写过「思考 + 摘要」，
 * 这里直接摊开正文，不再多一个「已思考」的可点标题。
 */
const headless = inject<{ value: boolean } | null>("piBlockHeadless", null);
const bare = computed(() => Boolean(headless?.value));
const open = ref(false);

watch(() => props.query, (query) => {
  const text = props.block.text ?? "";
  if (query?.trim() && text.toLowerCase().includes(query.trim().toLowerCase())) open.value = true;
});

const preview = computed(() => {
  const text = (props.block.text ?? "").replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
});
</script>

<template>
  <div class="thinking" :class="{ open, live: block.streaming, 'is-bare': bare }">
    <button v-if="!bare" class="step-head" @click="open = !open">
      <span class="step-caret" :class="{ open }">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
        </svg>
      </span>
      <span class="step-verb">{{ block.streaming ? "思考中" : "已思考" }}</span>
      <span v-if="!open" class="step-target thinking-preview"><SearchHighlight :text="preview" :query="query" /></span>
    </button>
    <div v-if="open || bare" class="thinking-body">
      <MarkdownBody
        class-name="md-thinking"
        mode="chat"
        :content="block.text ?? ''"
        :streaming="block.streaming"
        :query="query"
      />
    </div>
  </div>
</template>
