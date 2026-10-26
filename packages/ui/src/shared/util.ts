/** 图标集换成 IBM Carbon（见 `scripts/build-icons.mjs` 与 `shared/icons.ts`）。 */
export { icons, type IconName } from "./icons.ts";

/**
 * 项目路径的可比较键：统一分隔符、去掉末尾斜杠；Windows 盘符路径忽略大小写。
 * 只用于界面去重和“当前项目”判断，不改变实际传给宿主的工作区路径。
 */
export function projectPathKey(value = ""): string {
  const normalized = String(value).trim().replace(/\\/g, "/");
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return /^[A-Za-z]:(?:\/|$)/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function shortPath(value = "", keep = 2): string {
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  return parts.length <= keep ? value : `…/${parts.slice(-keep).join("/")}`;
}

export function baseName(value = ""): string {
  return String(value).split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

/** 隔离工作区目录名带 8 位哈希前缀，展示时去掉；普通项目名不受影响。 */
export function displayProjectName(value = ""): string {
  const name = baseName(value);
  return name.replace(/^[0-9a-f]{8}-/i, "") || name;
}

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

const THINKING_LABELS: Record<string, string> = { off: "关闭", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };

/** 思考等级的中文名；未知等级保留原值，不改变传给 Pi 的协议值。 */
export function thinkingLabel(level: string): string {
  return THINKING_LABELS[level] ?? level;
}

export function formatTokens(value?: number | null): string {
  if (value == null) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function lineCount(text?: string | null): number {
  return text ? String(text).split(/\r?\n/).length : 0;
}
