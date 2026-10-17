<script setup lang="ts">
import type { TranscriptBlock } from "../../kernel/transcript.ts";
import UserMessage from "./messages/UserMessage.vue";
import AssistantText from "./messages/AssistantText.vue";
import ThinkingBlock from "./messages/ThinkingBlock.vue";
import NoticeBlock from "./messages/NoticeBlock.vue";
import BashTool from "./tools/BashTool.vue";
import DiffTool from "./tools/DiffTool.vue";
import ReadTool from "./tools/ReadTool.vue";
import GenericTool from "./tools/GenericTool.vue";

/**
 * 2 区域消息与工具块渲染分发器（直接调用标准内置组件，不再绕道贡献点）。
 */
defineProps<{
  block: TranscriptBlock;
  query?: string;
  copyText?: string;
}>();
</script>

<template>
  <UserMessage v-if="block.kind === 'user'" :block="block" :query="query" />
  <AssistantText v-else-if="block.kind === 'text'" :block="block" :query="query" :copy-text="copyText" />
  <ThinkingBlock v-else-if="block.kind === 'thinking'" :block="block" :query="query" />
  <NoticeBlock v-else-if="block.kind === 'notice'" :block="block" :query="query" />
  <template v-else-if="block.kind === 'tool'">
    <BashTool v-if="block.name === 'bash'" :block="block" :query="query" />
    <DiffTool v-else-if="block.name === 'edit' || block.name === 'write'" :block="block" :query="query" />
    <ReadTool v-else-if="block.name === 'read'" :block="block" :query="query" />
    <GenericTool v-else :block="block" :query="query" />
  </template>
  <div v-else class="block-fallback" :data-kind="block.kind">
    <span class="fallback-tag">{{ block.kind }}</span>
    <pre>{{ block.text ?? block.output ?? JSON.stringify(block.args ?? {}, null, 2) }}</pre>
  </div>
</template>
