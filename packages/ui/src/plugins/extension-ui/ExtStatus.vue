<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { extState } from "./state.ts";

const { workbench } = useKernel();
const entries = computed(() => Object.entries(extState.statuses[workbench.state.activeCwd] ?? {}));
</script>

<template>
  <span v-for="[key, text] in entries" :key="key" class="status-item" :title="key">◆ {{ text }}</span>
</template>
