<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { dirOf, isRemoteSource, workspaceRelative } from "../../shared/relative-path.ts";
import { useKernel } from "../../kernel/use-kernel.ts";
import { livePreview, refreshLivePreview } from "./live-preview.ts";

/**
 * .md 的 Typora / Obsidian 式实时预览：文档就是编辑器本身。
 * 光标不在的行只显示排版结果（标题大小、加粗、行内代码、图片、表格、代码块……），
 * 光标进到哪一行，哪一行的 `#`、`**`、反引号才露出来。
 */
const props = defineProps<{
  content: string;
  /** 文件在哪个工作区（图片/链接按工作区相对路径解析） */
  cwd?: string;
  /** 文件相对工作区的路径（图片按它的目录解析） */
  relative?: string;
}>();
const emit = defineEmits<{ "update:content": [value: string] }>();

const { workbench, theme, bus } = useKernel();
const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
let applyingOutside = false;

const baseDir = computed(() => dirOf(props.relative ?? ""));
const workspace = computed(() => props.cwd || workbench.state.activeCwd || "");

/** markdown 里的图片地址 → 可直接放进 img 的地址（远程原样返回，本地读成 data URL） */
async function resolveImage(src: string): Promise<string | null> {
  if (isRemoteSource(src)) return src;
  const relative = workspaceRelative(workspace.value, baseDir.value, src);
  if (!relative) return null;
  try {
    const data = await workbench.readWorkspaceFile(relative);
    return data.preview?.dataUrl ?? null;
  } catch {
    return null;
  }
}

/** Ctrl / Cmd + 点击：外部链接交给系统浏览器，工作区文件用编辑器打开 */
function openLink(href: string): void {
  const value = href.trim();
  if (/^(?:https?:|mailto:)/i.test(value)) {
    const api = (window as unknown as { __piDesktop?: { openExternalUrl?: (url: string) => Promise<boolean> } }).__piDesktop;
    void api?.openExternalUrl?.(value);
    return;
  }
  const relative = workspaceRelative(workspace.value, baseDir.value, value.split("#")[0] ?? value);
  if (!relative) return;
  bus.emit("file:open", `${workspace.value.replace(/[\\/]+$/, "")}/${relative}`);
}

onMounted(() => {
  if (!host.value) return;
  const state = EditorState.create({
    doc: props.content,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, addKeymap: false }),
      livePreview({
        resolveImage,
        openLink,
        isDark: () => theme.currentTheme().scheme === "dark",
      }),
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

// 深浅色切换后重建装饰：代码块高亮的配色跟着变
watch(
  () => theme.currentTheme().scheme,
  () => {
    view?.dispatch({ effects: refreshLivePreview.of(null) });
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
