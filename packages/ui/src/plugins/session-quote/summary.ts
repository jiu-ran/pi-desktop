/**
 * 「@ 引用其它项目的对话」的候选筛选。
 *
 * 数据来自主进程（跨项目只读列举，最多 40 条），这里只做三件事：
 * 排除当前项目（本项目的对话已经在核心候选里）、按关键词过滤、截断。
 * 抽成纯函数是为了能单测：候选顺序与过滤规则很容易写错。
 */

export interface CrossProjectSession {
  id?: string;
  path: string;
  title: string;
  timestamp?: number;
  cwd?: string;
  project?: string;
}

export interface CrossProjectFilterOptions {
  /** 当前项目目录：本项目会话不在这里重复出现 */
  currentCwd?: string;
  /** 输入框里的查询串 */
  query?: string;
  limit?: number;
}

/** 路径比较：统一分隔符，Windows 盘符忽略大小写 */
function comparablePath(value: string): string {
  const normalized = String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * 过滤出「其它项目」的会话。
 * - 与当前项目相同的会话直接排除（避免和核心候选重复）
 * - 查询串按空格分词，全部命中（标题或项目路径）才保留
 */
export function filterCrossProjectSessions(
  list: CrossProjectSession[],
  { currentCwd = "", query = "", limit = 6 }: CrossProjectFilterOptions = {},
): CrossProjectSession[] {
  const current = comparablePath(currentCwd);
  const words = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows: CrossProjectSession[] = [];
  const seen = new Set<string>();
  for (const item of list ?? []) {
    if (!item?.path) continue;
    const path = comparablePath(item.path);
    if (seen.has(path)) continue;
    if (current && item.cwd && comparablePath(item.cwd) === current) continue;
    if (words.length) {
      const haystack = `${item.title ?? ""} ${item.project ?? ""} ${item.cwd ?? ""}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) continue;
    }
    seen.add(path);
    rows.push(item);
    if (rows.length >= limit) break;
  }
  return rows;
}

/** 候选右侧的弱化说明：项目名 + 时间（时间只到天，够区分即可） */
export function sessionHint(item: CrossProjectSession, now = Date.now()): string {
  const project = String(item.project ?? "").trim();
  const stamp = Number(item.timestamp ?? 0);
  if (!stamp) return project;
  const days = Math.floor((now - stamp) / 86_400_000);
  const time = days <= 0 ? "今天" : days === 1 ? "昨天" : `${Math.min(days, 999)} 天前`;
  return project ? `${project} · ${time}` : time;
}
