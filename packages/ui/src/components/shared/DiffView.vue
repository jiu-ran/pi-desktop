<script setup lang="ts">
import { computed } from "vue";
import type { DiffLine } from "../../shared/diff.ts";

const props = defineProps<{ lines: DiffLine[] }>();
const visibleLines = computed(() => props.lines.filter((line) => line.type === "gap" || line.type === "meta" || line.text.length > 0));
</script>

<template>
  <div v-if="visibleLines.length" class="diff-view">
    <!-- diff-body 撑到最宽一行的宽度：横向滚动时短行的背景也能铺满，不会中途断开 -->
    <div class="diff-body">
      <div v-for="(line, i) in visibleLines" :key="i" class="diff-row" :data-type="line.type">
        <template v-if="line.type === 'meta'">
          <span class="diff-meta">{{ line.text }}</span>
        </template>
        <template v-else>
          <span class="diff-num">{{ line.num }}</span>
          <span class="diff-sign">{{ line.type === "add" ? "+" : line.type === "del" ? "−" : "" }}</span>
          <span class="diff-text">{{ line.type === "gap" ? "⋯" : line.text }}</span>
        </template>
      </div>
    </div>
  </div>
</template>
