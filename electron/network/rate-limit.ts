/**
 * 限流相关的纯逻辑（不 import electron，方便单测）。
 *
 * GitHub 匿名接口每个 IP 每小时只有 60 次；以前被限流时既重试 3 次、
 * 又把失败当成「已是最新版本」，用户既看不到新版本也不知道为什么。
 */

/** 4xx 是客户端问题（限流、资源不存在），重试只会更快把配额打光。 */
export function shouldRetryStatus(status: number, attempt: number, maxRetries: number): boolean {
  if (status >= 400 && status < 500) return false;
  return attempt < maxRetries;
}

/** 限流提示要给出恢复时间：重启应用不会重置，是 IP 级配额。 */
export function rateLimitMessage(retryAt: number, now = Date.now()): string {
  if (!Number.isFinite(retryAt) || retryAt <= now) return "服务器限制请求频率，请稍后重试";
  const at = new Date(retryAt);
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  // 配额是按**出口 IP** 算的：走代理时那是代理节点的 IP，可能和别的用户共用，
  // 所以「我自己没查几次」也可能被限流 —— 这一层必须说清楚，否则用户只会以为软件有 bug。
  return `服务器限制请求频率（GitHub 匿名接口每小时 60 次，按出口 IP 计算；走代理时与其他用户共用），约 ${hh}:${mm} 恢复`;
}

/** 带恢复时间的限流错误：调用方可以在恢复前不再发请求。 */
export class RateLimitError extends Error {
  readonly status: number;
  readonly retryAt: number;
  constructor(status: number, retryAt: number, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.status = status;
    this.retryAt = retryAt;
  }
}
