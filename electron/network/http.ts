import { net } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export function normalizeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/[\u3400-\u9fff]/.test(message)) return message;
  if (/timeout|超时/i.test(message)) return "请求超时，请检查网络连接";
  if (/aborted|aborterror/i.test(message)) return "操作已取消或请求超时";
  if (/ssl|certificate/i.test(message)) return "SSL 证书验证失败，请检查网络环境";
  if (/HTTP (403|429)/.test(message)) return "服务器限制请求频率，请稍后重试";
  if (/HTTP 404/.test(message)) return "下载资源不存在或已被删除";
  return "网络请求失败，请检查网络或代理设置";
}

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
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
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
