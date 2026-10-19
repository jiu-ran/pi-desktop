<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

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
  <div class="thinking" :class="{ open, live: block.streaming }">
    <button class="step-head" @click="open = !open">
      <span class="step-caret" :class="{ open }">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
        </svg>
      </span>
      <span class="step-verb">{{ block.streaming ? "思考中" : "已思考" }}</span>
      <span v-if="!open" class="step-target thinking-preview"><SearchHighlight :text="preview" :query="query" /></span>
    </button>
    <div v-if="open" class="thinking-body">
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
