<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { livePreview } from "./live-preview.ts";

/**
 * .md 的 Typora / Obsidian 式实时预览：文档就是编辑器本身。
 * 光标不在的行只显示排版结果（标题大小、加粗、行内代码、表格、代码块……），
 * 光标进到哪一行，哪一行的 `#`、`**`、反引号才露出来。
 */
const props = defineProps<{ content: string }>();
const emit = defineEmits<{ "update:content": [value: string] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
let applyingOutside = false;

onMounted(() => {
  if (!host.value) return;
  const state = EditorState.create({
    doc: props.content,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, addKeymap: false }),
      livePreview(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingOutside) return;
        emit("update:content", update.state.doc.toString());
      }),
    ],
  });
  view = new EditorView({ state, parent: host.value });
  // 调试/检查用：拿到视图就能查选区与语法树
  (window as unknown as Record<string, unknown>).__piMarkdownView = view;
});

watch(
  () => props.content,
  (next) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === next) return;
    // 外部换了一篇内容（切文件 / 重新加载）：整篇替换，别把光标的历史搞乱
    applyingOutside = true;
    try {
      view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    } finally {
      applyingOutside = false;
    }
  },
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

defineExpose({
  focus: () => view?.focus(),
  getView: () => view,
});
</script>

<template>
  <div ref="host" class="md-live" data-md-live="1"></div>
</template>

<style scoped>
.md-live {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}
</style>
