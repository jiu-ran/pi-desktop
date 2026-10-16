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
  fitPreviewHeight: true;
  showZoomControls: false;
  enableWheelZoom: true;
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
    fitPreviewHeight: true,
    showZoomControls: false,
    enableWheelZoom: true,
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
