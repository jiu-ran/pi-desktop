/**
 * 会话引用块（`<session ...>...</session>`）的构造。
 *
 * 主进程自动生成一次，渲染进程在「用户改过上下文」时要按同样的格式重新拼：
 * - `name` 必须是会话文件路径，历史重新渲染时靠它还原成「对话」卡片
 * - `title` 是会话名，`messages` 是条数（卡片上显示「N 条」）
 * 格式一旦不一致，历史里的引用卡片就会退化成一段纯文本，所以两处必须共用这里。
 */

export interface SessionBlockInput {
  file: string;
  title?: string;
  /** 块正文（自动摘要或用户改过的文本） */
  body: string;
  /** 会话总消息条数（卡片上显示） */
  messages?: number;
}

export function escapeSessionXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 拼一个会话引用块；正文按原样保留（用户改过的内容不要再加任何前缀）。 */
export function buildSessionBlock({ file, title = "", body, messages = 0 }: SessionBlockInput): string {
  const name = String(file ?? "");
  const label = String(title ?? "").trim() || "未命名会话";
  const count = Number.isFinite(messages) && messages > 0 ? Math.round(messages) : 0;
  return [
    `<session name="${escapeSessionXml(name)}" title="${escapeSessionXml(label)}" messages="${count}">`,
    String(body ?? "").replace(/\s+$/, ""),
    "</session>",
    "",
  ].join("\n");
}

/**
 * 从完整会话块里取出正文（编辑框只编辑正文，外层 <session> 由发送时重新拼）。
 * 拿不到完整包裹时原样返回，避免把用户的内容吃掉。
 */
export function extractSessionBody(block: string): string {
  const text = String(block ?? "");
  const match = /^\s*<session\b[^>]*>([\s\S]*?)<\/session>\s*$/.exec(text);
  return (match ? match[1]! : text).replace(/^\s*\n/, "").trim();
}

/**
 * 把「自定义正文」的会话引用拼成发送用的上下文。
 * 没有改过正文的引用由主进程生成（能带上更完整的条数说明），这里只处理改过的。
 */
export function buildCustomSessionBlocks(
  items: Array<{ path: string; name?: string; customText?: string; messages?: number }>,
): string {
  return (items ?? [])
    .filter((item) => typeof item.customText === "string" && item.customText.trim())
    .map((item) => buildSessionBlock({ file: item.path, title: item.name, body: item.customText!, messages: item.messages }))
    .join("");
}
