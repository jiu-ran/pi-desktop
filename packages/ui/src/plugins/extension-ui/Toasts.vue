<script setup lang="ts">
import { extState } from "./state.ts";
</script>

<template>
  <div class="toasts">
    <div v-for="toast in extState.toasts" :key="toast.id" class="toast" :data-level="toast.level">
      {{ toast.text }}
    </div>
  </div>
</template>
