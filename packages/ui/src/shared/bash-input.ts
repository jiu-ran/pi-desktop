/**
 * 对话输入框里的 `!` 命令（Pi TUI 的同一套写法）。
 *
 * - `!command`  → 在项目目录里执行，输出会在下一次提问时作为上下文交给模型
 * - `!!command` → 同样执行，但输出只留在会话记录里，不进入模型上下文
 *
 * 只认开头的 `!`：正文中间的感叹号是普通文字，不能把整段消息当成命令。
 */
export interface BashInput {
  command: string;
  excludeFromContext: boolean;
}

export function parseBashInput(input: string): BashInput | null {
  const text = String(input ?? "").trim();
  if (!text.startsWith("!")) return null;
  const excludeFromContext = text.startsWith("!!");
  return {
    command: text.slice(excludeFromContext ? 2 : 1).trim(),
    excludeFromContext,
  };
}
