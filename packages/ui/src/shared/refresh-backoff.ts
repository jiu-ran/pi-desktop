/**
 * 会话列表刷新的重排节奏。
 *
 * 刷新由 Pi 的事件驱动（agent_start / agent_settled / 会话重命名 / 队列变化），
 * 事件密集时如果每次都用 `setTimeout(…, 0)` 重排，就会把主线程刷成自旋：
 * 刷新 → 写回 ws.sessions → 再次触发 → 再刷新。这里给一个最小间隔，
 * 连续重排时按 2 的幂退避，安静下来后自动回到基础间隔。
 */

/** 基础间隔：足够让同一批事件合并成一次刷新，又不影响界面即时性。 */
export const REFRESH_BASE_DELAY = 200;
/** 退避上限：事件风暴时最多也就每 2 秒刷新一次。 */
export const REFRESH_MAX_DELAY = 2000;
/** 安静这么久之后认为这轮风暴结束，重新从基础间隔开始。 */
const RESET_AFTER_MS = 3000;
/** 最多退避到 2^4 = 16 倍，再往上没有意义。 */
const MAX_STREAK = 4;

export interface RefreshBackoff {
  /** 连续重排次数（0 表示上一轮已经安静过） */
  streak: number;
}

export interface RefreshBackoffStep {
  /** 这次应该延迟多少毫秒 */
  delay: number;
  /** 下一次要用的状态 */
  state: RefreshBackoff;
}

/**
 * @param now 当前时间戳
 * @param state 上一次的退避状态
 * @param lastDone 上一次刷新完成的时间戳（0 表示还没完成过）
 */
export function nextRefreshDelay(now: number, state: RefreshBackoff, lastDone = 0): RefreshBackoffStep {
  const idleFor = lastDone > 0 ? now - lastDone : Number.POSITIVE_INFINITY;
  const streak = idleFor >= RESET_AFTER_MS ? 0 : Math.max(0, state.streak);
  const delay = Math.min(REFRESH_BASE_DELAY * 2 ** streak, REFRESH_MAX_DELAY);
  return { delay, state: { streak: Math.min(streak + 1, MAX_STREAK) } };
}
