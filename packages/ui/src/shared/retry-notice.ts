/**
 * 自动重连（`auto_retry_*`）提示的文案与倒计时。
 *
 * 以前提示里写死「连接中断，3.0 秒后重试」——这个数字是事件发生那一刻算出来的，
 * 时间在走、数字不动，第二次重试（退避时间更长）还会显示上一轮的旧值，看起来像卡住。
 * 现在文本只说「正在重试（n/m）」，倒计时交给界面按 deadline 逐帧算。
 */

/** 距离下一次重试还有多久（毫秒）；已过点就是 0。 */
export function retryRemainingMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, Math.round(deadlineAt) - now);
}

/** 倒计时文案：还有时间就报剩余秒数（向上取整，避免 0.0 秒抖动），到点后说明正在重试。 */
export function retryCountdownLabel(deadlineAt: number, now = Date.now()): string {
  const remaining = retryRemainingMs(deadlineAt, now);
  if (remaining <= 0) return "正在重试…";
  return `${Math.ceil(remaining / 1000)} 秒后重试`;
}

/** 提示正文：不带死数字，界面再补一个会走的倒计时。 */
export function retryNoticeText(attempt: number, maxAttempts: number): string {
  return `连接中断，正在重试（${attempt}/${maxAttempts}）`;
}

/** 重连成功 / 彻底失败的收尾文案。 */
export function retryResultText(success: boolean, attempt: number, maxAttempts: number, reason: string): string {
  if (success) return `已重新连接（第 ${attempt} 次重试）`;
  return `重试 ${attempt}/${maxAttempts} 失败：${reason || "未知错误"}`;
}

/** 彻底失败的网络提示：标题说清「试了几次都没成」，副标题说下一步做什么。 */
export interface NetworkFailureNotice {
  title: string;
  hint: string;
  /** 已经失败的次数（合并相同提示后的计数，至少 1） */
  attempts: number;
}

/**
 * 断网失败卡的文案。
 *
 * 只写「网络连接失败 ×2」看不出严重程度：是重试了两次都失败，还是两条不同的错误？
 * 所以把次数写进标题（×N 徽标随之省略），再补一句可以怎么办。
 */
export function networkFailureNotice(count = 1): NetworkFailureNotice {
  const attempts = Math.max(1, Math.round(Number(count) || 1));
  return {
    title: attempts > 1 ? `网络连接失败 · 重试 ${attempts} 次仍未成功` : "网络连接失败",
    hint: "检查网络或代理后再发一次",
    attempts,
  };
}
