/**
 * 会话标题：默认取自首条用户消息。
 * 长内容必须压缩并截断，否则侧边栏与删除确认弹窗会被整段日志/代码撑爆。
 */

export const SESSION_TITLE_MAX = 48;

export function sessionTitleFromText(text: unknown): string {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > SESSION_TITLE_MAX ? `${compact.slice(0, SESSION_TITLE_MAX)}…` : compact;
}
