import { open, stat } from "node:fs/promises";
import { sessionTitleFromText } from "./session-title.ts";

const CHUNK_BYTES = 64 * 1024;
// 名称元数据很小；不要为了寻找名称而累积巨大的消息 / 图片 JSON 行。
const MAX_LINE_BYTES = 256 * 1024;
/**
 * 冷启动时最多回看这么多字节。
 *
 * 以前找不到 session_info 就会一路扫到文件开头：一个 80MB、从没重命名过的会话
 * 要扫 200ms 以上，而会话列表在流式期间会反复刷新，主进程被连续阻塞，
 * 表现出来就是整个窗口卡住不动（窗口绘制同样在主进程）。
 * 名称都是追加在文件末尾的，回看 2MB 足够覆盖近期的重命名。
 */
const COLD_SCAN_BYTES = 2 * 1024 * 1024;

interface NameCache {
  size: number;
  mtimeMs: number;
  name: string;
  /** 已扫描区域末尾一小段的指纹：用来识别「文件被重写但变长了」 */
  tail: number;
}

/** 在 [from, to) 取一小段做指纹，用于判断上次扫描的位置是否还成立。 */
async function tailFingerprint(file: string, size: number): Promise<number> {
  const length = Math.min(1024, size);
  if (length <= 0) return 0;
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    let hash = 2166136261;
    for (let i = 0; i < bytesRead; i += 1) {
      hash ^= buffer[i]!;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  } finally {
    await handle.close();
  }
}

/** 每个文件上次的扫描结果与文件长度：追加时只扫新增的尾部。 */
const cache = new Map<string, NameCache>();

/** 最新 session_info 的空名称表示显式清除，不能再回退到文件头旧名称。 */
function nameFromLine(line: Buffer): string | undefined {
  if (!line.length || !line.includes(Buffer.from('"session_info"'))) return undefined;
  try {
    const entry = JSON.parse(line.toString("utf8"));
    if (entry?.type !== "session_info") return undefined;
    return sessionTitleFromText(typeof entry.name === "string" ? entry.name : "");
  } catch { return undefined; }
}

/**
 * 在 [from, to) 范围内从尾部往前找最后一条 session_info；
 * 找不到返回 undefined（调用方决定用缓存还是文件头名称）。
 */
async function scanRange(file: string, from: number, to: number): Promise<string | undefined> {
  if (to <= from) return undefined;
  const handle = await open(file, "r");
  let tail = Buffer.alloc(0);
  let skipping = false;
  const append = (part: Buffer) => {
    if (skipping) return;
    if (part.length + tail.length > MAX_LINE_BYTES) { tail = Buffer.alloc(0); skipping = true; return; }
    tail = Buffer.concat([part, tail]);
  };
  try {
    let end = to;
    while (end > from) {
      const start = Math.max(from, end - CHUNK_BYTES);
      const buffer = Buffer.allocUnsafe(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let right = bytesRead;
      for (let i = bytesRead - 1; i >= 0; i--) {
        if (buffer[i] !== 10) continue;
        append(buffer.subarray(i + 1, right));
        if (!skipping) {
          const name = nameFromLine(tail);
          if (name !== undefined) return name;
        }
        tail = Buffer.alloc(0);
        skipping = false;
        right = i;
      }
      append(buffer.subarray(0, right));
      end = start;
    }
    if (!skipping) {
      const name = nameFromLine(tail);
      if (name !== undefined) return name;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * 从文件尾部找最后一条有效名称元数据。跨块拼接按字节进行，不截断 UTF-8。
 *
 * 成本是「新增字节」级别：同一文件、长度只增不减时只扫新追加的尾部；
 * 冷启动最多回看 COLD_SCAN_BYTES，找不到就用文件头里的旧名称。
 */
export async function readSessionName(file: string, size: number, legacyName?: unknown): Promise<string> {
  const legacy = sessionTitleFromText(legacyName);
  // 用 stat 校验缓存：文件可能被重写成同样大小（会话被重写 / 压缩），只看 size 会读到旧名称。
  let actualSize = size;
  let mtimeMs = 0;
  try {
    const info = await stat(file);
    actualSize = info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    // 读不到 stat 时按传入大小处理，调用方通常刚 stat 过。
  }
  const cached = cache.get(file);
  if (cached && cached.size === actualSize && cached.mtimeMs === mtimeMs) return cached.name;

  // 只有「确认是同一份文件在尾部追加」才走增量；文件被重写时靠指纹识别。
  const appended = Boolean(cached && actualSize > cached.size)
    && (await tailFingerprint(file, cached!.size)) === cached!.tail;
  if (cached && appended) {
    const found = await scanRange(file, cached.size, actualSize);
    const name = found ?? cached.name;
    cache.set(file, { size: actualSize, mtimeMs, name, tail: await tailFingerprint(file, actualSize) });
    return name;
  }

  const found = await scanRange(file, Math.max(0, actualSize - COLD_SCAN_BYTES), actualSize);
  const name = found ?? legacy;
  cache.set(file, { size: actualSize, mtimeMs, name, tail: await tailFingerprint(file, actualSize) });
  if (cache.size > 200) {
    // 只保留最近的若干个文件，避免长跑后无限增长。
    const oldest = cache.keys().next().value;
    if (oldest && oldest !== file) cache.delete(oldest);
  }
  return name;
}

/** 会话文件被删除 / 重写时清掉缓存（测试也用它隔离用例）。 */
export function forgetSessionName(file?: string): void {
  if (file) cache.delete(file);
  else cache.clear();
}
