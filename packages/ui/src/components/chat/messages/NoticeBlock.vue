<script setup lang="ts">
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import SearchHighlight from "../SearchHighlight.vue";

defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const levelIcons: Record<string, string> = { info: "i", warning: "!", error: "×" };
</script>

<template>
  <div class="notice" :data-level="block.level">
    <span class="notice-icon">{{ (block.level && levelIcons[block.level]) ?? "•" }}</span>
    <span><SearchHighlight :text="block.text" :query="query" /></span>
  </div>
</template>
