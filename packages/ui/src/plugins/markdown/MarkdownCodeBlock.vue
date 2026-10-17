<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { highlightCode, normalizeLanguage, type HighlightToken } from "./markdown-highlight.ts";

const props = defineProps<{
  node: { code?: string; language?: string; loading?: boolean };
  isDark?: boolean;
}>();

const copied = ref(false);
const lines = ref<HighlightToken[][]>([[{ content: "" }]]);
let requestId = 0;

const code = computed(() => props.node?.code ?? "");
const language = computed(() => normalizeLanguage(props.node?.language));
const label = computed(() => props.node?.language?.trim() || "text");
const rendered = computed(() => lines.value.length ? lines.value : [[{ content: "" }]]);

async function render(): Promise<void> {
  const current = ++requestId;
  try {
    const tokens = await highlightCode(code.value, language.value, props.isDark !== false);
    if (current === requestId) lines.value = tokens.length ? tokens : [[{ content: "" }]];
  } catch {
    if (current === requestId) lines.value = code.value.split(/\r?\n/).map((line) => [{ content: line || "" }]);
  }
}

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(code.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1200);
}

watch(() => [code.value, language.value, props.isDark], () => void render(), { immediate: true });
</script>

<template>
  <section class="chat-code-block" :data-theme="isDark === false ? 'light' : 'dark'">
    <header>
      <strong>{{ label }}</strong>
      <button type="button" @click="copy">{{ copied ? "已复制" : "复制" }}</button>
    </header>
    <div class="chat-code-scroll">
      <div class="chat-code-numbers" aria-hidden="true"><span v-for="(_, index) in rendered" :key="index">{{ index + 1 }}</span></div>
      <pre><code><span v-for="(line, index) in rendered" :key="index"><span v-for="(token, tokenIndex) in line" :key="tokenIndex" :style="{ color: token.color }">{{ token.content }}</span>
</span></code></pre>
    </div>
  </section>
</template>

<style scoped>
.chat-code-block {
  overflow: hidden;
  margin: 10px 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--input-bg);
}
.chat-code-block header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-1);
}
.chat-code-block strong {
  color: var(--fg-2);
  font-size: 12px;
  font-weight: 600;
}
.chat-code-block button {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-2);
  font-size: 12px;
}
.chat-code-block button:hover { background: var(--hover); color: var(--fg); }
.chat-code-scroll {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  max-height: 520px;
  overflow: auto;
}
.chat-code-numbers {
  padding: 10px 8px 12px 0;
  border-right: 1px solid var(--line);
  color: var(--fg-3);
  font: 12.5px/1.65 var(--mono);
  text-align: right;
  user-select: none;
}
.chat-code-numbers span {
  display: block;
  min-width: 2.5em;
  padding-left: 12px;
}
.chat-code-block pre {
  margin: 0;
  padding: 10px 14px 12px;
  color: var(--fg);
  font: 12.5px/1.65 var(--mono);
  white-space: pre;
}
</style>
