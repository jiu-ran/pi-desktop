/**
 * 对话输入框里的 `!` 命令（Pi TUI 的同一套写法）。
 *
 * - `!command`  → 在项目目录里执行，输出会在下一次提问时作为上下文交给模型
 * - `!!command` → 同样执行，但输出只留在会话记录里，不进入模型上下文
 *
 * 只认开头的 `!`：正文中间的感叹号是普通文字，不能把整段消息当成命令。
 * `body` 保留前缀后面的原始文字（包括空格），输入框展示它时不会吞掉正在输入的空格。
 */
export interface BashInput {
  /** 前缀后面的原始内容，用于输入框展示 */
  body: string;
  /** 实际要执行的命令（去掉首尾空白） */
  command: string;
  excludeFromContext: boolean;
}

export function parseBashInput(input: string): BashInput | null {
  const text = String(input ?? "").trimStart();
  if (!text.startsWith("!")) return null;
  const excludeFromContext = text.startsWith("!!");
  const body = text.slice(excludeFromContext ? 2 : 1);
  return {
    body,
    command: body.trim(),
    excludeFromContext,
  };
}

/** 把「输入框里显示的命令」重新加上模式前缀，供持久化 / 历史记录使用。 */
export function formatBashInput(body: string, excludeFromContext = false): string {
  return `${excludeFromContext ? "!!" : "!"}${String(body ?? "")}`;
}

/** 输入框里看到的内容：去掉模式前缀，其余原样保留。 */
export function bashEditorText(input: string): string {
  return parseBashInput(input)?.body ?? String(input ?? "");
}

/**
 * 用户在输入框里编辑后，重新写回带模式前缀的字符串。
 * `nextBody` 为空表示清空输入框（同时退出 shell 模式）。
 */
export function setBashEditorText(input: string, nextBody: string): string {
  const bash = parseBashInput(input);
  if (!bash) return nextBody;
  if (!nextBody) return "";
  if (!bash.command && nextBody.startsWith("!!")) return nextBody;
  return formatBashInput(nextBody, bash.excludeFromContext);
}

/**
 * 在开头输入一个 `!` 时切换模式：
 * - 普通输入 → `!`（开始 shell 模式）
 * - 空命令的 `!` → `!!`（不进入模型上下文）
 * - 已有命令的 shell 模式不再切换，返回原值（让这个 `!` 作为命令字符）
 */
export function toggleBashMode(input: string): string {
  const bash = parseBashInput(input);
  if (!bash) return formatBashInput(input, false);
  if (!bash.command && !bash.excludeFromContext) return formatBashInput(bash.body, true);
  return input;
}
