<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { highlightMarkdown, type HighlightToken } from "./markdown-highlight.ts";

const model = defineModel<string>({ required: true });
const emit = defineEmits<{
  blur: [];
  keydown: [event: KeyboardEvent];
  scroll: [];
}>();

const { workbench } = useKernel();
const input = ref<HTMLTextAreaElement | null>(null);
const overlay = ref<HTMLElement | null>(null);
const lines = ref<HighlightToken[][]>([[{ content: "" }]]);
let requestId = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const renderedLines = computed(() => lines.value.length ? lines.value : [[{ content: "" }]]);

async function render(): Promise<void> {
  const current = ++requestId;
  const value = model.value;
  try {
    const tokens = await highlightMarkdown(value, workbench.state.theme !== "light");
    if (current === requestId) lines.value = tokens.length ? tokens : [[{ content: "" }]];
  } catch {
    if (current === requestId) lines.value = value.split(/\r?\n/).map((line) => [{ content: line || "" }]);
  }
}

function scheduleRender(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void render();
  }, 40);
}

function onInput(event: Event): void {
  model.value = (event.target as HTMLTextAreaElement).value;
}

function onKeydown(event: KeyboardEvent): void {
  emit("keydown", event);
}

function syncScroll(): void {
  if (overlay.value && input.value) { overlay.value.scrollTop = input.value.scrollTop; overlay.value.scrollLeft = input.value.scrollLeft; }
  emit("scroll");
}

watch(() => [model.value, workbench.state.theme], scheduleRender, { immediate: true });
onBeforeUnmount(() => {
  requestId += 1;
  if (timer !== null) clearTimeout(timer);
});

defineExpose({ input });
</script>

<template>
  <div class="markdown-highlight-editor">
    <pre ref="overlay" aria-hidden="true"><code><span v-for="(line, index) in renderedLines" :key="index" class="markdown-highlight-line"><span v-for="(token, tokenIndex) in line" :key="tokenIndex" :style="{ color: token.color }">{{ token.content }}</span><br /></span></code></pre>
    <textarea
      ref="input"
      :value="model"
      class="markdown-highlight-input"
      spellcheck="false"
      aria-label="Markdown 源码"
      @input="onInput"
      @blur="emit('blur')"
      @keydown="onKeydown"
      @scroll="syncScroll"
    />
  </div>
</template>

<style scoped>
.markdown-highlight-editor {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--input-bg);
}
.markdown-highlight-editor pre,
.markdown-highlight-input {
  margin: 0;
  padding: 10px 16px 20px 12px;
  font: var(--code-font-size, 12.5px)/1.7 var(--mono);
  letter-spacing: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  tab-size: 2;
}
.markdown-highlight-editor pre {
  height: 100%;
  overflow: hidden;
  color: var(--fg);
  pointer-events: none;
}
.markdown-highlight-line {
  display: inline;
}
.markdown-highlight-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 源码是自动换行的，不需要横向滚动条（分栏时那条蓝杠很扎眼） */
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: var(--fg);
}
.markdown-highlight-input::selection {
  background: var(--accent-soft);
}
</style>
