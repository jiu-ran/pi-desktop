<script setup lang="ts">
import { computed } from "vue";
import type { DiffLine } from "../../shared/diff.ts";

const props = defineProps<{ lines: DiffLine[] }>();
const visibleLines = computed(() => props.lines.filter((line) => line.type === "gap" || line.text.length > 0));
</script>

<template>
  <div v-if="visibleLines.length" class="diff-view">
    <div v-for="(line, i) in visibleLines" :key="i" class="diff-row" :data-type="line.type">
      <span class="diff-num">{{ line.num }}</span>
      <span class="diff-sign">{{ line.type === "add" ? "+" : line.type === "del" ? "−" : "" }}</span>
      <span class="diff-text">{{ line.type === "gap" ? "⋯" : line.text }}</span>
    </div>
  </div>
</template>
