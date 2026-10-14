<script setup>
defineProps({ block: { type: Object, required: true } });
const icons = { info: "i", warning: "!", error: "×" };
</script>

<template>
  <div class="notice" :data-level="block.level">
    <span class="notice-icon">{{ icons[block.level] ?? "•" }}</span>
    <span>{{ block.text }}</span>
  </div>
</template>
