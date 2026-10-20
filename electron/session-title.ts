/**
 * 会话标题：默认取自首条用户消息。
 * 长内容必须压缩并截断，否则侧边栏与删除确认弹窗会被整段日志/代码撑爆。
 * 首条消息可能只带附件标记（图片/文件），标记本身不能当标题。
 */

export const SESSION_TITLE_MAX = 48;

const ATTACHMENT_MARKER = /<(file|directory) name="([^"]*)">[\s\S]*?<\/\1>/g;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** 只发附件、没有正文时，退化为附件文件名 */
function attachmentName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function sessionTitleFromText(text: unknown): string {
  let fallback = "";
  const stripped = String(text ?? "").replace(ATTACHMENT_MARKER, (_match, _tag: string, rawName: string) => {
    if (!fallback) fallback = attachmentName(unescapeXml(rawName));
    return " ";
  });
  const compact = stripped.replace(/\s+/g, " ").trim();
  const source = compact || fallback;
  if (!source) return "";
  return source.length > SESSION_TITLE_MAX ? `${source.slice(0, SESSION_TITLE_MAX)}…` : source;
}
