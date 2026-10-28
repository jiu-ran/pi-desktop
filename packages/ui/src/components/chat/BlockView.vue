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
import { computed, inject, provide, toRef } from "vue";
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

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
  copyText?: string;
  /** 后面还有内容时，长用户消息默认折叠 */
  collapseLong?: boolean;
  /** 还在排队、没有真正发给模型 */
  queued?: boolean;
  /** 在时间线步骤里渲染：工具卡片不再画自己的头部（上面那行已经写过） */
  headless?: boolean;
}>();

// 搜索只覆盖正文（用户消息 + 助手回复）：思考、工具与提示块既不计数，也不高亮，
// 否则会出现「页面上标黄了但计数里没有」的错位。
const bodyQuery = computed(() => (props.block.kind === "user" || props.block.kind === "text" ? props.query : ""));

// 时间线里展开的步骤：卡片与思考块都别再画自己的头部（上面那行已经写过）
provide("piBlockHeadless", toRef(props, "headless"));
</script>

<template>
  <UserMessage
    v-if="block.kind === 'user'"
    :block="block"
    :query="bodyQuery"
    :collapse-long="collapseLong"
    :queued="queued"
  />
  <AssistantText v-else-if="block.kind === 'text'" :block="block" :query="bodyQuery" :copy-text="copyText" />
  <ThinkingBlock v-else-if="block.kind === 'thinking'" :block="block" />
  <NoticeBlock v-else-if="block.kind === 'notice'" :block="block" />
  <template v-else-if="block.kind === 'tool'">
    <BashTool v-if="block.name === 'bash'" :block="block" />
    <DiffTool v-else-if="block.name === 'edit' || block.name === 'write'" :block="block" />
    <ReadTool v-else-if="block.name === 'read'" :block="block" />
    <component
      :is="pluginRendererFor(block.name ?? '')"
      v-else-if="pluginRendererFor(block.name ?? '')"
      :block="block"
    />
    <GenericTool v-else :block="block" />
  </template>
  <div v-else class="block-fallback" :data-kind="block.kind">
    <span class="fallback-tag">{{ block.kind }}</span>
    <pre>{{ block.text ?? block.output ?? JSON.stringify(block.args ?? {}, null, 2) }}</pre>
  </div>
</template>
