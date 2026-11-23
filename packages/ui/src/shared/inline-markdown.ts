/**
 * 行内 Markdown（表格单元格、块内短文本）→ HTML。
 *
 * 只处理真正会在单行里出现的语法：行内代码、加粗、斜体、删除线、链接、图片。
 * 单元格里的 `**xxx**` 必须显示成加粗而不是原样露出来——表格 widget 拿到的是
 * 纯 markdown 文本，它自己不解析行内语法，所以要在这里补上。
 *
 * 安全：先整体转义 HTML，再按占位符回填代码片段，任何输入都不会变成可执行标签。
 */

const CODE_TOKEN = "\u0000CODE\u0000";

const SAFE_HREF = /^(?:https?:\/\/|mailto:|#|\/|\.\.?\/)/i;

/** http(s) 或协议相对的图片地址（这两种都会真的去外网取图） */
function isRemoteImage(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

function remoteImageHost(src: string): string {
  const match = /^(?:https?:)?\/\/(?:[^@/?#]+@)?([^/?#:]+)/i.exec(src.trim());
  return (match?.[1] ?? "").replace(/^www\./i, "") || "远程图片";
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface InlineMarkdownOptions {
  /**
   * 行内代码的 class：编辑器里用 `.cm-md-inlinecode`（跟着强调色），
   * 阅读视图用纯 `<code>`。默认不加 class。
   */
  codeClass?: string;
  /**
   * 是否自动加载 http(s) 图片。默认 false：只输出一个「点击加载远程图片」的占位，
   * 免得表格里贴一张图就把本机 IP / 阅读行为送给图床。
   */
  allowRemoteImages?: boolean;
}

/** 把一段行内 markdown 渲染成 HTML 字符串（不含外层标签）。 */
export function renderInlineMarkdown(source: string, options: InlineMarkdownOptions = {}): string {
  if (!source) return "";
  const codes: string[] = [];
  const codeClass = options.codeClass ? ` class="${escapeHtml(options.codeClass)}"` : "";
  // 先摘出行内代码：里面的 * _ ~ [ ] 都不该被当成标记
  const withoutCode = String(source).replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code${codeClass}>${escapeHtml(code)}</code>`);
    return `${CODE_TOKEN}${codes.length - 1}\u0000`;
  });

  let html = escapeHtml(withoutCode);

  // 链接与图片：先处理图片，再处理链接，避免 ![a](b) 被当成 [a](b)
  const allowRemote = options.allowRemoteImages === true;
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, src: string) => {
    if (!SAFE_HREF.test(src)) return match;
    if (isRemoteImage(src) && !allowRemote) {
      // 占位：真正的 <img> 要等用户点一下才插进去（见 live-preview-blocks 的点击处理）
      return `<span class="md-remote-image" role="button" tabindex="0" data-remote-url="${src}">点击加载远程图片 (${remoteImageHost(src)})</span>`;
    }
    return `<img alt="${alt}" src="${src}">`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, href: string) => {
    if (!SAFE_HREF.test(href)) return match;
    return `<a href="${href}">${text}</a>`;
  });

  // 强调：加粗 → 斜体 → 删除线（顺序决定 ** 不会先被当成单个 *）。
  // 分隔符里侧不能是空白（CommonMark 规则），否则 "** 空 **" 会被误当成加粗。
  const inner = (ch: string) => `[^${ch}\\s](?:[^${ch}]*[^${ch}\\s])?`;
  html = html
    .replace(new RegExp(`\\*\\*(${inner("*")})\\*\\*`, "g"), "<strong>$1</strong>")
    .replace(new RegExp(`__(${inner("_")})__`, "g"), "<strong>$1</strong>")
    .replace(new RegExp(`(^|[^*])\\*(${inner("*")})\\*(?!\\*)`, "g"), "$1<em>$2</em>")
    .replace(new RegExp(`(^|[^_\\w])_(${inner("_")})_(?![_\\w])`, "g"), "$1<em>$2</em>")
    .replace(new RegExp(`~~(${inner("~")})~~`, "g"), "<del>$1</del>");

  return html.replace(/\u0000CODE\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)] ?? "");
}

/** 渲染结果里是否真的带格式（用来决定编辑时要露源码还是继续渲染） */
export function hasInlineMarkdown(source: string): boolean {
  return renderInlineMarkdown(source) !== escapeHtml(source);
}
