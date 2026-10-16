<script setup lang="ts">
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import { icons } from "../../../shared/util.ts";

const props = defineProps<{
  block: TranscriptBlock;
}>();

async function copy(): Promise<void> {
  await navigator.clipboard?.writeText(props.block.text ?? "");
}
</script>

<template>
  <div class="msg assistant">
    <MarkdownBody
      mode="chat"
      :content="block.text ?? ''"
      :streaming="block.streaming"
    />
    <div v-if="!block.streaming" class="msg-tools">
      <button class="icon-btn small" title="复制" @click="copy" v-html="icons.copy" />
    </div>
  </div>
</template>
