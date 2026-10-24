/**
 * 把「另一个会话」压成能放进提示词的上文（输入框里 `@` 引用对话）。
 *
 * 会话文件本身不适合直接塞给模型：实测长会话 85MB / 1.2 万条，而且里面混着
 * 工具参数、工具结果、内联附件全文。这里只保留「人说的话」和「助手的回复」，
 * 每条截断、总体封顶，中间省略的部分只留一个标记。
 */

const MARKER_PATTERN = /<(file|directory|session) name="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g;

export interface SessionDigestOptions {
  /** 单条消息最多保留多少字 */
  perMessageChars?: number;
  /** 整段上文最多多少字 */
  maxChars?: number;
  /** 开头保留几条（通常是这次对话的最初需求） */
  headMessages?: number;
}

export interface SessionDigest {
  text: string;
  /** 有文字可读的消息条数（工具结果会被跳过） */
  total: number;
  /** 实际保留的消息条数 */
  kept: number;
  /** 被省略的消息条数 */
  omitted: number;
}

export const DIGEST_PER_MESSAGE = 700;
export const DIGEST_MAX_CHARS = 12_000;
export const DIGEST_HEAD_MESSAGES = 2;

function clip(value: string, limit: number): string {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…（其后省略 ${text.length - limit} 字）`;
}

/** 附件标记换成一行说明：内联的文件内容可能有几 MB，不能进上文。 */
export function stripAttachmentMarkers(input: string): string {
  return String(input ?? "").replace(MARKER_PATTERN, (_match, tag: string, name: string) => {
    const label = tag === "directory" ? "目录" : tag === "session" ? "对话" : "文件";
    return `[${label}: ${name}]`;
  });
}

/** 从一条消息里抽出可读文本（跳过工具调用与工具结果）。 */
export function messageText(message: any): string {
  const role = String(message?.role ?? "");
  if (role === "toolResult") return "";
  const content = message?.content;
  if (typeof content === "string") return stripAttachmentMarkers(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") parts.push(stripAttachmentMarkers(part.text));
    else if (part.type === "image") parts.push("[图片]");
    // toolCall / thinking 等不进上文：参数通常很长，对理解对话没有帮助。
  }
  return parts.join("\n").trim();
}

/**
 * 生成会话摘要正文。
 *
 * 取舍：开头几条决定「这个会话在做什么」，结尾几条决定「最后结论是什么」，
 * 中间大多是过程性内容，直接省略并写明省略了多少条。
 */
export function formatSessionDigest(messages: any[], options: SessionDigestOptions = {}): SessionDigest {
  const perMessage = options.perMessageChars ?? DIGEST_PER_MESSAGE;
  const maxChars = options.maxChars ?? DIGEST_MAX_CHARS;
  const headCount = Math.max(0, options.headMessages ?? DIGEST_HEAD_MESSAGES);
  const rows: { role: string; text: string }[] = [];
  for (const message of messages ?? []) {
    const text = messageText(message);
    if (!text) continue;
    const role = String(message?.role ?? "");
    rows.push({ role: role === "assistant" ? "助手" : "用户", text: clip(text, perMessage) });
  }
  if (!rows.length) return { text: "（这个会话还没有可读的文字内容）", total: 0, kept: 0, omitted: 0 };

  const head = rows.slice(0, headCount);
  const headChars = head.reduce((sum, row) => sum + row.text.length + row.role.length + 2, 0);
  const tail: typeof rows = [];
  let used = headChars;
  let index = rows.length;
  while (index > head.length) {
    const row = rows[index - 1]!;
    const cost = row.text.length + row.role.length + 2;
    if (used + cost > maxChars) break;
    tail.unshift(row);
    used += cost;
    index -= 1;
  }
  const omitted = Math.max(0, rows.length - head.length - tail.length);
  const lines = head.map((row) => `${row.role}：${row.text}`);
  if (omitted) lines.push(`…（省略中间 ${omitted} 条消息）…`);
  lines.push(...tail.map((row) => `${row.role}：${row.text}`));
  return { text: lines.join("\n\n"), total: rows.length, kept: head.length + tail.length, omitted };
}

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SessionBlockInput extends SessionDigestOptions {
  file: string;
  title?: string;
  messages: any[];
}

/**
 * 拼成 `<session>` 块。
 *
 * `name` 必须是会话文件路径：历史消息重新渲染时按这个属性还原成附件卡片，
 * 标题放在 `title` 里，避免丢掉用户自己起的名字。
 */
export function sessionContextBlock(input: SessionBlockInput): string {
  const digest = formatSessionDigest(input.messages ?? [], input);
  const title = String(input.title ?? "").trim() || "未命名会话";
  const total = Array.isArray(input.messages) ? input.messages.length : 0;
  // 条数要说得清楚：原始消息里大部分是工具结果，不能让人以为「只保留了 73 条」是丢了大半对话。
  const scope = digest.total && digest.total !== total ? `（其中 ${digest.total} 条有文字）` : "";
  const head = [
    `下面是用户通过 @ 引用的另一个会话「${title}」，只保留关键片段：`,
    `共 ${total} 条消息${scope}，这里保留 ${digest.kept} 条${digest.omitted ? `（省略 ${digest.omitted} 条）` : ""}。`,
  ].join("\n");
  return [
    `<session name="${escapeXml(input.file)}" title="${escapeXml(title)}" messages="${total}">`,
    head,
    "",
    digest.text,
    "</session>",
    "",
  ].join("\n");
}
