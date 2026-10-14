<script setup>
import { computed } from "vue";
import ToolCard from "./ToolCard.vue";

const props = defineProps({ block: { type: Object, required: true } });
const command = computed(() => props.block.args?.command ?? "");
const oneLine = computed(() => command.value.replace(/\s+/g, " ").trim());
const running = computed(() => props.block.status === "running" || props.block.status === "pending");
</script>

<template>
  <ToolCard :block="block" :verb="running ? '正在运行' : '运行'" :subtitle="oneLine">
    <div class="term">
      <div class="term-cmd"><span class="term-prompt">$</span>{{ command }}</div>
      <pre v-if="block.output" class="term-out" :class="{ err: block.isError }">{{ block.output }}</pre>
      <div v-else-if="running" class="term-wait">等待输出…</div>
    </div>
  </ToolCard>
</template>
