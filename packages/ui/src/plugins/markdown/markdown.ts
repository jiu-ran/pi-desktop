import {
  clearMermaidWorker,
  disableMermaid,
  enableMermaid,
  isMermaidEnabled,
  setMermaidWorker,
  terminateWorker,
} from "markstream-vue";

export interface MermaidRenderErrorHandler {
  (error: unknown, code: string, container: HTMLElement): boolean | void;
}

export interface MermaidRenderOptions {
  fitPreviewHeight: boolean;
  showHeader: boolean;
  showModeToggle: boolean;
  showCopyButton: boolean;
  showExportButton: boolean;
  showFullscreenButton: boolean;
  showCollapseButton: boolean;
  showZoomControls: boolean;
  enableWheelZoom: boolean;
  enableMermaidInteractions: boolean;
  showTooltips: boolean;
  workerTimeoutMs: number;
  parseTimeoutMs: number;
  renderTimeoutMs: number;
  fullRenderTimeoutMs: number;
  renderDebounceMs: number;
  contentStableDelayMs: number;
  previewPollDelayMs: number;
  previewPollMaxDelayMs: number;
  previewPollMaxAttempts: number;
  onRenderError: MermaidRenderErrorHandler;
}

/**
 * Mermaid 渲染开关：由 mermaid 渲染插件控制，对话区与文件区的 Markdown 渲染共用。
 * markstream-vue 把 Mermaid 当作可选能力，需要同时注入解析 worker 才会把 ```mermaid 代码块渲染为图。
 */
export const mermaidRender = {
  enabled: false,
};

let worker: Worker | null = null;
let lifecycle = 0;
let mermaidLoader: Promise<unknown> | null = null;

function loadMermaid(): Promise<unknown> {
  return import("mermaid");
}

function loadMermaidForGeneration(generation: number): Promise<unknown> {
  if (!mermaidLoader) {
    mermaidLoader = loadMermaid().catch((error) => {
      mermaidLoader = null;
      throw error;
    });
  }
  const pending = mermaidLoader;
  return pending.then((module) => {
    if (generation !== lifecycle || !mermaidRender.enabled) return null;
    return module;
  });
}

export function setMermaidRendering(enabled: boolean): void {
  lifecycle += 1;
  mermaidRender.enabled = enabled;

  if (!enabled) {
    if (isMermaidEnabled()) disableMermaid();
    clearMermaidWorker();
    terminateWorker();
    worker = null;
    return;
  }

  const generation = lifecycle;
  if (!isMermaidEnabled()) enableMermaid(() => loadMermaidForGeneration(generation));
  if (worker || typeof Worker === "undefined") return;

  const token = lifecycle;
  let nextWorker: Worker;
  try {
    nextWorker = new Worker(new URL("markstream-vue/workers/mermaidParser.worker", import.meta.url), {
      type: "module",
    });
  } catch {
    // markstream-vue can fall back to the main-thread Mermaid loader.
    return;
  }
  if (!mermaidRender.enabled || token !== lifecycle) {
    nextWorker.terminate();
    return;
  }
  worker = nextWorker;
  setMermaidWorker(nextWorker);
}

export function mermaidOptions(onRenderError: MermaidRenderErrorHandler): MermaidRenderOptions {
  return {
    // 对齐 Cursor（streamdown）区块工具栏：标题行 + 图表/源码切换 + 复制 +
    // 导出 SVG + 全屏 + 折叠 + 缩放控件；滚轮缩放与节点交互一并打开。
    // PNG / MMD 导出由 mermaid-export.ts 补进同一工具栏（库内置只有 SVG）。
    fitPreviewHeight: true,
    showHeader: true,
    showModeToggle: true,
    showCopyButton: true,
    showExportButton: true,
    showFullscreenButton: true,
    showCollapseButton: true,
    showZoomControls: true,
    enableWheelZoom: true,
    enableMermaidInteractions: true,
    showTooltips: true,
    workerTimeoutMs: 8_000,
    parseTimeoutMs: 4_000,
    renderTimeoutMs: 8_000,
    fullRenderTimeoutMs: 12_000,
    renderDebounceMs: 80,
    contentStableDelayMs: 120,
    previewPollDelayMs: 16,
    previewPollMaxDelayMs: 160,
    previewPollMaxAttempts: 20,
    onRenderError,
  };
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

export function isMarkdownFile(name = ""): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.has(ext);
}
