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

import { open, readFile, stat } from "node:fs/promises";

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

/** 单页最多回溯多少条消息（超长工具链兜底） */
const MAX_PAGE_MESSAGES = 240;

export interface SliceOptions {
  /** 页首至少包含多少条 user 消息（首屏用来凑出完整几轮对话） */
  minTurns?: number;
  /** 页首至少包含多少个可渲染块，避免 8 条原始消息只渲染成 4 行 */
  minBlocks?: number;
}

/**
 * 估算一条原始消息会渲染出多少个块（与 packages/ui transcript 的规则保持一致）：
 * user 记 1；assistant 的 thinking / text / toolCall 各记 1；toolResult 合并进 tool 块记 0。
 */
function countBlocks(message: any): number {
  if (message?.role === "user") return 1;
  if (message?.role === "assistant") {
    let count = 0;
    for (const part of message.content ?? []) {
      if (part?.type === "thinking" && part.thinking?.trim()) count += 1;
      else if (part?.type === "text" && part.text?.trim()) count += 1;
      else if (part?.type === "toolCall") count += 1;
    }
    if (message.stopReason === "error" && message.errorMessage) count += 1;
    return count;
  }
  return 0;
}

/** 逐行解析 JSONL 条目（跳过坏行与空行）。 */
export function parseSessionEntries(text: string): any[] {
  const entries: any[] = [];
  if (!text) return entries;
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
    entries.push(entry);
  }
  return entries;
}

export function parseSessionHistory(text: string): any[] {
  return messagesFromEntries(parseSessionEntries(text));
}

/**
 * 沿最新叶子的 parentId 取当前分支，再抽成可渲染消息列表。
 * v3 JSONL 是树而不是扁平聊天：不能把 fork 前的另一条回复也混入历史；
 * 旧文件没有 parentId 时维持兼容。
 */
export function messagesFromEntries(entries: any[]): any[] {
  const messages: any[] = [];
  if (!entries.length) return messages;
  const linked = entries.filter(entry => entry.type !== "session" && typeof entry.id === "string");
  let branch = entries;
  if (linked.length && linked.some(entry => Object.prototype.hasOwnProperty.call(entry, "parentId"))) {
    const index = new Map(linked.map(entry => [entry.id, entry]));
    const visited = new Set<string>();
    const selected: any[] = [];
    let entry = linked.at(-1);
    while (entry && !visited.has(entry.id)) {
      visited.add(entry.id);
      selected.push(entry);
      entry = typeof entry.parentId === "string" ? index.get(entry.parentId) : undefined;
    }
    branch = selected.reverse();
  }
  for (const entry of branch) {
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
export function sliceHistoryPage(
  history: any[],
  endIndex: number,
  limit: number,
  options: SliceOptions = {},
): HistoryPage {
  const total = history.length;
  const size = Math.max(1, Math.min(Math.trunc(limit) || 8, MAX_PAGE_MESSAGES));
  const requested = Number.isFinite(endIndex) && endIndex > 0 ? Math.trunc(endIndex) : total;
  const end = Math.max(0, Math.min(requested, total));
  let start = Math.max(0, end - size);
  if (start > 0) {
    // 向前对齐到最近的 user 消息，避免把一轮对话从中间切开；
    // 但不能为了对齐突破单页上限，否则首屏会超过 MAX_PAGE_MESSAGES。
    const floor = Math.max(0, end - MAX_PAGE_MESSAGES);
    let probe = start;
    while (probe > floor && history[probe]?.role !== "user") probe -= 1;
    if (probe > 0 && history[probe]?.role === "user" && start - probe <= ALIGN_WINDOW) start = probe;
  }
  // 首屏至少凑够 minTurns 轮对话（从页首往前数 user 消息）
  const minTurns = Math.max(0, Math.trunc(Number(options.minTurns) || 0));
  if (minTurns > 0 && start > 0) {
    let users = 0;
    for (let i = start; i < end; i += 1) if (history[i]?.role === "user") users += 1;
    let probe = start;
    while (users < minTurns && probe > 0 && end - probe < MAX_PAGE_MESSAGES) {
      probe -= 1;
      if (history[probe]?.role === "user") users += 1;
    }
    start = probe;
  }
  // 再保证至少有 minBlocks 个可渲染块：长工具链里 8 条原始消息可能只渲染成 4 行
  const minBlocks = Math.max(0, Math.trunc(Number(options.minBlocks) || 0));
  if (minBlocks > 0 && start > 0) {
    let blocks = 0;
    for (let i = start; i < end; i += 1) blocks += countBlocks(history[i]);
    let probe = start;
    while (blocks < minBlocks && probe > 0 && end - probe < MAX_PAGE_MESSAGES) {
      probe -= 1;
      blocks += countBlocks(history[probe]);
    }
    start = probe;
  }
  return { messages: history.slice(start, end), startIndex: start, endIndex: end, total };
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  /** 已解析到文件的哪个字节位置（永远停在行边界） */
  offset: number;
  entries: any[];
  history: any[];
}

const cache = new Map<string, CacheEntry>();

/** 从 offset 读新增内容，只取完整的行（末尾半行留给下次）。 */
async function readAppended(sessionFile: string, offset: number, size: number): Promise<{ text: string; consumed: number }> {
  const length = size - offset;
  if (length <= 0) return { text: "", consumed: offset };
  const handle = await open(sessionFile, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead);
    const lastBreak = chunk.lastIndexOf(10);
    if (lastBreak < 0) return { text: "", consumed: offset };
    return { text: chunk.subarray(0, lastBreak + 1).toString("utf8"), consumed: offset + lastBreak + 1 };
  } finally {
    await handle.close();
  }
}

function remember(sessionFile: string, entry: CacheEntry): void {
  cache.set(sessionFile, entry);
  if (cache.size > 24) {
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== sessionFile) cache.delete(oldest);
  }
}

/**
 * 读取并解析会话文件历史。
 *
 * 以前文件一变就整份读进来重新 JSON.parse：长会话（实测 85MB / 1.2 万条）要 300ms 以上，
 * 而流式期间文件一直在追加，每次 hydrate / 翻页都要重来一遍——主进程被阻塞，
 * 窗口绘制也跟着停住，表现就是「整个界面卡死」。现在只解析新增的完整行。
 */
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

  // 文件只是变长：只解析新追加的完整行，条目沿用上次结果。
  if (hit && stats.size > hit.offset) {
    const { text, consumed } = await readAppended(sessionFile, hit.offset, stats.size);
    if (consumed > hit.offset) {
      hit.entries.push(...parseSessionEntries(text));
      hit.offset = consumed;
    }
    hit.history = messagesFromEntries(hit.entries);
    hit.size = stats.size;
    hit.mtimeMs = stats.mtimeMs;
    return hit.history;
  }

  const text = await readFile(sessionFile, "utf8");
  const entries = parseSessionEntries(text);
  const history = messagesFromEntries(entries);
  remember(sessionFile, { mtimeMs: stats.mtimeMs, size: stats.size, offset: stats.size, entries, history });
  return history;
}

export async function readSessionHistoryPage(
  sessionFile: string,
  endIndex: number,
  limit = 8,
  minTurns = 0,
  minBlocks = 0,
): Promise<HistoryPage> {
  const history = await readSessionHistory(sessionFile);
  return sliceHistoryPage(history, endIndex, limit, { minTurns, minBlocks });
}

export function clearSessionHistoryCache(sessionFile?: string): void {
  if (sessionFile) cache.delete(sessionFile);
  else cache.clear();
}
