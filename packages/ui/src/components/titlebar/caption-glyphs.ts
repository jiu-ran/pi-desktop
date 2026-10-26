/**
 * Windows 风格的窗口按钮字形（最小化 / 最大化 / 还原 / 关闭）。
 *
 * 为什么不用 Carbon：Carbon 的 `maximize` / `minimize` 是「对角箭头」，
 * 用来当窗口按钮会让人认不出来。系统标题栏字形就三条极简几何，
 * 手写 10×10、1px 描边反而最准（缩放时也清晰）。
 */
const SVG = (body: string, strokeWidth = 1): string =>
  `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" aria-hidden="true">${body}</svg>`;

export const captionGlyphs = {
  minimize: SVG('<path d="M0 5.5h10" />'),
  maximize: SVG('<rect x="0.5" y="0.5" width="9" height="9" />'),
  restore: SVG('<path d="M2.5 2.5V0.5h7v7h-2" /><rect x="0.5" y="2.5" width="7" height="7" />'),
  close: SVG('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />', 1.1),
};
