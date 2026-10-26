/**
 * 设置页专用的补充字形。
 *
 * 为什么手写：`@carbon/icons` 只装了项目用到的那批图标（68 个），里面没有「应用窗口」
 * 这种字形；而「Pi Desktop」用它才说得清「这是这个桌面应用本身」，用箱子/下载箭头
 * 都会被读成「软件包 / 更新」。所以这里照 Carbon 16px 的网格手绘一个，描边跟着
 * `currentColor`，深浅主题都不用额外处理。
 */
const SVG = (body: string, strokeWidth = 1.15): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" aria-hidden="true">${body}</svg>`;

/** 应用窗口：外框 + 标题栏分隔线 + 标题栏上的小圆点 */
export const windowGlyph = SVG(
  '<rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.7" />' +
    '<path d="M1.9 6.1h12.2" />' +
    '<circle cx="4.1" cy="4.5" r="0.55" fill="currentColor" stroke="none" />',
);
