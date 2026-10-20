/**
 * 附件在消息里的内部标记：
 *   <file name="C:\a\b.png"></file>
 *   <file name="C:\a\b.ts">\n...内容...\n</file>
 *   <directory name="C:\a\dir">\n...目录树...\n</directory>
 * 这些是发给模型的上下文，不该原样显示在气泡里。
 */

export interface MessageAttachment {
  /** 绝对路径（未转义） */
  path: string;
  /** 文件名 */
  name: string;
  kind: "file" | "folder";
}

export function imageDataUrl(mimeType: string | undefined, data: string): string {
  return data.startsWith("data:") ? data : `data:${mimeType || "image/png"};base64,${data}`;
}

const MARKER_PATTERN = /<(file|directory) name="([^"]*)">[\s\S]*?<\/\1>/g;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function baseName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value;
}

/** 去掉正文里的附件标记，并返回附件清单（按出现顺序去重） */
export function splitAttachmentMarkers(input: string): { text: string; attachments: MessageAttachment[] } {
  const text = String(input ?? "");
  if (!text.includes("<file name=") && !text.includes("<directory name=")) {
    return { text: text.trim(), attachments: [] };
  }
  const attachments: MessageAttachment[] = [];
  const seen = new Set<string>();
  const stripped = text.replace(MARKER_PATTERN, (_match, tag: string, rawName: string) => {
    const path = unescapeXml(rawName);
    const key = `${tag}:${path}`;
    if (path && !seen.has(key)) {
      seen.add(key);
      attachments.push({ path, name: baseName(path), kind: tag === "directory" ? "folder" : "file" });
    }
    return "\n";
  });
  return { text: stripped.replace(/\n{3,}/g, "\n\n").trim(), attachments };
}
