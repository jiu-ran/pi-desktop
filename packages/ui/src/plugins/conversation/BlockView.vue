<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";

/**
 * 块分发器：按 messageRenderers / toolRenderers 贡献点解析渲染组件。
 * 没有插件认领的块用纯文本兜底，保证停用插件不会让内容消失。
 */
const props = defineProps({ block: { type: Object, required: true } });
const { contributions } = useKernel();

const renderer = computed(() => {
  if (props.block.kind === "tool") return contributions.resolve("toolRenderers", props.block.name);
  return contributions.resolve("messageRenderers", props.block);
});
</script>

<template>
  <component :is="renderer.component" v-if="renderer" :block="block" />
  <div v-else class="block-fallback" :data-kind="block.kind">
    <span class="fallback-tag">{{ block.kind === "tool" ? block.name : block.kind }}</span>
    <pre>{{ block.text ?? block.output ?? JSON.stringify(block.args ?? {}, null, 2) }}</pre>
  </div>
</template>
