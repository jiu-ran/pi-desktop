import { net } from "electron";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * 标准化网络错误为用户友好的中文消息
 */
export function normalizeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("timeout")) return "请求超时，请检查网络连接";
    if (msg.includes("enotfound") || msg.includes("econnrefused")) {
      return "无法连接到服务器，请检查网络或代理设置";
    }
    if (msg.includes("aborted")) return "下载被中止";
    if (msg.includes("ssl") || msg.includes("certificate")) {
      return "SSL 证书验证失败，请检查网络环境";
    }
  }
  return "网络请求失败，请重试或检查网络连接";
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface RequestJsonOptions extends RequestOptions {
  signal?: AbortSignal;
}

export interface DownloadOptions extends RequestOptions {
  onProgress?: (current: number, total: number) => void;
  verifySha256?: string;
  /** 外部取消信号（用户取消下载时使用） */
  signal?: AbortSignal;
}

/**
 * 请求 JSON 数据（带超时、重试、错误转换）
 */
export async function requestJson<T = any>(
  url: string,
  options: RequestJsonOptions = {},
): Promise<T> {
  const {
    headers = {},
    timeout = 15000,
    maxRetries = 2,
    retryDelay = 1000,
    signal,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await net.fetch(url, {
          headers: {
            "User-Agent": "Pi-Desktop",
            ...headers,
          },
          signal: signal || controller.signal,
        });

        clearTimeout(timeoutHandle);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data as T;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("未知错误");
}

/**
 * 下载文件到指定路径（带超时、重试、进度回调、SHA-256 校验）
 *
 * 如果提供了 verifySha256，会在下载完成后验证文件的 SHA-256 哈希值。
 * 如果验证失败，会删除文件并抛出异常。
 */
export async function downloadFile(
  url: string,
  filePath: string,
  options: DownloadOptions = {},
): Promise<void> {
  const {
    headers = {},
    timeout = 120000, // 文件下载通常需要更长时间
    maxRetries = 3,
    retryDelay = 2000,
    onProgress,
    verifySha256,
  } = options;

  const { writeFile, unlink } = await import("node:fs/promises");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await net.fetch(url, {
          headers: {
            "User-Agent": "Pi-Desktop",
            ...headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
        const chunks: Uint8Array[] = [];
        let downloadedSize = 0;

        if (!response.body) {
          throw new Error("响应体为空");
        }

        const reader = response.body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            chunks.push(value);
            downloadedSize += value.length;

            if (contentLength > 0 && onProgress) {
              onProgress(downloadedSize, contentLength);
            }
          }
        } finally {
          reader.releaseLock();
        }

        // 将下载的数据写入文件
        const buffer = Buffer.concat(chunks);
        await writeFile(filePath, buffer);

        // 如果指定了 SHA-256，验证文件完整性
        if (verifySha256) {
          const hash = createHash("sha256");
          hash.update(buffer);
          const fileHash = `sha256:${hash.digest("hex")}`;

          if (!fileHash.toLowerCase().includes(verifySha256.toLowerCase())) {
            await unlink(filePath);
            throw new Error(
              `文件校验失败：期望 ${verifySha256}，但得到 ${fileHash}`,
            );
          }
        }

        return;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最后一次尝试或不可重试的错误
      if (attempt === maxRetries) {
        // 尝试清理可能留下的损坏文件
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(filePath).catch(() => {
            /* 忽略文件不存在的错误 */
          });
        } catch {
          /* 忽略清理错误 */
        }
        break;
      }

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  throw lastError || new Error("下载失败");
}

/**
 * 流式下载文件，支持进度回调和 SHA-256 校验
 *
 * 相比 downloadFile，这个版本边下载边写文件，内存占用更低。
 */
export async function downloadFileStream(
  url: string,
  filePath: string,
  options: DownloadOptions = {},
): Promise<void> {
  const {
    headers = {},
    timeout = 120000,
    maxRetries = 3,
    retryDelay = 2000,
    onProgress,
    verifySha256,
    signal: externalSignal,
  } = options;

  const { createWriteStream } = await import("node:fs");
  const { unlink } = await import("node:fs/promises");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let idleTimer: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    try {
      const controller = new AbortController();
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else {
          abortHandler = () => controller.abort();
          externalSignal.addEventListener("abort", abortHandler, { once: true });
        }
      }
      // 空闲超时：每收到一块数据就重新计时，既不会无限挂起，
      // 又不会因为安装包较大而在总时长上误杀正常下载。
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), timeout);
      };
      armIdle();

      try {
        const response = await net.fetch(url, {
          headers: {
            "User-Agent": "Pi-Desktop",
            ...headers,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error("响应体为空");
        }

        const contentLength = parseInt(
          response.headers.get("content-length") || "0",
          10,
        );
        let downloadedSize = 0;
        const hash = verifySha256 ? createHash("sha256") : null;
        const meter = new Transform({
          transform(chunk: any, _encoding, callback) {
            armIdle();
            downloadedSize += chunk.length;
            if (contentLength > 0 && onProgress) {
              onProgress(downloadedSize, contentLength);
            }
            if (hash) hash.update(chunk);
            callback(null, chunk);
          },
        });

        // pipeline 负责背压、错误时销毁写入流，避免半截文件句柄残留。
        await pipeline(
          Readable.fromWeb(response.body as any),
          meter,
          createWriteStream(filePath),
        );

        if (verifySha256 && hash) {
          const fileHash = `sha256:${hash.digest("hex")}`;
          if (!fileHash.toLowerCase().includes(verifySha256.toLowerCase())) {
            await unlink(filePath).catch(() => {});
            throw new Error(
              `文件校验失败：期望 ${verifySha256}，但得到 ${fileHash}`,
            );
          }
        }

        return;
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (externalSignal && abortHandler) externalSignal.removeEventListener("abort", abortHandler);
      }
    } catch (error) {
      if (idleTimer) clearTimeout(idleTimer);
      if (externalSignal && abortHandler) externalSignal.removeEventListener("abort", abortHandler);
      lastError = error instanceof Error ? error : new Error(String(error));

      // 用户主动取消：不再重试，并清掉写了一半的文件
      if (externalSignal?.aborted) {
        await unlink(filePath).catch(() => {
          /* 忽略文件不存在的错误 */
        });
        break;
      }

      // 最后一次尝试或不可重试的错误
      if (attempt === maxRetries) {
        // 尝试清理损坏文件（pipeline 已关闭写入流）
        await unlink(filePath).catch(() => {
          /* 忽略文件不存在的错误 */
        });
        break;
      }

      // 等待后重试
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }
  }

  throw lastError || new Error("下载失败");
}
