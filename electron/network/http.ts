import { net } from "electron";
import { createHash } from "node:crypto";

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
  } = options;

  const { createWriteStream } = await import("node:fs");
  const { unlink, stat: fsStat } = await import("node:fs/promises");

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

        const contentLength = parseInt(
          response.headers.get("content-length") || "0",
          10,
        );

        // 创建写入流
        const writeStream = createWriteStream(filePath);
        let downloadedSize = 0;

        if (!response.body) {
          throw new Error("响应体为空");
        }

        const reader = response.body.getReader();
        const hash = verifySha256 ? createHash("sha256") : null;

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            downloadedSize += value.length;

            // 更新进度
            if (contentLength > 0 && onProgress) {
              onProgress(downloadedSize, contentLength);
            }

            // 计算哈希
            if (hash) {
              hash.update(value);
            }

            // 写入文件
            writeStream.write(value);
          }
        } finally {
          reader.releaseLock();
        }

        // 等待写入完成
        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          writeStream.end();
        });

        // 验证 SHA-256
        if (verifySha256 && hash) {
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
        // 尝试清理损坏文件
        try {
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
