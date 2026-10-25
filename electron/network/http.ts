import { net } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RateLimitError, rateLimitMessage } from "./rate-limit.ts";

export { RateLimitError, rateLimitMessage, shouldRetryStatus } from "./rate-limit.ts";
export { normalizeNetworkError } from "./errors.ts";

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}
export interface RequestJsonOptions extends RequestOptions { signal?: AbortSignal }
export interface DownloadOptions extends RequestJsonOptions {
  onProgress?: (current: number, total: number) => void;
  verifySha256?: string;
  maxBytes?: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("操作已取消")); return; }
    const onAbort = () => { clearTimeout(timer); reject(new Error("操作已取消")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 外部取消与超时必须同时生效；超时持续到 JSON 响应体解析完成。 */
export async function requestJson<T = any>(url: string, options: RequestJsonOptions = {}): Promise<T> {
  const { timeout = 15000, maxRetries = 2, retryDelay = 1000, signal } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);
    try {
      const response = await net.fetch(url, { headers: { "User-Agent": "Pi-Desktop", ...options.headers }, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0);
          const retryAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0;
          if (response.headers.get("x-ratelimit-remaining") === "0" || retryAt > Date.now()) {
            throw new RateLimitError(response.status, retryAt, rateLimitMessage(retryAt));
          }
        }
        const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      // 4xx 立刻失败：限流时重试只会让配额更快打光
      const status = Number((error as any)?.status ?? 0);
      if (status >= 400 && status < 500) throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    if (attempt < maxRetries) await delay(retryDelay * (attempt + 1), signal);
  }
  throw lastError || new Error("网络请求失败");
}

/** 所有文件下载统一走背压流；临时文件验证成功后替换，绝不留下可执行的半截包。 */
export async function downloadFileStream(url: string, filePath: string, options: DownloadOptions = {}): Promise<void> {
  const { timeout = 120000, maxRetries = 3, retryDelay = 2000, signal, onProgress, maxBytes = 2 * 1024 ** 3 } = options;
  const expected = options.verifySha256?.replace(/^sha256:/i, "").toLowerCase();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) throw new Error("无效的 SHA-256 校验值");
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();
    const temporary = `${filePath}.${randomBytes(6).toString("hex")}.part`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    const armIdle = () => { clearTimeout(timer); timer = setTimeout(abort, timeout); };
    armIdle();
    try {
      const response = await net.fetch(url, { headers: { "User-Agent": "Pi-Desktop", ...options.headers }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      if (!response.body) throw new Error("下载响应体为空");
      const total = Number(response.headers.get("content-length")) || 0;
      if (total > maxBytes) throw new Error("下载文件过大");
      let received = 0;
      const hash = createHash("sha256");
      const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
        armIdle(); received += chunk.length;
        if (received > maxBytes) { done(new Error("下载文件过大")); return; }
        hash.update(chunk);
        try { onProgress?.(received, total); done(null, chunk); } catch (error) { done(error as Error); }
      } });
      await pipeline(Readable.fromWeb(response.body as any), meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal: controller.signal });
      if (total && received !== total) throw new Error("下载长度不完整，请重新下载");
      if (expected && hash.digest("hex") !== expected) throw new Error("文件 SHA-256 校验失败，请重新下载");
      controller.signal.throwIfAborted();
      await rename(temporary, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      await unlink(temporary).catch(() => {});
    }
    if (attempt < maxRetries) await delay(retryDelay * (attempt + 1), signal);
  }
  throw lastError || new Error("下载失败");
}

export const downloadFile = downloadFileStream;
