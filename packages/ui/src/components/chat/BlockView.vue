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
import { computed, inject } from "vue";
import { KERNEL_KEY } from "../../kernel/index.ts";

/**
 * 2 区域消息与工具块渲染分发器。
 *
 * Pi 自带工具（read / bash / edit / write）在核心里直接渲染；
 * 非 Pi 自带的工具卡片（例如子代理）由插件通过 registerToolRenderer 注册，
 * 这里只查注册表 —— 停用插件后自动回退到通用工具卡片。
 */
const kernel = inject(KERNEL_KEY, null);
const toolRenderers = computed(() => kernel?.plugins.toolRenderers ?? []);

function pluginRendererFor(name: string) {
  return toolRenderers.value.find((item) => item.tools.includes(name))?.component;
}

defineProps<{
  block: TranscriptBlock;
  query?: string;
  copyText?: string;
  /** 后面还有内容时，长用户消息默认折叠 */
  collapseLong?: boolean;
  /** 还在排队、没有真正发给模型 */
  queued?: boolean;
}>();
</script>

<template>
  <UserMessage
    v-if="block.kind === 'user'"
    :block="block"
    :query="query"
    :collapse-long="collapseLong"
    :queued="queued"
  />
  <AssistantText v-else-if="block.kind === 'text'" :block="block" :query="query" :copy-text="copyText" />
  <ThinkingBlock v-else-if="block.kind === 'thinking'" :block="block" :query="query" />
  <NoticeBlock v-else-if="block.kind === 'notice'" :block="block" :query="query" />
  <template v-else-if="block.kind === 'tool'">
    <BashTool v-if="block.name === 'bash'" :block="block" :query="query" />
    <DiffTool v-else-if="block.name === 'edit' || block.name === 'write'" :block="block" :query="query" />
    <ReadTool v-else-if="block.name === 'read'" :block="block" :query="query" />
    <component
      :is="pluginRendererFor(block.name ?? '')"
      v-else-if="pluginRendererFor(block.name ?? '')"
      :block="block"
      :query="query"
    />
    <GenericTool v-else :block="block" :query="query" />
  </template>
  <div v-else class="block-fallback" :data-kind="block.kind">
    <span class="fallback-tag">{{ block.kind }}</span>
    <pre>{{ block.text ?? block.output ?? JSON.stringify(block.args ?? {}, null, 2) }}</pre>
  </div>
</template>
