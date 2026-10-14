<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { extState } from "./state.js";

const { workbench } = useKernel();
const entries = computed(() => Object.entries(extState.statuses[workbench.state.activeCwd] ?? {}));
</script>

<template>
  <span v-for="[key, text] in entries" :key="key" class="status-item" :title="key">◆ {{ text }}</span>
</template>
