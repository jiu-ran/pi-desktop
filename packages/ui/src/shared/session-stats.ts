import { formatTokens } from "./util.ts";

/**
 * 会话用量格式化。
 *
 * 思路来自 ThinkRail（JetBrains/thinkrail，Apache-2.0）的
 * `apps/web/src/chat/SessionStatsBar.tsx`，这里只保留纯格式化函数，
 * 数据仍由 pi 的 `getSessionStats` 提供，前端不做额外累加。
 */

export interface SessionTokens {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface SessionUsage {
  tokens?: SessionTokens;
  cost?: number;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  contextUsage?: { tokens: number; contextWindow: number; percent: number | null };
}

/** 费用保留 3 位；极小的非零费用显示为 <$0.001，避免看起来像免费。 */
export function formatCost(cost?: number | null): string {
  const value = Number(cost ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "$0.000";
  if (value < 0.001) return "<$0.001";
  return `$${value.toFixed(3)}`;
}

/** 累计用量片段：↑ 输入 · ↓ 输出 · R 缓存读 · W 缓存写 · 费用。 */
export function usageParts(stats: SessionUsage, includeCost = true): string[] {
  const tokens = stats.tokens ?? {};
  const parts: string[] = [];
  if (tokens.input) parts.push(`↑${formatTokens(tokens.input)}`);
  if (tokens.output) parts.push(`↓${formatTokens(tokens.output)}`);
  if (tokens.cacheRead) parts.push(`R${formatTokens(tokens.cacheRead)}`);
  if (tokens.cacheWrite) parts.push(`W${formatTokens(tokens.cacheWrite)}`);
  const cost = Number(stats.cost ?? 0);
  if (includeCost && cost > 0) parts.push(formatCost(cost));
  return parts;
}

/** 上下文占用条，10 格；百分比为空时全部留空。 */
export function contextBar(percent?: number | null, width = 10): string {
  const filled =
    percent == null ? 0 : Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}
