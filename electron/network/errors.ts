/**
 * 网络错误的用户可读文案（纯函数，方便单测；不 import electron）。
 */
import { RateLimitError, rateLimitMessage } from "./rate-limit.ts";

export function normalizeNetworkError(error: unknown): string {
  if (error instanceof RateLimitError) return rateLimitMessage(error.retryAt);
  const message = error instanceof Error ? error.message : String(error);
  if (/[\u3400-\u9fff]/.test(message)) return message;
  if (/timeout|超时/i.test(message)) return "请求超时，请检查网络连接";
  if (/aborted|aborterror/i.test(message)) return "操作已取消或请求超时";
  if (/ssl|certificate/i.test(message)) return "SSL 证书验证失败，请检查网络环境";
  if (/HTTP (403|429)/.test(message)) return "服务器限制请求频率，请稍后重试";
  if (/HTTP 404/.test(message)) return "下载资源不存在或已被删除";
  return "网络请求失败，请检查网络或代理设置";
}
