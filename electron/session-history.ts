/**
 * 会话历史解析：把 Pi 的 JSONL 会话文件转成可渲染的消息列表，并支持从末尾往前分页。
 *
 * 会话文件格式（version 3）每行是一条「条目」，不是裸消息：
 *   {"type":"session","version":3,...}
 *   {"type":"model_change",...}
 *   {"type":"message","id":"...","parentId":"...","message":{"role":"user","content":[...]}}
 *   {"type":"compaction",...}
 * 因此必须读取 entry.message.role，而不是顶层 entry.role。
 */

import { readFile, stat } from "node:fs/promises";

export type HistoryRole = "user" | "assistant" | "toolResult";

const HISTORY_ROLES: ReadonlySet<string> = new Set(["user", "assistant", "toolResult"]);

export interface HistoryPage {
  messages: any[];
  /** 本页第一条消息在完整历史中的下标（含） */
  startIndex: number;
  /** 本页结束下标（不含） */
  endIndex: number;
  /** 会话历史总条数（不含 system） */
  total: number;
}

/** 把同一轮对话的助手消息/工具结果尽量保持在同一页，向前最多扩展这么多条 */
const ALIGN_WINDOW = 60;

export function parseSessionHistory(text: string): any[] {
  const messages: any[] = [];
  if (!text) return messages;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: any;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const payload = entry.type === "message" ? entry.message : entry.role ? entry : null;
    if (!payload || typeof payload.role !== "string") continue;
    if (!HISTORY_ROLES.has(payload.role)) continue;
    messages.push(payload);
  }
  return messages;
}

/**
 * 取「结束于 endIndex（不含）」的一页历史。
 * endIndex <= 0 或非有限数时表示取最新的一页（末尾）。
 */
export function sliceHistoryPage(history: any[], endIndex: number, limit: number): HistoryPage {
  const total = history.length;
  const size = Math.max(1, Math.min(Math.trunc(limit) || 8, 200));
  const requested = Number.isFinite(endIndex) && endIndex > 0 ? Math.trunc(endIndex) : total;
  const end = Math.max(0, Math.min(requested, total));
  let start = Math.max(0, end - size);
  if (start > 0) {
    // 向前对齐到最近的 user 消息，避免把一轮对话从中间切开
    let probe = start;
    while (probe > 0 && history[probe]?.role !== "user") probe -= 1;
    if (probe > 0 && history[probe]?.role === "user" && start - probe <= ALIGN_WINDOW) start = probe;
  }
  return { messages: history.slice(start, end), startIndex: start, endIndex: end, total };
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  history: any[];
}

const cache = new Map<string, CacheEntry>();

/** 读取并解析会话文件历史（带 mtime/size 缓存，避免翻页时重复解析大文件） */
export async function readSessionHistory(sessionFile: string): Promise<any[]> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(sessionFile);
  } catch {
    return [];
  }
  if (!stats.isFile()) return [];
  const hit = cache.get(sessionFile);
  if (hit && hit.mtimeMs === stats.mtimeMs && hit.size === stats.size) return hit.history;
  const text = await readFile(sessionFile, "utf8");
  const history = parseSessionHistory(text);
  cache.set(sessionFile, { mtimeMs: stats.mtimeMs, size: stats.size, history });
  if (cache.size > 24) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return history;
}

export async function readSessionHistoryPage(
  sessionFile: string,
  endIndex: number,
  limit = 8,
): Promise<HistoryPage> {
  const history = await readSessionHistory(sessionFile);
  return sliceHistoryPage(history, endIndex, limit);
}

export function clearSessionHistoryCache(sessionFile?: string): void {
  if (sessionFile) cache.delete(sessionFile);
  else cache.clear();
}
