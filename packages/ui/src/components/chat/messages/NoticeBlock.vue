<script setup lang="ts">
import type { TranscriptBlock } from "../../../kernel/transcript.ts";

defineProps<{
  block: TranscriptBlock;
}>();

const levelIcons: Record<string, string> = { info: "i", warning: "!", error: "×" };
</script>

<template>
  <div class="notice" :data-level="block.level">
    <span class="notice-icon">{{ (block.level && levelIcons[block.level]) ?? "•" }}</span>
    <span>{{ block.text }}</span>
  </div>
</template>
