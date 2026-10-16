/**
 * markstream-vue 2.0.19 预构建产物把图表高度重算调错了函数：渲染完成后调用
 * `i(() => Xn())`，而 `i` 被绑定到数值限幅函数而不是帧调度器，所以预览框一直停在
 * 按源码行数估的高度（默认 360px）。这里按 SVG 自身的宽高比补上这次重算，
 * 算法与库里的 `Xn` 一致：高度 = 宽度 × 视图框比例，夹在 120px 与最大高度之间。
 */

import { fittedMermaidSize, getMermaidSvgSize, normalizeMermaidSvg } from "./mermaid-normalize.ts";

const MIN_HEIGHT = 120;
// 对齐 Cursor（streamdown `max-h-[min(70vh,40rem)]`）：高图收到 640px 视口再滚/平移，而非压扁。
const MAX_HEIGHT = 640;

export interface DiagramSize {
  viewWidth: number;
  viewHeight: number;
  renderedWidth: number;
  maxHeight: number;
}

/** 按图的宽高比算预览框应有的高度；尺寸不完整时返回 null，保留现有高度。 */
export function diagramBoxHeight(size: DiagramSize): number | null {
  const { viewWidth, viewHeight, renderedWidth, maxHeight } = size;
  if (!(viewWidth > 0) || !(viewHeight > 0) || !(renderedWidth > 0)) return null;
  const natural = renderedWidth * (viewHeight / viewWidth);
  const cap = maxHeight > 0 ? maxHeight : MAX_HEIGHT;
  return Math.round(Math.min(Math.max(MIN_HEIGHT, natural), cap));
}

export function parseViewBox(value: string | null): { width: number; height: number } | null {
  const parts = (value ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  if (!(parts[2] > 0) || !(parts[3] > 0)) return null;
  return { width: parts[2], height: parts[3] };
}

function maxHeightOf(area: HTMLElement): number {
  if (typeof getComputedStyle !== "function") return MAX_HEIGHT;
  const raw = getComputedStyle(area).getPropertyValue("--ms-size-code-max-height").trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_HEIGHT;
}

/**
 * 把预览区里的 SVG 按自然尺寸归一化后做 fit 缩放（只缩小不放大），
 * 再把预览框高度收到缩放后的实际比例。返回是否改动了 DOM。
 *
 * 对齐 Cursor（streamdown PanZoom 的 auto-fit）：Mermaid 输出的 svg 自带
 * `width="100%"`，在窄栏里会把宽图压扁；先还原 viewBox 自然像素尺寸，
 * 再按 `min(容器宽 / 自然宽, 1)` 缩放，SVG 本身保持矢量清晰度。
 */
export function fitPreviewSvg(area: HTMLElement): boolean {
  const svg = area.querySelector("svg");
  if (!svg) return false;
  const natural = normalizeMermaidSvg(svg) ?? getMermaidSvgSize(svg);
  if (!natural) return false;
  const containerWidth = area.clientWidth || svg.getBoundingClientRect().width;
  const fitted = fittedMermaidSize(natural, containerWidth);
  let changed = false;

  const widthText = `${Math.round(fitted.width)}px`;
  const heightText = `${Math.round(fitted.height)}px`;
  if (svg.style.width !== widthText) {
    svg.style.width = widthText;
    changed = true;
  }
  if (svg.style.height !== heightText) {
    svg.style.height = heightText;
    changed = true;
  }

  const height = diagramBoxHeight({
    viewWidth: natural.width,
    viewHeight: natural.height,
    renderedWidth: fitted.width,
    maxHeight: maxHeightOf(area),
  });
  if (height === null) return changed;
  const next = `${height}px`;
  if (area.style.height !== next) {
    area.style.height = next;
    changed = true;
  }
  return changed;
}

/** 把一个预览区的高度收到其中 SVG 的实际比例。返回是否改动了高度。 */
export function fitPreviewArea(area: HTMLElement): boolean {
  return fitPreviewSvg(area);
}

const AREA = ".mermaid-preview-area";

function areaOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  const area = element?.closest(AREA);
  return area instanceof HTMLElement ? area : null;
}

/**
 * 监听容器里新渲染出的 Mermaid 图并收缩预览框。
 * 预览区先于图插入，图随后由 markstream-vue 异步写入；同时监听子节点和属性变化，
 * 覆盖 SVG、viewBox 或样式分阶段到达的时序；写入当帧宽度还是 0 时保留初始估算。
 */
export function watchMermaidFit(container: HTMLElement, onChange?: (area: HTMLElement, changed: boolean) => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof ResizeObserver === "undefined") return () => {};

  let frame = 0;
  const scheduleFrame = typeof requestAnimationFrame === "function"
    ? (callback: FrameRequestCallback) => requestAnimationFrame(callback)
    : (callback: FrameRequestCallback) => window.setTimeout(callback, 16);
  const cancelFrame = typeof cancelAnimationFrame === "function"
    ? (id: number) => cancelAnimationFrame(id)
    : (id: number) => window.clearTimeout(id);
  const pending = new Set<HTMLElement>();
  const observedAreas = new Set<HTMLElement>();

  const measure = (): void => {
    frame = 0;
    for (const area of pending) {
      if (!container.contains(area)) {
        observedAreas.delete(area);
        resizeObserver.unobserve(area);
        continue;
      }
      const changed = fitPreviewArea(area);
      onChange?.(area, changed);
    }
    pending.clear();
  };

  const schedule = (area: HTMLElement | null): void => {
    if (!area) return;
    pending.add(area);
    if (!observedAreas.has(area)) {
      observedAreas.add(area);
      resizeObserver.observe(area);
    }
    if (!frame) frame = scheduleFrame(measure) as number;
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of [...record.addedNodes, record.target]) schedule(areaOf(node));
      } else {
        schedule(areaOf(record.target));
      }
    }
  });

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === container) {
        for (const area of container.querySelectorAll(AREA)) schedule(area instanceof HTMLElement ? area : null);
      } else {
        schedule(areaOf(entry.target));
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["viewBox", "style"] });
  resizeObserver.observe(container);
  for (const area of container.querySelectorAll(AREA)) schedule(area instanceof HTMLElement ? area : null);

  return () => {
    observer.disconnect();
    resizeObserver.disconnect();
    observedAreas.clear();
    pending.clear();
    if (frame) cancelFrame(frame);
  };
}
