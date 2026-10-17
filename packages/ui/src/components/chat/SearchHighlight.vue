<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ text?: string; query?: string }>();
const parts = computed(() => {
  const text = props.text ?? "";
  const query = props.query?.trim() ?? "";
  if (!query || !text.toLowerCase().includes(query.toLowerCase())) return [{ text, match: false }];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "ig")).filter(Boolean).map((part) => ({
    text: part,
    match: part.toLowerCase() === query.toLowerCase(),
  }));
});
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <mark v-if="part.match" class="search-mark">{{ part.text }}</mark>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
