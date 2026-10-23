/** 超过这个长度的用户消息在已有后续内容时折叠（对齐 ThinkRail 的 500 字规则）。 */
export const LONG_USER_TEXT = 500;

export function shouldCollapseUserText(text: string, hasLater: boolean): boolean {
  return hasLater && text.trim().length > LONG_USER_TEXT;
}
