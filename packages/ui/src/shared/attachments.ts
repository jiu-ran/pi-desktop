/**
 * 附件在消息里的内部标记：
 *   <file name="C:\a\b.png"></file>
 *   <file name="C:\a\b.ts">\n...内容...\n</file>
 *   <file name="C:\a\huge.log" size="5242880" inline="false">\n[未内联说明]\n</file>
 *   <directory name="C:\a\dir">\n...目录树...\n</directory>
 *   <session name="C:\...\session.jsonl" title="名称">\n...会话摘要...\n</session>
 * 这些是发给模型的上下文，不该原样显示在气泡里。
 */

export interface MessageAttachment {
  /** 绝对路径（未转义）；引用对话时是会话文件路径 */
  path: string;
  /** 文件名；引用对话时是会话名称 */
  name: string;
  kind: "file" | "folder" | "session";
  /** 文件字节数（旧会话没有该字段） */
  size?: number;
  /** false 表示内容未内联，模型会按需用工具读取 */
  inlined?: boolean;
  /** 引用对话时：这个会话有多少条消息 */
  messages?: number;
  /** 引用对话时：用户改过上下文正文（有值就不再走自动摘要） */
  customText?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function imageDataUrl(mimeType: string | undefined, data: string): string {
  return data.startsWith("data:") ? data : `data:${mimeType || "image/png"};base64,${data}`;
}

const MARKER_PATTERN = /<(file|directory|session) name="([^"]*)"([^>]*)>[\s\S]*?<\/\1>/g;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** 会话块的显示名：主进程把会话名称写在 title 属性里 */
function sessionTitle(attrs: string): string {
  const match = /\btitle="([^"]*)"/.exec(attrs ?? "");
  return match ? unescapeXml(match[1]!) : "";
}

function baseName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
}

/** 去掉正文里的附件标记，并返回附件清单（按出现顺序去重） */
export function splitAttachmentMarkers(input: string): { text: string; attachments: MessageAttachment[] } {
  const text = String(input ?? "");
  if (!text.includes("<file name=") && !text.includes("<directory name=") && !text.includes("<session name=")) {
    return { text: text.trim(), attachments: [] };
  }
  const attachments: MessageAttachment[] = [];
  const seen = new Set<string>();
  const stripped = text.replace(MARKER_PATTERN, (_match, tag: string, rawName: string, attrs: string) => {
    const path = unescapeXml(rawName);
    const key = `${tag}:${path}`;
    if (path && !seen.has(key)) {
      seen.add(key);
      const attachment: MessageAttachment =
        tag === "session"
          ? { path, name: sessionTitle(attrs) || baseName(path), kind: "session" }
          : { path, name: baseName(path), kind: tag === "directory" ? "folder" : "file" };
      const size = /\bsize="(\d+)"/.exec(attrs ?? "");
      if (size) attachment.size = Number(size[1]);
      const messages = /\bmessages="(\d+)"/.exec(attrs ?? "");
      if (messages) attachment.messages = Number(messages[1]);
      if (/\binline="false"/.test(attrs ?? "")) attachment.inlined = false;
      attachments.push(attachment);
    }
    return "\n";
  });
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trim(), attachments };
}
