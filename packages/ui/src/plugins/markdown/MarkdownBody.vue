<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender, { removeCustomComponents, setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
const CursorMermaid = defineAsyncComponent(() => import("./CursorMermaid.vue"));
import MarkdownCodeBlock from "./MarkdownCodeBlock.vue";
import ImageLightbox from "../../components/chat/ImageLightbox.vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { imageRef, imageTargets, replaceImageTargets } from "../../shared/local-image.ts";
import { appSettings } from "../../services/settings.ts";
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
    .readLocalImage(imagePath)
    .then((data) => data.dataUrl ?? null)
    .catch(() => null);
  imageCache.set(imagePath, pending);
  // 读失败不进缓存：临时文件稍后就可能出现，缓存住失败结果会一直显示不出来
  void pending.then((value) => {
    if (!value) imageCache.delete(imagePath);
  });
  return pending;
}

/* ---------- 远程图片：默认不加载，点一下才换成真的 src ----------
 * 对话内容是别人写的（或模型写的）markdown：自动加载 http(s) 图片会把本机 IP、
 * Referer 和「你看过这条消息」直接送给图床。所以默认只渲染一个占位按钮。 */
const REMOTE_MARKER_RE = /pi-remote-image-(\d+)/g;
const remoteDomainRe = /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^@/?#]+@)?([^/?#:]+)/i;

/** markdown 里被拦下的远程图片地址（按本次渲染的序号） */
let blockedRemoteImages: string[] = [];
/** 用户这一轮里点过「加载」的地址：重新渲染时不要再拆回占位 */
const forcedRemoteImages = new Set<string>();

function isRemoteHttpImage(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(String(src ?? "").trim());
}

function remoteImageDomain(src: string): string {
  const match = remoteDomainRe.exec(String(src ?? "").trim());
  return (match?.[1] ?? "").replace(/^www\./i, "") || "远程图片";
}

function remoteImageButton(url: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "md-remote-image";
  button.dataset.remoteUrl = url;
  button.title = url;
  button.textContent = `点击加载远程图片 (${remoteImageDomain(url)})`;
  return button;
}

/** 把占位文本换成按钮（markstream 重渲染会重建节点，这里补一遍） */
function decorateBlockedRemoteImages(): void {
  const container = root.value;
  if (!container || !blockedRemoteImages.length) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue?.includes("pi-remote-image-")) continue;
    const parent = node.parentElement;
    if (parent?.closest("code, pre, .md-code, a, button")) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    const value = node.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of value.matchAll(new RegExp(REMOTE_MARKER_RE.source, "g"))) {
      const url = blockedRemoteImages[Number(match[1])];
      if (!url) continue;
      if ((match.index ?? 0) > last) fragment.append(document.createTextNode(value.slice(last, match.index)));
      fragment.append(remoteImageButton(url));
      last = (match.index ?? 0) + match[0].length;
    }
    if (!last) continue;
    if (last < value.length) fragment.append(document.createTextNode(value.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
  }
}

function loadBlockedRemoteImage(button: HTMLElement): void {
  const url = button.dataset.remoteUrl ?? "";
  if (!url) return;
  forcedRemoteImages.add(url);
  const img = document.createElement("img");
  img.src = url;
  img.alt = button.textContent ?? "";
  img.className = "md-remote-loaded";
  button.replaceWith(img);
  decorateImages();
  bus.emit("markdown:height-change");
}

/** 把 markdown 里的本地图片换成 data URL；远程图片默认换成占位标记 */
async function resolveMarkdownImages(markdown: string): Promise<string> {
  if (!markdown.includes("![")) return markdown;
  const targets = imageTargets(markdown);
  if (!targets.length) return markdown;
  const replacements: Array<{ target: (typeof targets)[number]; text: string }> = [];
  const blocked: string[] = [];
  for (const target of targets) {
    if (isRemoteHttpImage(target.src)) {
      if (appSettings.autoLoadRemoteImages || forcedRemoteImages.has(target.src)) continue;
      blocked.push(target.src);
      replacements.push({ target, text: `pi-remote-image-${blocked.length - 1}` });
      continue;
    }
    const ref = imageRef(target.src);
    if (ref.kind !== "local") continue;
    const dataUrl = await readLocalImage(ref.path);
    // markstream 会把 svg 图片整块丢掉（连占位都不留），这里不替换，
    // 让原路径留着走它的「加载失败」占位，至少能看出有问题。
    if (dataUrl && !dataUrl.startsWith("data:image/svg+xml")) replacements.push({ target, text: dataUrl });
  }
  blockedRemoteImages = blocked;
  return replacements.length ? replaceImageTargets(markdown, replacements) : markdown;
}

/* ---------- 点图片放大 ---------- */
const previewIndex = ref<number | null>(null);
const previewImages = ref<Array<{ src: string; name?: string }>>([]);

function markdownImages(): HTMLImageElement[] {
  const container = root.value;
  if (!container) return [];
  return [...container.querySelectorAll<HTMLImageElement>(".md img")].filter((img) => Boolean(img.getAttribute("src")));
}

function openImageZoom(img: HTMLImageElement): void {
  const images = markdownImages();
  const index = images.indexOf(img);
  if (index < 0) return;
  previewImages.value = images.map((item, position) => ({
    src: item.getAttribute("src") ?? "",
    name: item.getAttribute("alt")?.trim() || `图片 ${position + 1}`,
  }));
  previewIndex.value = index;
}

/** 点图片 → 放大；点远程图片占位 → 加载；键盘 Enter / 空格 等同点击 */
function onMarkdownClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const placeholder = target.closest<HTMLElement>(".md-remote-image");
  if (placeholder) {
    event.preventDefault();
    loadBlockedRemoteImage(placeholder);
    return;
  }
  const img = target.closest("img");
  if (!(img instanceof HTMLImageElement) || !root.value?.contains(img)) return;
  if (!(img.closest(".md") instanceof HTMLElement)) return;
  event.preventDefault();
  openImageZoom(img);
}

function onMarkdownKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || !root.value?.contains(target)) return;
  event.preventDefault();
  openImageZoom(target);
}

/** 图片要能聚焦、能看出可以点（markstream 重渲染会重建节点，这里补一遍） */
function decorateImages(): void {
  decorateBlockedRemoteImages();
  for (const img of markdownImages()) {
    if (img.dataset.zoom === "1") continue;
    img.dataset.zoom = "1";
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    // markstream 默认把 title 设成 alt，这里补上「可以点」的提示
    const alt = img.getAttribute("alt")?.trim() ?? "";
    img.title = alt ? `${alt}（点击放大）` : "点击放大";
    img.setAttribute("aria-label", `${alt || "图片"}（点击放大）`);
  }
}

let decorateObserver: MutationObserver | null = null;

/** 渲染完成后交给 markstream 的内容（本地图片已就绪才替换） */
const renderedContent = ref(props.content);
let contentToken = 0;

async function applyContent(next: string): Promise<void> {
  const token = ++contentToken;
  let resolved = next;
  try {
    resolved = await resolveMarkdownImages(next);
  } catch {
    resolved = next;
  }
  if (token === contentToken) {
    renderedContent.value = resolved;
    void nextTick(decorateImages);
  }
}

watch(() => props.content, applyContent, { immediate: true });
// 设置里打开「自动加载远程图片」后要立刻重渲染；关掉时把「这一次加载过」的记录清掉
watch(
  () => appSettings.autoLoadRemoteImages,
  (enabled) => {
    if (!enabled) forcedRemoteImages.clear();
    void applyContent(props.content);
  },
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
    decorateImages();
    decorateObserver = new MutationObserver(() => decorateImages());
    decorateObserver.observe(root.value, { childList: true, subtree: true });
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
  decorateObserver?.disconnect();
  decorateObserver = null;
  stopFit?.();
  stopExport?.();
});
</script>

<template>
  <div ref="root" class="md-body" :class="className" @click="onMarkdownClick" @keydown="onMarkdownKeydown">
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
    <ImageLightbox v-model:index="previewIndex" :items="previewImages" />
  </div>
</template>
