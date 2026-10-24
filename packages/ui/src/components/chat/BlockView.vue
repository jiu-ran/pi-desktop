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
import SubagentTool from "../../plugins/subagent/SubagentTool.vue";
import { computed, inject } from "vue";
import { KERNEL_KEY } from "../../kernel/index.ts";

/**
 * 2 区域消息与工具块渲染分发器（直接调用标准内置组件，不再绕道贡献点）。
 */
const subagentTools = new Set(["subagent", "parallel", "review", "bg_wait"]);
// 子代理渲染由插件启用状态决定；停用或未注册时退回通用工具卡片。
const kernel = inject(KERNEL_KEY, null);
const subagentEnabled = computed(() => kernel?.plugins.records.find((record) => record.id === "subagent")?.enabled ?? false);

defineProps<{
  block: TranscriptBlock;
  query?: string;
  copyText?: string;
  /** 后面还有内容时，长用户消息默认折叠 */
  collapseLong?: boolean;
}>();
</script>

<template>
  <UserMessage v-if="block.kind === 'user'" :block="block" :query="query" :collapse-long="collapseLong" />
  <AssistantText v-else-if="block.kind === 'text'" :block="block" :query="query" :copy-text="copyText" />
  <ThinkingBlock v-else-if="block.kind === 'thinking'" :block="block" :query="query" />
  <NoticeBlock v-else-if="block.kind === 'notice'" :block="block" :query="query" />
  <template v-else-if="block.kind === 'tool'">
    <BashTool v-if="block.name === 'bash'" :block="block" :query="query" />
    <DiffTool v-else-if="block.name === 'edit' || block.name === 'write'" :block="block" :query="query" />
    <ReadTool v-else-if="block.name === 'read'" :block="block" :query="query" />
    <SubagentTool v-else-if="subagentEnabled && subagentTools.has(block.name ?? '')" :block="block" :query="query" />
    <GenericTool v-else :block="block" :query="query" />
  </template>
  <div v-else class="block-fallback" :data-kind="block.kind">
    <span class="fallback-tag">{{ block.kind }}</span>
    <pre>{{ block.text ?? block.output ?? JSON.stringify(block.args ?? {}, null, 2) }}</pre>
  </div>
</template>
