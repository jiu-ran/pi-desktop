<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import MarkdownBody from "./MarkdownBody.vue";
import { replaceMarkdownBlock, rendersBlock, splitMarkdownBlocks, type MarkdownBlock } from "../../shared/markdown-blocks.ts";

/**
 * Typora 式混合预览：默认就是渲染后的样子，点某一处时**只把那一块**换成可编辑的
 * 源码（其它块保持渲染结果），改完（失焦 / Ctrl+Enter）写回整篇。
 *
 * 对齐方式：markstream 每个顶层节点渲染成一个 `.node-slot`，顺序与
 * `splitMarkdownBlocks` 一致；数量对不上（罕见的扩展语法）就退化成纯预览，
 * 不冒险让用户点到错位的块。
 */
const props = defineProps<{ content: string }>();
const emit = defineEmits<{ "update:content": [value: string] }>();

const root = ref<HTMLElement | null>(null);
// 链接引用定义（`[标签]: url`）渲染结果是空的，不占节点，对齐时跳过
const blocks = computed<MarkdownBlock[]>(() => splitMarkdownBlocks(props.content).filter(rendersBlock));
const slotCount = ref(0);
const aligned = computed(() => slotCount.value > 0 && slotCount.value === blocks.value.length);

const editing = ref<{ index: number; draft: string; top: number; left: number; width: number; height: number } | null>(null);
const editor = ref<HTMLTextAreaElement | null>(null);
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** 给渲染结果的顶层节点打上块序号（对不上就全部清掉，保持不可编辑） */
function syncSlots(): void {
  const host = root.value?.querySelector(".md");
  if (!host) {
    slotCount.value = 0;
    return;
  }
  const slots = Array.from(host.children).filter((node) => node.classList.contains("node-slot")) as HTMLElement[];
  const ok = slots.length > 0 && slots.length === blocks.value.length;
  slotCount.value = ok ? slots.length : 0;
  slots.forEach((slot, index) => {
    if (ok) slot.dataset.mdBlock = String(index);
    else delete slot.dataset.mdBlock;
  });
}

function scheduleSync(): void {
  if (retryTimer) clearTimeout(retryTimer);
  // markstream 渲染是异步的（代码高亮 / mermaid 会晚一点），多对几次
  void nextTick(syncSlots);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    syncSlots();
  }, 120);
}

watch(() => props.content, () => {
  if (editing.value) closeEditor();
  scheduleSync();
});
watch(blocks, scheduleSync, { immediate: true });

function slotOf(index: number): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-md-block="${index}"]`) ?? null;
}

function startEdit(index: number): void {
  const block = blocks.value[index];
  const slot = slotOf(index);
  const container = root.value;
  if (!block || !slot || !container) return;
  const rect = slot.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  // 容器本身就是滚动区：绝对定位坐标要加上已滚动的距离，否则滚过一段后编辑框会跑偏
  editing.value = {
    index,
    draft: block.text,
    top: rect.top - base.top + container.scrollTop,
    left: rect.left - base.left + container.scrollLeft,
    width: rect.width,
    height: Math.max(rect.height, 24),
  };
  slot.style.visibility = "hidden";
  void nextTick(() => {
    const node = editor.value;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    resizeEditor();
  });
}

function resizeEditor(): void {
  const node = editor.value;
  if (!node || !editing.value) return;
  node.style.height = "auto";
  const next = Math.min(node.scrollHeight + 2, 520);
  node.style.height = `${next}px`;
  editing.value.height = next;
}

function closeEditor(): void {
  const current = editing.value;
  editing.value = null;
  if (!current) return;
  const slot = slotOf(current.index);
  if (slot) slot.style.visibility = "";
}

function commit(): void {
  const current = editing.value;
  if (!current) return;
  const block = blocks.value[current.index];
  const next = current.draft.replace(/\r\n/g, "\n");
  closeEditor();
  if (!block || next === block.text) return;
  emit("update:content", replaceMarkdownBlock(props.content, block, next));
}

function cancel(): void {
  closeEditor();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    return;
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    commit();
  }
}

function onRootClick(event: MouseEvent): void {
  if (editing.value) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const slot = target.closest<HTMLElement>("[data-md-block]");
  if (!slot) return;
  const index = Number(slot.dataset.mdBlock);
  if (!Number.isInteger(index)) return;
  // 让链接、按钮保持原有行为（点击链接不该进入编辑）
  if (target.closest("a, button, input, summary, .code-block-wrapper")) return;
  startEdit(index);
}

onBeforeUnmount(() => {
  if (retryTimer) clearTimeout(retryTimer);
});
</script>

<template>
  <div
    ref="root"
    class="md-preview md-editable"
    :class="{ 'can-edit': aligned }"
    :data-aligned="aligned ? '1' : '0'"
    @click="onRootClick"
  >
    <MarkdownBody :content="content" mode="docs" />
    <textarea
      v-if="editing"
      ref="editor"
      v-model="editing.draft"
      class="md-block-editor"
      spellcheck="false"
      :style="{ top: `${editing.top}px`, left: `${editing.left}px`, width: `${editing.width}px`, height: `${editing.height}px` }"
      @input="resizeEditor"
      @blur="commit"
      @keydown="onKeydown"
    />
  </div>
</template>

<style scoped>
/* 排版与滚动沿用 .md-preview（内边距、max-width 860、正文 14.5px/1.78），
   这里只补「可作为定位参照的滚动容器」这一点 */
.md-editable {
  position: relative;
  overflow-anchor: none;
}
.md-editable.can-edit [data-md-block] {
  border-radius: var(--radius-sm);
  cursor: text;
  transition: background 0.12s;
}
.md-editable.can-edit [data-md-block]:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  box-shadow: -2px 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
}
/* 就地编辑框：和源码同款字体，宽度贴合原来那一块 */
.md-block-editor {
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--input-bg);
  color: var(--fg);
  font: var(--code-font-size, 12.5px)/1.65 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: hidden;
  resize: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
</style>
