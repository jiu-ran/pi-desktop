/**
 * 手绘的文件类型图形（16px 网格，1.3px 描边，`currentColor`）。
 *
 * 为什么不用 Carbon：Carbon 的文件类图标只有通用的「纸张 / 文件夹 / 图片 / 压缩包」
 * 几种，凑不出 VS Code / JetBrains 那种「一眼认语言」的图形；而品牌 SVG（Material
 * Icon Theme 之类）动辄上千个文件、还要处理授权。这里只画真正会被看见的那二十来个，
 * 每个都在 16px 上验证过——线条落半像素，缩放不变形。
 *
 * 约定：`stroke="currentColor"`，不写死颜色；实心主题由 CSS 换 `fill`（见 components.css）。
 */
const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const fileGlyphs: Record<string, string> = {
  // ---- 文件夹（VS Code 风格的「带盖子的文件夹」）----
  folder: svg(
    '<path class="fx-fill" d="M1.8 4.5a1 1 0 0 1 1-1h3.3l1.3 1.4h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity="0.22"/><path d="M1.8 4.5a1 1 0 0 1 1-1h3.3l1.3 1.4h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>',
  ),
  folderOpen: svg(
    '<path d="M1.8 4.5a1 1 0 0 1 1-1h3.3l1.3 1.4h5.8a1 1 0 0 1 1 1v1.7"/><path class="fx-fill" d="M2.3 13.2 3.8 6.9h11.4l-1.7 6.2a1 1 0 0 1-1 .8H3.3a1 1 0 0 1-1-.7z" fill="currentColor" fill-opacity="0.22"/><path d="M2.3 13.2 3.8 6.9h11.4l-1.7 6.2a1 1 0 0 1-1 .8H3.3a1 1 0 0 1-1-.7z"/>',
  ),
  // ---- 文档类 ----
  page: svg(
    '<path d="M9.2 1.9H4.2a1.1 1.1 0 0 0-1.1 1.1v10a1.1 1.1 0 0 0 1.1 1.1h7.6a1.1 1.1 0 0 0 1.1-1.1V5.4z"/><path d="M9.2 1.9v3.5h3.7"/>',
  ),
  text: svg(
    '<path d="M9.2 1.9H4.2a1.1 1.1 0 0 0-1.1 1.1v10a1.1 1.1 0 0 0 1.1 1.1h7.6a1.1 1.1 0 0 0 1.1-1.1V5.4z"/><path d="M9.2 1.9v3.5h3.7"/><path d="M5.6 8.4h4.8M5.6 10.6h4.8M5.6 12.8h2.8"/>',
  ),
  config: svg(
    '<path d="M2.6 4.4h4.1M9.6 4.4h3.8M2.6 8h2.4M7.9 8h5.5M2.6 11.6h6.1M11.9 11.6h1.5"/>' +
      '<circle cx="8" cy="4.4" r="1.3" fill="currentColor" fill-opacity="0.9"/><circle cx="6.4" cy="8" r="1.3" fill="currentColor" fill-opacity="0.9"/><circle cx="10.4" cy="11.6" r="1.3" fill="currentColor" fill-opacity="0.9"/>',
  ),
  lock: svg(
    '<rect x="3.4" y="6.9" width="9.2" height="7.2" rx="1.2" fill="currentColor" fill-opacity="0.22"/><rect x="3.4" y="6.9" width="9.2" height="7.2" rx="1.2"/><path d="M5.6 6.9V5.2a2.4 2.4 0 0 1 4.8 0v1.7"/>',
  ),
  // ---- 数据 ----
  db: svg(
    '<ellipse cx="8" cy="4" rx="5.1" ry="1.9"/><path d="M2.9 4v8c0 1 2.3 1.9 5.1 1.9s5.1-.9 5.1-1.9V4"/><path d="M2.9 8c0 1 2.3 1.9 5.1 1.9s5.1-.9 5.1-1.9"/>',
  ),
  sheet: svg(
    '<rect x="2.4" y="2.6" width="11.2" height="10.8" rx="1.2"/><path d="M2.4 6h11.2M2.4 9.4h11.2M6.6 2.6v10.8"/>',
  ),
  // ---- 媒体 ----
  image: svg(
    '<rect x="2.1" y="3.1" width="11.8" height="9.8" rx="1.4"/><circle cx="5.9" cy="6.4" r="1.2"/><path d="M2.6 11.6 6 8.4l2.2 2 1.9-1.6 3 2.8"/>',
  ),
  video: svg(
    '<rect x="1.9" y="3.6" width="8.6" height="8.8" rx="1.3"/><path d="M10.5 7.2l3.3-2.1v5.8l-3.3-2.1z" fill="currentColor" fill-opacity="0.85"/>',
  ),
  audio: svg(
    '<path d="M6.1 11.2V4.2l6-1.3v6.9"/><circle cx="4.4" cy="11.5" r="1.9"/><circle cx="10.4" cy="10.1" r="1.9"/>',
  ),
  cup: svg(
    '<path d="M2.9 6.4h8.2v4.3a3.1 3.1 0 0 1-3.1 3.1H6a3.1 3.1 0 0 1-3.1-3.1z" fill="currentColor" fill-opacity="0.18"/><path d="M2.9 6.4h8.2v4.3a3.1 3.1 0 0 1-3.1 3.1H6a3.1 3.1 0 0 1-3.1-3.1z"/><path d="M11.1 7.6h1.1a1.9 1.9 0 0 1 0 3.8h-1.1"/><path d="M5.6 2.4v1.6M8.4 2.4v1.6"/>',
  ),
  font: svg(
    '<path d="M4.2 12.4 8 3.6l3.8 8.8"/><path d="M5.5 9.4h5"/><path d="M3.2 13.6h9.6"/>',
  ),
  // ---- 容器 / 可执行 ----
  archive: svg(
    '<rect x="2.6" y="2.4" width="10.8" height="11.2" rx="1.3"/><path d="M2.6 5.8h10.8"/><path d="M7 2.4v1.5M7 6.6v1.5M7 10.2v1.5"/>',
  ),
  binary: svg(
    '<rect x="4.3" y="4.3" width="7.4" height="7.4" rx="1.2" fill="currentColor" fill-opacity="0.18"/><rect x="4.3" y="4.3" width="7.4" height="7.4" rx="1.2"/><path d="M6.5 2.3v2M9.5 2.3v2M6.5 11.7v2M9.5 11.7v2M2.3 6.5h2M2.3 9.5h2M11.7 6.5h2M11.7 9.5h2"/>',
  ),
  // ---- 语言符号（没有字母可用时）----
  code: svg('<path d="M5.6 4.6 1.9 8l3.7 3.4M10.4 4.6 14.1 8l-3.7 3.4"/>'),
  terminal: svg('<path d="M3 4.6 6.4 8 3 11.4"/><path d="M7.4 11.8h5.6"/>'),
};
