import { randomBytes } from "node:crypto";
import { open, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";

/** 同目录写临时文件并替换，避免断电/异常时原文件被截断；保留原有权限。 */
export async function atomicWriteText(file: string, content: string, defaultMode = 0o600): Promise<void> {
  const mode = (await stat(file).catch(() => null))?.mode ?? defaultMode;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.pi-${randomBytes(8).toString("hex")}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", mode & 0o777);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

/** 同一文件的并行检查与保存串行化，防止两个保存同时通过版本校验。 */
const writes = new Map<string, Promise<unknown>>();
export async function withFileWrite<T>(file: string, action: () => Promise<T>): Promise<T> {
  const key = process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const previous = writes.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  writes.set(key, pending);
  try { return await pending; }
  finally { if (writes.get(key) === pending) writes.delete(key); }
}
