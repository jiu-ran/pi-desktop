<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender, { removeCustomComponents, setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
const CursorMermaid = defineAsyncComponent(() => import("./CursorMermaid.vue"));
import MarkdownCodeBlock from "./MarkdownCodeBlock.vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { imageRef, imageTargets, replaceImageTargets } from "../../shared/local-image.ts";
import { mermaidOptions, mermaidRender } from "./markdown.ts";

import { extractMermaidCodes, watchMermaidExport } from "./mermaid-export.ts";
import { watchMermaidFit } from "./mermaid-fit.ts";

const props = withDefaults(
  defineProps<{
    content: string;
    /** 流式输出未完成时为 true，完整文档为 false */
    streaming?: boolean;
    mode?: "chat" | "docs";
    className?: string;
    query?: string;
  }>(),
  {
    streaming: false,
    mode: "docs",
    className: "",
  },
);

const { theme, plugins, bus, workbench } = useKernel();
const currentTheme = computed(() => theme.currentTheme());
const isDark = computed(() => currentTheme.value.scheme === "dark");
const codeTheme = computed(() => currentTheme.value.codeTheme);
const root = ref<HTMLElement | null>(null);

const mermaidCustomId = `cursor-mermaid-${Math.random().toString(36).slice(2)}`;
setCustomComponents(mermaidCustomId, { mermaid: CursorMermaid, code_block: MarkdownCodeBlock });

const mermaidEnabled = computed(() => {
  void plugins.records.length;
  return Boolean(plugins.get("mermaid")?.enabled && mermaidRender.enabled);
});

function mermaidBlockOf(container: HTMLElement): HTMLElement | null {
  const block = container.closest(".mermaid-block-container");
  return block instanceof HTMLElement ? block : null;
}

function onMermaidError(error: unknown, code: string, container: HTMLElement): boolean {
  const block = mermaidBlockOf(container);
  if (!block || typeof document === "undefined") return false;

  // 流式中已有可用版本：保留最后一张好图，只标记不销毁（对齐 Cursor 的 keep-last-good）。
  if (container.querySelector("svg")) {
    block.dataset.mermaidState = props.streaming ? "streaming" : "ready";
    return true;
  }

  const detail = String(error instanceof Error ? error.message : error || "未知错误").trim();
  const message = detail ? `图表渲染失败：${detail}` : "图表渲染失败，请检查 Mermaid 语法。";
  block.dataset.mermaidState = "error";
  container.replaceChildren();

  let notice = block.querySelector<HTMLElement>(".md-mermaid-error");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "md-mermaid-error";
    notice.setAttribute("role", "alert");
    const preview = block.querySelector(".mermaid-preview-area");
    preview?.insertAdjacentElement("afterend", notice);
  }
  if (notice) notice.textContent = message;

  let fallback = block.querySelector<HTMLElement>(".md-mermaid-fallback");
  if (!fallback) {
    fallback = document.createElement("pre");
    fallback.className = "md-mermaid-fallback";
    fallback.setAttribute("aria-label", "Mermaid 源码");
    notice?.insertAdjacentElement("afterend", fallback);
  }
  if (fallback) fallback.textContent = code.trim() || "（Mermaid 源码为空）";
  block.dataset.mermaidMode = "fallback";
  bus.emit("markdown:height-change");

  // Returning true tells markstream-vue that this block has been handled. Its
  // default error panel would otherwise be appended to the same preview area.
  return true;
}

function clearMermaidError(area: HTMLElement, changed: boolean): void {
  const block = mermaidBlockOf(area);
  if (!block || !area.querySelector("svg")) return;
  delete block.dataset.mermaidState;
  delete block.dataset.mermaidMode;
  block.dataset.mermaidState = "ready";
  block.querySelector(".md-mermaid-error")?.remove();
  block.querySelector(".md-mermaid-fallback")?.remove();
  if (changed) bus.emit("markdown:height-change");
}

function clearMermaidErrors(): void {
  for (const block of root.value?.querySelectorAll<HTMLElement>(".mermaid-block-container") ?? []) {
    delete block.dataset.mermaidState;
    delete block.dataset.mermaidMode;
    block.querySelector(".md-mermaid-error")?.remove();
    block.querySelector(".md-mermaid-fallback")?.remove();
  }
}

function syncMermaidStates(): void {
  for (const block of root.value?.querySelectorAll<HTMLElement>(".mermaid-block-container") ?? []) {
    if (block.dataset.mermaidState === "error") continue;
    const pending = block.dataset.markstreamPending === "true";
    const mode = block.dataset.markstreamMode;
    if (pending) {
      block.dataset.mermaidState = props.streaming ? "streaming" : "rendering";
    } else if (mode === "preview" && block.querySelector("svg")) {
      block.dataset.mermaidState = "ready";
    } else if (mode === "fallback") {
      block.dataset.mermaidState = "fallback";
    } else {
      block.dataset.mermaidState = "idle";
    }
  }
}

const mermaidProps = computed(() =>
  mermaidEnabled.value ? mermaidOptions(onMermaidError) : undefined,
);

const themedContent = computed(() => renderedContent.value);

watch(() => props.streaming, syncMermaidStates);
const renderKey = computed(() => `${props.mode}:${mermaidEnabled.value ? "mermaid" : "plain"}:${isDark.value ? "dark" : "light"}`);

watch([mermaidEnabled, isDark], () => {
  clearMermaidErrors();
  if (mermaidEnabled.value) {
    for (const block of root.value?.querySelectorAll<HTMLElement>(".mermaid-block-container") ?? []) {
      block.dataset.mermaidState = "rendering";
    }
  }
});

let stopFit: (() => void) | null = null;
let stopExport: (() => void) | null = null;

/* ---------- 本地图片：`![](C:\Users\…\a.png)` 要能真的显示出来 ---------- */
/** 读盘结果缓存：同一张图挂在很多条消息里时不重复读（值存 Promise 以去重并发） */
const imageCache = new Map<string, Promise<string | null>>();

function readLocalImage(imagePath: string): Promise<string | null> {
  const cached = imageCache.get(imagePath);
  if (cached) return cached;
  const pending = workbench
    .readWorkspaceFile(imagePath)
    .then((data) => data.preview?.dataUrl ?? null)
    .catch(() => null);
  imageCache.set(imagePath, pending);
  return pending;
}

/** 把 markdown 里的本地图片换成 data URL（远程地址 / data URL 原样留着） */
async function resolveMarkdownImages(markdown: string): Promise<string> {
  if (!markdown.includes("![")) return markdown;
  const targets = imageTargets(markdown);
  if (!targets.length) return markdown;
  const replacements: Array<{ target: (typeof targets)[number]; text: string }> = [];
  for (const target of targets) {
    const ref = imageRef(target.src);
    if (ref.kind !== "local") continue;
    const dataUrl = await readLocalImage(ref.path);
    // 读不到就保留原样，让 markstream 自己报「加载失败」
    if (dataUrl) replacements.push({ target, text: dataUrl });
  }
  return replacements.length ? replaceImageTargets(markdown, replacements) : markdown;
}

/** 逆向后交给 markstream 的内容；本地图片已经就绪才替换 */
const renderedContent = ref(props.content);
let contentToken = 0;
watch(
  () => props.content,
  async (next) => {
    const token = ++contentToken;
    let resolved = next;
    try {
      resolved = await resolveMarkdownImages(next);
    } catch {
      resolved = next;
    }
    if (token === contentToken) renderedContent.value = resolved;
  },
  { immediate: true },
);

onMounted(() => {
  if (root.value) {
    stopFit = watchMermaidFit(root.value, (area, changed) => {
      clearMermaidError(area, changed);
      syncMermaidStates();
    });
    stopExport = watchMermaidExport(
      root.value,
      () => extractMermaidCodes(props.content),
      (message) => bus.emit("notify", { level: "error", text: message }),
    );
  }
});
function highlightQuery(): void {
  const container = root.value;
  if (!container) return;
  for (const mark of container.querySelectorAll("mark.search-mark")) {
    const parent = mark.parentNode;
    parent?.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent?.normalize();
  }
  const query = props.query?.trim();
  if (!query) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("mark.search-mark")) continue;
    const value = node.nodeValue ?? "";
    if (!value.toLowerCase().includes(query.toLowerCase())) continue;
    const fragment = document.createDocumentFragment();
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const part of value.split(new RegExp(`(${escaped})`, "ig")).filter(Boolean)) {
      if (part.toLowerCase() === query.toLowerCase()) {
        const mark = document.createElement("mark");
        mark.className = "search-mark";
        mark.textContent = part;
        fragment.append(mark);
      } else fragment.append(document.createTextNode(part));
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

watch([() => props.content, () => props.query, () => props.streaming], () => {
  if (!props.query?.trim() && !root.value?.querySelector("mark.search-mark")) return;
  void nextTick(highlightQuery);
});
onMounted(() => void nextTick(highlightQuery));
onBeforeUnmount(() => {
  removeCustomComponents(mermaidCustomId);
  stopFit?.();
  stopExport?.();
});
</script>

<template>
  <div ref="root" class="md-body" :class="className">
    <MarkdownRender
      :key="renderKey"
      class="md"
      :mode="mode"
      :content="themedContent"
      html-policy="safe"
      :final="!streaming"
      :is-dark="isDark"
      :viewport-priority="false"
      :code-block-props="{ themes: [codeTheme.dark, codeTheme.light], showLineNumbers: true }"
      :custom-id="mermaidCustomId"
      :mermaid-props="mermaidProps"
    />
  </div>
</template>
