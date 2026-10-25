import assert from "node:assert/strict";
import { normalizeNetworkError } from "../../electron/network/errors.ts";
import { RateLimitError, rateLimitMessage, shouldRetryStatus } from "../../electron/network/rate-limit.ts";

// 限流处理：4xx 不重试、提示带恢复时间、恢复前不再发请求
// （GitHub 匿名接口每 IP 每小时 60 次，重启应用不会重置）
assert.equal(shouldRetryStatus(403, 0, 2), false, "403 不该重试");
assert.equal(shouldRetryStatus(429, 1, 2), false, "429 不该重试");
assert.equal(shouldRetryStatus(500, 0, 2), true, "5xx 仍要重试");
assert.equal(shouldRetryStatus(500, 2, 2), false, "重试次数用完就停");

const now = new Date("2026-10-25T10:00:00Z").getTime();
const resetAt = new Date("2026-10-25T10:57:00Z").getTime();
const msg = rateLimitMessage(resetAt, now);
assert.ok(/\d{1,2}:\d{2}/.test(msg) && msg.includes("恢复"), `限流提示要带恢复时间：${msg}`);
assert.equal(rateLimitMessage(0, now), "服务器限制请求频率，请稍后重试", "没有恢复时间时退回通用文案");
assert.equal(
  normalizeNetworkError(new RateLimitError(403, resetAt, msg)),
  rateLimitMessage(resetAt),
  "限流错误要保留恢复时间",
);
assert.equal(normalizeNetworkError(new Error("HTTP 404: Not Found")), "下载资源不存在或已被删除");
assert.equal(normalizeNetworkError(new Error("SSL certificate problem")), "SSL 证书验证失败，请检查网络环境");

console.log("network.check ok 4xx 不重试 / 限流提示带恢复时间 / 错误文案");
