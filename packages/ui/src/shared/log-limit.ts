/**
 * 运行日志总量上限的档位与校验（纯函数，设置页与主进程共用同一套规则）。
 *
 * 默认给小的：日志只在排查问题时有用，默认留 8MB 足够，需要时用户可以调大。
 */

export const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const LOG_MAX_CHOICES_MB = [4, 8, 16, 32, 64, 128] as const;

/** 把任意输入收敛到合法值：优先认档位，否则夹到 1MB–128MB。 */
export function normalizeLogMaxBytes(value: unknown): number {
  const mb = Math.round(Number(value) / (1024 * 1024));
  if (LOG_MAX_CHOICES_MB.some((choice) => choice === mb)) return mb * 1024 * 1024;
  const raw = Math.floor(Number(value));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LOG_MAX_BYTES;
  return Math.max(1024 * 1024, Math.min(128 * 1024 * 1024, raw));
}

export function formatLogBytes(bytes: number): string {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1).replace(/\.0$/, "")} MB`;
}
