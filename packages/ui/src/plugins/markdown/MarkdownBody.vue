<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender from "markstream-vue";
import "markstream-vue/index.css";
import { useKernel } from "../../kernel/use-kernel.ts";
import { mermaidOptions, mermaidRender } from "./markdown.ts";
import { injectMermaidTheme } from "./mermaid-theme.ts";
import { extractMermaidCodes, watchMermaidExport } from "./mermaid-export.ts";
import { watchMermaidFit } from "./mermaid-fit.ts";

const props = withDefaults(
  defineProps<{
    content: string;
    /** 流式输出未完成时为 true，完整文档为 false */
    streaming?: boolean;
    mode?: "chat" | "docs";
    className?: string;
  }>(),
  {
    streaming: false,
    mode: "docs",
    className: "",
  },
);

const { theme, plugins, bus } = useKernel();
const currentTheme = computed(() => theme.currentTheme());
const isDark = computed(() => currentTheme.value.scheme === "dark");
const codeTheme = computed(() => currentTheme.value.codeTheme);
const root = ref<HTMLElement | null>(null);

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

/**
 * 主题指令注入：库写死 `theme: dark/default` 两套 stock 主题；
 * 这里给每个 mermaid 围栏首行加 `%%{init: base + 全套变量}%%`，
 * 库检测到 `%%{` 开头会跳过自己的指令，于是我们的主题完全接管
 * （字体按 Inter 度量布局，配色跟随桌面端深浅主题）。
 * 导出 MMD 仍用原始 content，保证下载的是干净源码。
 */
const themedContent = computed(() =>
  mermaidEnabled.value ? injectMermaidTheme(props.content, isDark.value) : props.content,
);

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
onBeforeUnmount(() => {
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
      :final="!streaming"
      :is-dark="isDark"
      :viewport-priority="false"
      :code-block-props="{ theme: codeTheme }"
      :mermaid-props="mermaidProps"
    />
  </div>
</template>
