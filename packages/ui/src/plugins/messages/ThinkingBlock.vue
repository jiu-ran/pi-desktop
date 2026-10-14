<script setup lang="ts">
import { computed, ref } from "vue";
import MarkdownRender from "markstream-vue";
import { useKernel } from "../../kernel/use-kernel.ts";

/** 思考块：折叠时显示一行纯文本预览，展开后按 Markdown 渲染（模型的思考常带 **标题** 与列表） */
const props = defineProps({ block: { type: Object, required: true } });
const { workbench, contributions } = useKernel();
const open = ref(false);

const preview = computed(() => {
  const text = props.block.text.replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
});

const theme = computed(() => contributions.points.themes.find((item) => item.id === workbench.state.theme));
const isDark = computed(() => (theme.value?.scheme ?? "dark") === "dark");
</script>

<template>
  <div class="thinking" :class="{ open, live: block.streaming }">
    <button class="step-head" @click="open = !open">
      <span class="step-caret" :class="{ open }">
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></svg>
      </span>
      <span class="step-verb">{{ block.streaming ? "思考中" : "已思考" }}</span>
      <span v-if="!open" class="step-target thinking-preview">{{ preview }}</span>
    </button>
    <div v-if="open" class="thinking-body">
      <MarkdownRender
        class="md md-thinking"
        mode="chat"
        :content="block.text"
        :final="!block.streaming"
        :is-dark="isDark"
      />
    </div>
  </div>
</template>
