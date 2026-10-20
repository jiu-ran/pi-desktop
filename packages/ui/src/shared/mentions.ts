/**
 * Pi TUI 风格的 `@` 文件引用：
 * 输入 `@` 后从补全列表里选路径，只把 `@相对路径` 作为普通文本插进输入框，
 * 不读取文件内容、不生成附件；模型需要时自己用 read 工具按需读取。
 *
 * 带空格（或中日韩标点）的路径用引号包起来：`@"my dir/file.ts"`；
 * 目录补全保留结尾的 `/` 且不追加空格，方便继续补全子路径。
 */

export interface MentionToken {
  /** `@` 在文本中的下标 */
  start: number;
  /** 补全查询（不含 `@` 和引号） */
  query: string;
  /** 用户已经输入了开引号 */
  quoted: boolean;
}

/** 与 Pi TUI 一致：空白或 CJK 标点会切断路径，需要引号 */
const SEPARATOR = /[\s\u3000-\u303f\uff00-\uffef]/;

/** 解析输入框末尾的 `@...` 补全标记；不在末尾或前面没有边界时返回 null */
export function parseMentionToken(input: string): MentionToken | null {
  const text = String(input ?? "");
  const match = text.match(/(?:^|\s)@(?:"([^"]*)"?|([^\s]*))$/);
  if (!match || match.index === undefined) return null;
  const quoted = match[1] !== undefined;
  const start = match.index + (match[0].startsWith("@") ? 0 : 1);
  return { start, query: quoted ? match[1]! : match[2] ?? "", quoted };
}

/** 生成要插入的引用文本；`relative` 使用 `/` 分隔，目录以 `/` 结尾 */
export function buildMention(
  relative: string,
  isFolder: boolean,
  quoted = false,
): { text: string; cursor: number; keepOpen: boolean } {
  const path = String(relative ?? "").replace(/\\/g, "/");
  const needsQuotes = quoted || SEPARATOR.test(path);
  const body = needsQuotes ? `@"${path}"` : `@${path}`;
  // 文件后补一个空格结束引用；目录不补，方便继续补全 `dir/child`
  const text = isFolder ? body : `${body} `;
  // 带引号的目录把光标放在右引号前，继续输入的子路径才会留在引号内
  const cursor = needsQuotes && isFolder ? text.length - 1 : text.length;
  return { text, cursor, keepOpen: isFolder };
}

/** 用补全结果替换输入框末尾的 `@query`，返回新文本与光标位置 */
export function applyMention(
  input: string,
  token: MentionToken,
  relative: string,
  isFolder: boolean,
): { text: string; cursor: number; keepOpen: boolean } {
  const mention = buildMention(relative, isFolder, token.quoted);
  const prefix = input.slice(0, token.start);
  return {
    text: `${prefix}${mention.text}`,
    cursor: prefix.length + mention.cursor,
    keepOpen: mention.keepOpen,
  };
}
