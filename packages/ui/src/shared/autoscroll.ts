/**
 * 对话区的「贴底跟随」判定。
 *
 * 流式输出时内容一直在长高，程序化滚动和用户滚动会互相打架：
 * 之前用「程序化滚动后 120ms 内的 scroll 事件一律忽略」来区分两者，
 * 但流式输出每几十毫秒就滚一次，这个窗口几乎一直是开的 —— 用户上滑的那次
 * scroll 事件被吞掉，stick 仍然是 true，于是画面又弹回底部（少数情况下才复现，
 * 取决于当时刷新的频率）。
 *
 * 这里改成看值：只要当前 scrollTop 明显偏离我们上次设置的位置，就是用户滚的。
 */

/** 距离底部小于这个像素数就算「还在贴底」 */
export const FOLLOW_THRESHOLD_PX = 72;

/** 判断某次滚动是否已经贴底（scrollTop 会被浏览器 clamp，所以要看实际值） */
export function isAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = FOLLOW_THRESHOLD_PX,
): boolean {
  if (clientHeight <= 0) return true;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/** 这次 scroll 事件是不是我们自己 setScrollTop 引起的（位置没离开我们设的值） */
export function isSelfScroll(currentTop: number, lastAutoTop: number, tolerance = 2): boolean {
  if (!Number.isFinite(lastAutoTop)) return false;
  return Math.abs(currentTop - lastAutoTop) <= tolerance;
}

/** 内容能不能滚动（不够高就谈不上「上滑」） */
export function canScroll(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > 1 && scrollTop >= 0;
}

/**
 * 滚轮向上 = 用户想停下来看历史。
 * 内容本来就不够高时不打断跟随，否则「回到底部」按钮会乱弹。
 */
export function wantsToPauseFollow(
  deltaY: number,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  if (deltaY >= 0) return false;
  if (!canScroll(scrollTop, scrollHeight, clientHeight)) return false;
  return true;
}

/**
 * 排队的贴底帧是否还该执行：
 * - 期间用户没上滑（epoch 未变）；
 * - 仍然贴底，或者这次是强制贴底。
 */
export function shouldRunFollowFrame(options: {
  forced: boolean;
  stick: boolean;
  epochAtSchedule: number;
  epoch: number;
}): boolean {
  if (options.epochAtSchedule !== options.epoch) return false;
  return options.forced || options.stick;
}
