<script setup lang="ts">
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import SearchHighlight from "../SearchHighlight.vue";

defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();
</script>

<template>
  <div class="msg user">
    <div class="msg-user-bubble">
      <div class="msg-user-text"><SearchHighlight :text="block.text" :query="query" /></div>
      <span v-if="block.images" class="msg-attach">{{ block.images }} 张图片</span>
    </div>
  </div>
</template>
