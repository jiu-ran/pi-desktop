<script setup lang="ts">
import { computed } from "vue";
import type { FileStageData } from "../files/state.ts";
import MarkdownBody from "./MarkdownBody.vue";

const props = defineProps<{
  /** 直接给内容（分栏实时预览用：内容来自去抖后的草稿） */
  content?: string;
  file?: FileStageData;
}>();

const text = computed(() => props.content ?? props.file?.draft ?? props.file?.content ?? "");
</script>

<template>
  <!-- 文件是完整文档，不能按聊天流式渲染（streaming=true 时 markstream 只画尾段） -->
  <div class="md-preview">
    <MarkdownBody :content="text" mode="docs" />
  </div>
</template>
