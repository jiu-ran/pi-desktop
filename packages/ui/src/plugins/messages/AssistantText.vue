<script setup>
import { computed } from "vue";
import MarkdownRender from "markstream-vue";
import "markstream-vue/index.css";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";

const props = defineProps({ block: { type: Object, required: true } });
const { workbench, contributions } = useKernel();

const theme = computed(() => contributions.points.themes.find((item) => item.id === workbench.state.theme));
const isDark = computed(() => (theme.value?.scheme ?? "dark") === "dark");
const codeTheme = computed(() => ({
  light: theme.value?.codeTheme?.light ?? "github-light",
  dark: theme.value?.codeTheme?.dark ?? "github-dark-default",
}));

async function copy() {
  await navigator.clipboard?.writeText(props.block.text);
}
</script>

<template>
  <div class="msg assistant">
    <MarkdownRender
      class="md"
      mode="chat"
      :content="block.text"
      :final="!block.streaming"
      :is-dark="isDark"
      :code-block-props="{ theme: codeTheme }"
    />
    <div v-if="!block.streaming" class="msg-tools">
      <button class="icon-btn small" title="复制" @click="copy" v-html="icons.copy" />
    </div>
  </div>
</template>
