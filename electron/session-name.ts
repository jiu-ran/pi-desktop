import { open } from "node:fs/promises";
import { sessionTitleFromText } from "./session-title.ts";

const CHUNK_BYTES = 64 * 1024;
// 名称元数据很小；不要为了寻找名称而累积巨大的消息 / 图片 JSON 行。
const MAX_LINE_BYTES = 256 * 1024;

/** 最新 session_info 的空名称表示显式清除，不能再回退到文件头旧名称。 */
function nameFromLine(line: Buffer): string | undefined {
  if (!line.length || !line.includes(Buffer.from('"session_info"'))) return undefined;
  try {
    const entry = JSON.parse(line.toString("utf8"));
    if (entry?.type !== "session_info") return undefined;
    return sessionTitleFromText(typeof entry.name === "string" ? entry.name : "");
  } catch { return undefined; }
}

/** 从文件尾部找最后一条有效名称元数据。跨块拼接按字节进行，不截断 UTF-8。 */
export async function readSessionName(file: string, size: number, legacyName?: unknown): Promise<string> {
  const handle = await open(file, "r");
  let tail = Buffer.alloc(0);
  let skipping = false;
  const append = (part: Buffer) => {
    if (skipping) return;
    if (part.length + tail.length > MAX_LINE_BYTES) { tail = Buffer.alloc(0); skipping = true; return; }
    tail = Buffer.concat([part, tail]);
  };
  try {
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - CHUNK_BYTES);
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
    return sessionTitleFromText(legacyName);
  } finally { await handle.close(); }
}
