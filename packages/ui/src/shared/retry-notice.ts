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
