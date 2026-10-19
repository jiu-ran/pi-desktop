<script setup lang="ts">
import { ref } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import { icons } from "../../../shared/util.ts";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
  copyText?: string;
}>();

const copied = ref(false);
let copiedTimer = 0;

async function copy(): Promise<void> {
  await navigator.clipboard?.writeText(props.copyText ?? props.block.text ?? "");
  copied.value = true;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => { copied.value = false; }, 1500);
}
</script>

<template>
  <div class="msg assistant">
    <MarkdownBody
      mode="chat"
      :content="block.text ?? ''"
      :streaming="block.streaming"
      :query="query"
    />
    <div v-if="copyText" class="msg-tools">
      <button class="icon-btn small" :title="copied ? '已复制' : '复制'" @click="copy">
        <span v-if="copied">已复制</span>
        <span v-else v-html="icons.copy" />
      </button>
      <span v-if="block.usageText" class="msg-usage">{{ block.usageText }}</span>
    </div>
  </div>
</template>
