/**
 * 会话标题：默认取自首条用户消息。
 * 长内容必须压缩并截断，否则侧边栏与删除确认弹窗会被整段日志/代码撑爆。
 * 首条消息可能只带附件标记（图片/文件），标记本身不能当标题。
 */

export const SESSION_TITLE_MAX = 48;

const ATTACHMENT_MARKER = /<(file|directory) name="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g;

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

/**
 * 从会话文件头部行里找第一条用户消息的标题。
 *
 * - 只有图片没有文字时返回「图片消息」，否则这类会话会被误判成空会话而隐藏/清理；
 * - 用户消息存在但没有任何可展示文本时返回「新会话」；
 * - 没有用户消息时返回空字符串，调用方可以据此判断会话是否为空。
 */
export function firstUserTitle(lines: string[]): string {
  for (const line of lines) {
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      // 跳过损坏或未写完的 JSONL 行
      continue;
    }
    const message = entry?.message ?? entry;
    if (!message || message.role !== "user") continue;
    const content = message.content;
    const parts = Array.isArray(content) ? content : [];
    const text = typeof content === "string" ? content : parts.find((part: any) => part?.type === "text")?.text;
    if (text) {
      const title = sessionTitleFromText(text);
      if (title) return title;
    }
    if (parts.some((part: any) => part?.type === "image")) return "图片消息";
    return "新会话";
  }
  return "";
}
