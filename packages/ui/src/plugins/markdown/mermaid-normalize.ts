/**
 * Mermaid SVG 归一化与导出序列化。
 *
 * 移植自 Vercel streamdown（MIT License）的 `lib/mermaid/utils.ts`，
 * 即 Cursor 聊天区图表渲染的同一套实现：
 * - Mermaid 输出的 svg 自带 `width="100%"` + max-width 样式，在窄栏里会把
 *   很宽的图压到文字无法辨认；这里按 viewBox 还原自然像素尺寸，
 *   再由 mermaid-fit.ts 按容器宽度做 fit 缩放（只缩小不放大）。
 * - 下载前用 DOMParser + XMLSerializer 重序列化，把 HTML 序列化产物
 *   （如 `<br>`）变成合法 SVG，避免导出的文件打不开。
 */

const SVG_TAG_REGEX = /<svg\b[^>]*>/i;
const VIEW_BOX_REGEX = /\bviewBox=(['"])(.*?)\1/i;
const VIEW_BOX_SPLIT_REGEX = /[\s,]+/;
const WIDTH_ATTR_REGEX = /\swidth=(['"]).*?\1/gi;
const HEIGHT_ATTR_REGEX = /\sheight=(['"]).*?\1/gi;
const STYLE_ATTR_REGEX = /\sstyle=(['"])(.*?)\1/i;
const WIDTH_DECL_REGEX = /^width\s*:/i;
const HEIGHT_DECL_REGEX = /^height\s*:/i;
const MAX_WIDTH_DECL_REGEX = /^max-width\s*:/i;
const SVG_OPEN_TAG_REGEX = /^<svg/i;

export interface MermaidSvgSize {
  width: number;
  height: number;
}

/** 从 viewBox 读出图的自然像素尺寸；缺失或非法时返回 null。 */
export function getMermaidSvgSize(source: string | SVGSVGElement): MermaidSvgSize | null {
  const tag = typeof source === "string" ? (source.match(SVG_TAG_REGEX)?.[0] ?? "") : "";
  const viewBoxAttr = typeof source === "string"
    ? tag.match(VIEW_BOX_REGEX)?.[2] ?? ""
    : source.getAttribute("viewBox") ?? "";
  const values = viewBoxAttr.trim().split(VIEW_BOX_SPLIT_REGEX).map(Number.parseFloat);
  if (values.length < 4 || values.slice(0, 4).some(Number.isNaN)) return null;
  const width = values[2];
  const height = values[3];
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * 原地把 svg 改写为自然像素尺寸（等价于 streamdown 的 normalizeMermaidInlineSvg，
 * 但直接改 DOM 节点而不是替换节点，避免打断渲染库持有的引用与监听器）。
 * 返回自然尺寸；失败返回 null 且不动节点。
 */
export function normalizeMermaidSvg(svg: SVGSVGElement): MermaidSvgSize | null {
  const size = getMermaidSvgSize(svg);
  if (!size) return null;
  try {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    const declarations = `width:${size.width}px;height:${size.height}px;max-width:none;`;
    const current = svg.getAttribute("style") ?? "";
    const kept = current
      .split(";")
      .map((decl) => decl.trim())
      .filter(Boolean)
      .filter((decl) => !WIDTH_DECL_REGEX.test(decl) && !HEIGHT_DECL_REGEX.test(decl) && !MAX_WIDTH_DECL_REGEX.test(decl))
      .join(";");
    svg.setAttribute("style", `${declarations}${kept ? `${kept};` : ""}`);
    svg.setAttribute("width", String(size.width));
    svg.setAttribute("height", String(size.height));
    return size;
  } catch {
    return null;
  }
}

/**
 * 按容器宽度算 fit 后的显示尺寸：只缩小不放大（对齐 streamdown PanZoom 的
 * `Math.min(containerWidth / contentWidth, 1)`，新图重置、用户缩放后不再强改）。
 */
export function fittedMermaidSize(
  natural: MermaidSvgSize,
  containerWidth: number,
): { fit: number; width: number; height: number } {
  const fit = containerWidth > 0 ? Math.min(containerWidth / natural.width, 1) : 1;
  if (!(fit > 0) || Number.isNaN(fit)) return { fit: 1, width: natural.width, height: natural.height };
  return { fit, width: natural.width * fit, height: natural.height * fit };
}

/** 渲染输出可能是 HTML 序列化产物；下载前重序列化为合法 SVG。 */
export function serializeSvgForDownload(svg: SVGSVGElement): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svg.outerHTML;
  }
  try {
    const doc = new DOMParser().parseFromString(new XMLSerializer().serializeToString(svg), "text/html");
    return new XMLSerializer().serializeToString(doc.querySelector("svg") ?? svg);
  } catch {
    return new XMLSerializer().serializeToString(svg);
  }
}
