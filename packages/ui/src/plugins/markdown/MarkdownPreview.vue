<script setup lang="ts">
import { computed } from "vue";
import type { FileStageData } from "../files/state.ts";
import MarkdownBody from "./MarkdownBody.vue";

const props = defineProps<{
  file: FileStageData;
}>();

const content = computed(() => props.file.draft ?? props.file.content ?? "");
</script>

<template>
  <div class="md-preview">
    <MarkdownBody :content="content" mode="docs" />
  </div>
</template>
