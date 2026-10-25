<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import MarkdownBody from "./MarkdownBody.vue";
import { replaceMarkdownBlock, rendersBlock, splitMarkdownBlocks, type MarkdownBlock } from "../../shared/markdown-blocks.ts";

/**
 * Typora / Obsidian 式的混合预览：平时就是渲染后的文档，点某一段时**只有那一段**
 * 换成源码来改，但排版、字号、位置都和渲染结果完全一致，不加边框、不加底色、
 * 也不脱离文档流——看着就像直接在文档里打字，改完失焦即写回。
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
const editingIndex = ref<number | null>(null);

let editor: HTMLTextAreaElement | null = null;
let editorHost: HTMLDivElement | null = null;
let editingBlock: MarkdownBlock | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (syncTimer) clearTimeout(syncTimer);
  // markstream 渲染是异步的（代码高亮 / mermaid 会晚一点），多对几次
  void nextTick(syncSlots);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncSlots();
  }, 120);
}

watch(() => props.content, () => {
  if (editingIndex.value !== null) closeEditor();
  scheduleSync();
});
watch(blocks, scheduleSync, { immediate: true });

function slotOf(index: number): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-md-block="${index}"]`) ?? null;
}

/**
 * 渲染结果里真正带文字排版的元素（h2 / p / pre / ul …），拿来继承字号与间距。
 * 节点外面还套着 node-content 之类的 wrapper，取第一层子元素会拿到正文样式。
 */
function contentOf(slot: HTMLElement): HTMLElement {
  const pick = slot.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6, p, blockquote, pre, table, ul, ol");
  if (pick) return pick;
  const first = slot.firstElementChild;
  return first instanceof HTMLElement ? first : slot;
}

function grow(): void {
  if (!editor) return;
  // 先把高度压到 0 再读 scrollHeight：textarea 默认 rows=2，用 auto 量出来会是两行
  editor.style.height = "0px";
  editor.style.height = `${Math.max(editor.scrollHeight, 20)}px`;
}

/** 点击位置 → 光标位置（按渲染区域里的相对位置近似，多行块也不会跳到末尾） */
function caretFromPoint(node: HTMLTextAreaElement, block: MarkdownBlock, event: MouseEvent): number {
  const rect = node.getBoundingClientRect();
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 1;
  const offset = Math.min(Math.max(ratio, 0), 1);
  return Math.round(block.text.length * offset);
}

function startEdit(index: number, event: MouseEvent): void {
  const block = blocks.value[index];
  const slot = slotOf(index);
  if (!block || !slot || !slot.parentElement) return;
  closeEditor();

  const rendered = contentOf(slot);
  const style = getComputedStyle(rendered);
  const node = document.createElement("textarea");
  node.className = "md-block-editor";
  node.value = block.text;
  node.spellcheck = false;
  node.rows = 1;
  node.setAttribute("data-md-editor", String(index));
  node.setAttribute("data-md-kind", block.kind);
  // 关键：把渲染结果的字号/字体/行高/颜色搬过来，看起来还是文档本身
  node.style.fontFamily = style.fontFamily;
  node.style.fontSize = style.fontSize;
  node.style.fontWeight = style.fontWeight;
  node.style.fontStyle = style.fontStyle;
  node.style.lineHeight = style.lineHeight;
  node.style.letterSpacing = style.letterSpacing;
  node.style.color = style.color;
  node.style.textAlign = style.textAlign === "start" ? "left" : style.textAlign;

  // 外面包一层块级容器承接原来的外边距：textarea 是替换元素、外边距不合并，
  // 直接把 h1 的 margin 挪到它身上会让后面整篇内容往下跳。
  const host = document.createElement("div");
  host.className = "md-block-editor-host";
  host.style.marginTop = style.marginTop;
  host.style.marginBottom = style.marginBottom;
  host.style.marginLeft = style.marginLeft;
  host.style.marginRight = style.marginRight;
  host.appendChild(node);

  slot.style.display = "none";
  slot.parentElement.insertBefore(host, slot);
  editorHost = host;
  editor = node;
  editingBlock = block;
  editingIndex.value = index;

  node.addEventListener("input", grow);
  node.addEventListener("blur", () => commit());
  node.addEventListener("keydown", (kev: KeyboardEvent) => {
    if (kev.key === "Escape") {
      kev.preventDefault();
      closeEditor();
      return;
    }
    if (kev.key === "Enter" && (kev.ctrlKey || kev.metaKey)) {
      kev.preventDefault();
      commit();
    }
  });

  // 点到编辑区外面（工具栏、别的面板）也要提交：有些情况 textarea 抢不到焦点，
  // 光靠 blur 会一直挂在编辑态
  document.addEventListener("pointerdown", onOutsidePointerDown, true);

  grow();
  node.focus();
  const caret = caretFromPoint(node, block, event);
  node.setSelectionRange(caret, caret);
}

function onOutsidePointerDown(event: Event): void {
  if (!editorHost) return;
  const target = event.target;
  if (target instanceof Node && editorHost.contains(target)) return;
  commit();
}

function closeEditor(): void {
  document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  const node = editor;
  const host = editorHost;
  editor = null;
  editorHost = null;
  editingBlock = null;
  const index = editingIndex.value;
  editingIndex.value = null;
  if (host) host.remove();
  else if (node) node.remove();
  const slot = index === null ? null : root.value?.querySelector<HTMLElement>(`[data-md-block="${index}"]`) ?? null;
  if (slot) slot.style.display = "";
  scheduleSync();
}

function commit(): void {
  const node = editor;
  const block = editingBlock;
  if (!node || !block) return;
  const next = node.value.replace(/\r\n/g, "\n");
  closeEditor();
  if (next === block.text) return;
  emit("update:content", replaceMarkdownBlock(props.content, block, next));
}

function onRootClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  // 正在改的时候点别处：先提交，再按新点击处理
  if (editor) {
    const inside = editor.contains(target);
    if (!inside) commit();
    if (inside || editor) return;
  }
  // 链接、按钮、代码块工具栏保持原有行为
  if (target.closest("a, button, input, textarea, summary, .code-block-wrapper")) return;
  const slot = target.closest<HTMLElement>("[data-md-block]");
  if (!slot) return;
  const index = Number(slot.dataset.mdBlock);
  if (!Number.isInteger(index)) return;
  startEdit(index, event);
}

onBeforeUnmount(() => {
  if (syncTimer) clearTimeout(syncTimer);
  closeEditor();
});
</script>

<template>
  <div
    ref="root"
    class="md-preview md-editable"
    :class="{ 'can-edit': aligned }"
    :data-aligned="aligned ? '1' : '0'"
    :data-editing="editingIndex === null ? '0' : '1'"
    @click="onRootClick"
  >
    <MarkdownBody :content="content" mode="docs" />
  </div>
</template>

<style scoped>
/* 排版与滚动沿用 .md-preview（内边距、max-width 860、正文 14.5px/1.78） */
.md-editable {
  position: relative;
  overflow-anchor: none;
}
.md-editable.can-edit [data-md-block] {
  cursor: text;
  border-radius: 3px;
  transition: background 0.12s;
}
/* 悬停只给一点极淡的底色，暗示「这块可以点」，不画框 */
.md-editable.can-edit [data-md-block]:hover {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
</style>
