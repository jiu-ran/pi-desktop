<script setup lang="ts">
import { extState } from "../../services/extension-ui.ts";
</script>

<template>
  <div class="toasts">
    <div v-for="t in extState.toasts" :key="t.id" class="toast" :class="t.level">
      {{ t.text }}
    </div>
  </div>
</template>
