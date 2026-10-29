/**
 * 输入框的历史记录（↑ / ↓ 翻阅之前发过的内容）。
 *
 * 为什么值得单独放一个纯函数模块：
 * - 「按到最旧一条再按 ↑ 不能跑飞」「翻到底再按 ↓ 要回到原来那半句草稿」这类边界
 *   很容易写错，而它们没有视觉反馈，错了要用户撞上才知道；
 * - 组件里的状态（是否正在 IME 组合、光标在第几行）由组件判断，这里只算「该显示哪一条」。
 */

export const PROMPT_HISTORY_LIMIT = 50;

export interface PromptHistoryState {
  /** 当前浏览到第几条（null = 没在浏览，输入框里是用户自己的草稿） */
  index: number | null;
  /** 开始浏览前用户正在写的内容，翻回底部时还原 */
  draft: string;
}

export const EMPTY_HISTORY_STATE: PromptHistoryState = { index: null, draft: "" };

/** 记一条历史：去掉首尾空白、跳过空内容、连续重复只留一条、超上限丢最旧的。 */
export function appendPromptHistory(history: string[], text: string, limit = PROMPT_HISTORY_LIMIT): string[] {
  const value = String(text ?? "").trim();
  if (!value) return history;
  if (history[history.length - 1] === value) return history;
  const next = [...history, value];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** ↑：从草稿进入历史（最旧一条）或继续往前翻。返回 null 表示没有历史可用。 */
export function recallPrevious(
  history: string[],
  state: PromptHistoryState,
  current: string,
): { state: PromptHistoryState; text: string } | null {
  if (!history.length) return null;
  if (state.index === null) {
    const index = history.length - 1;
    return { state: { index, draft: current }, text: history[index] };
  }
  if (state.index <= 0) return null;
  const index = state.index - 1;
  return { state: { ...state, index }, text: history[index] };
}

/** ↓：往回翻；越过最新一条时还原开始浏览前的草稿。返回 null 表示不在浏览状态。 */
export function recallNext(
  history: string[],
  state: PromptHistoryState,
): { state: PromptHistoryState; text: string } | null {
  if (state.index === null || !history.length) return null;
  if (state.index >= history.length - 1) return { state: { index: null, draft: "" }, text: state.draft };
  const index = state.index + 1;
  return { state: { ...state, index }, text: history[index] };
}

/** 光标是否在首行（↑ 只有在首行时才应该接管，否则多行编辑会翻不了行）。 */
export function caretOnFirstLine(text: string, caret: number): boolean {
  return !text.slice(0, Math.max(0, caret)).includes("\n");
}

/** 光标是否在末行（↓ 同理）。 */
export function caretOnLastLine(text: string, caret: number): boolean {
  return !text.slice(Math.max(0, caret)).includes("\n");
}
