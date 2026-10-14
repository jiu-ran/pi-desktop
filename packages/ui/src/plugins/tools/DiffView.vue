<script setup>
defineProps({ lines: { type: Array, required: true } });
</script>

<template>
  <div class="diff-view">
    <div v-for="(line, i) in lines" :key="i" class="diff-row" :data-type="line.type">
      <span class="diff-num">{{ line.num }}</span>
      <span class="diff-sign">{{ line.type === "add" ? "+" : line.type === "del" ? "−" : "" }}</span>
      <span class="diff-text">{{ line.type === "gap" ? "⋯" : line.text }}</span>
    </div>
  </div>
</template>
