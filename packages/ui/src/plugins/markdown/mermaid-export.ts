/**
 * Mermaid PNG / MMD 导出。
 *
 * markstream-vue 的导出按钮只会下载 SVG（见其 MermaidBlockNode 默认实现），
 * 而 Cursor（streamdown）的图表工具栏提供 SVG / PNG / MMD 三件套。
 * MarkdownRender 没有透出库的 `export` 事件，无法拦截改写，所以在这里
 * 直接往 `.mermaid-header-actions` 里补两个同样式按钮（PNG / MMD），
 * 与库自带按钮并排。SVG 沿用库内置行为，不重复实现。
 */

const BLOCK = ".mermaid-block-container";
const ACTIONS = ".mermaid-header-actions";

export type MermaidExportErrorHandler = (message: string) => void;

/** 按出现顺序抽出 ```mermaid 围栏源码，与 DOM 里 block 的顺序对齐。 */
export function extractMermaidCodes(content: string): string[] {
  const out: string[] = [];
  const fence = /```mermaid[^\S\n]*\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) out.push((match[1] ?? "").replace(/\n$/, ""));
  return out;
}

function stamp(): string {
  return `mermaid-diagram-${Date.now()}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 给点击留一拍再回收，避免某些浏览器下载中断。
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

/**
 * 把 SVG 光栅化为 PNG（思路同 Cursor 的 Zal：SVG → Image → canvas → toBlob）。
 * 无 viewBox 或尺寸缺失时回退到渲染尺寸，保证导出的图不是空白。
 */
export function rasterizeSvgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const rect = svg.getBoundingClientRect();
  const width = Math.round(viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : rect.width || 800);
  const height = Math.round(viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : rect.height || 600);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // 内联样式在 <img> 里会丢失：把当前字体与背景固化进去。
  const style = document.createElement("style");
  style.textContent = "text{font-family:var(--mono,monospace)}";
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width * scale);
        canvas.height = Math.max(1, height * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持 canvas 导出");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))),
          "image/png",
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG 光栅化失败，请改用 SVG 导出"));
    };
    image.src = url;
  });
}

async function exportPng(block: HTMLElement, onError: MermaidExportErrorHandler): Promise<void> {
  const svg = block.querySelector("svg");
  if (!svg) {
    onError("图表尚未渲染完成，稍后再试");
    return;
  }
  try {
    saveBlob(await rasterizeSvgToPng(svg), `${stamp()}.png`);
  } catch (error) {
    onError(error instanceof Error ? error.message : "PNG 导出失败");
  }
}

function exportSource(code: string, onError: MermaidExportErrorHandler): void {
  if (!code.trim()) {
    onError("Mermaid 源码为空，无法导出");
    return;
  }
  saveBlob(new Blob([`${code}\n`], { type: "text/plain;charset=utf-8" }), `${stamp()}.mmd`);
}

function makeButton(label: string, title: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-action-btn";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

/** 给一个已渲染的 block 补 PNG / MMD 按钮，已补过则跳过。 */
function augmentBlock(block: HTMLElement, code: string, onError: MermaidExportErrorHandler): void {
  if (block.dataset.mdExportAugmented === "1") return;
  const bar = block.querySelector(ACTIONS);
  if (!bar || !block.querySelector("svg")) return;
  block.dataset.mdExportAugmented = "1";
  bar.append(
    makeButton("PNG", "下载图表为 PNG", () => void exportPng(block, onError)),
    makeButton("MMD", "下载 Mermaid 源码", () => exportSource(code, onError)),
  );
}

function augmentAll(container: HTMLElement, codes: () => string[], onError: MermaidExportErrorHandler): void {
  const list = codes();
  const blocks = container.querySelectorAll<HTMLElement>(BLOCK);
  blocks.forEach((block, index) => augmentBlock(block, list[index] ?? "", onError));
}

/**
 * 监听容器中新渲染出的 Mermaid 图并补导出按钮。
 * 图是异步写入的，同时监听子节点与属性变化，覆盖 SVG / viewBox 分阶段到达的时序。
 */
export function watchMermaidExport(
  container: HTMLElement,
  codes: () => string[],
  onError: MermaidExportErrorHandler,
): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  augmentAll(container, codes, onError);
  const observer = new MutationObserver(() => augmentAll(container, codes, onError));
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["viewBox"] });
  return () => observer.disconnect();
}
