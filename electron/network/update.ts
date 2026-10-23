import { app, shell } from "electron";
import { spawn } from "node:child_process";
import { mkdir, stat, chmod } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { downloadFileStream, normalizeNetworkError } from "./http.ts";
import {
  fetchStableRelease,
  compareVersions,
  findReleaseAsset,
  extractSha256FromDigest,
  type GitHubReleaseAsset,
} from "./github.ts";

/**
 * 应用更新检查结果
 */
export interface AppUpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url: string;
  assetName: string;
  sha256?: string;
  error?: string;
}

/**
 * 已准备的应用更新
 */
export interface PreparedAppUpdate {
  version: string;
  url: string;
  assetName: string;
  filePath: string;
  sha256?: string;
}

/**
 * 应用更新管理器
 *
 * 负责检查、下载、验证和安装应用更新
 */
export class AppUpdateManager {
  private readonly owner: string;
  private readonly repo: string;
  private readonly preparedUpdates: Map<string, PreparedAppUpdate> = new Map();
  private downloadInProgress: boolean = false;
  private downloadController: AbortController | null = null;
  private installing = false;

  constructor(owner: string, repo: string) {
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * 检查应用更新
   */
  async check(): Promise<AppUpdateCheckResult> {
    const current = app.getVersion();

    try {
      const release = await fetchStableRelease(this.owner, this.repo);

      if (!release) {
        return {
          current,
          latest: "",
          updateAvailable: false,
          url: "",
          assetName: "",
          error: "未发现可用的正式版本",
        };
      }

      const latest = (release.tag_name ?? "").replace(/^v/i, "");
      const asset = findReleaseAsset(release.assets);

      const result: AppUpdateCheckResult = {
        current,
        latest,
        updateAvailable: compareVersions(latest, current) > 0,
        url: release.html_url ?? "",
        assetName: asset?.name ?? "",
        sha256: extractSha256FromDigest(asset?.digest),
      };

      return result;
    } catch (error) {
      return {
        current,
        latest: "",
        updateAvailable: false,
        url: "",
        assetName: "",
        error: normalizeNetworkError(error),
      };
    }
  }

  /**
   * 下载应用更新
   *
   * @param onProgress 进度回调：(current, total) => void
   */
  async download(
    onProgress?: (current: number, total: number) => void,
  ): Promise<PreparedAppUpdate> {
    if (this.downloadInProgress) {
      throw new Error("已有下载任务正在进行中");
    }

    this.downloadInProgress = true;
    const controller = new AbortController();
    this.downloadController = controller;

    try {
      const current = app.getVersion();
      const release = await fetchStableRelease(this.owner, this.repo);

      if (!release) {
        throw new Error("未发现可用的正式版本");
      }

      const latest = (release.tag_name ?? "").replace(/^v/i, "");

      if (compareVersions(latest, current) <= 0) {
        throw new Error("当前已是最新版本");
      }

      const asset = findReleaseAsset(release.assets);

      if (!asset?.browser_download_url || !asset.name) {
        throw new Error("该版本没有适用于当前系统的安装包");
      }

      // 准备下载目录
      const updateDir = path.join(app.getPath("userData"), "updates");
      await mkdir(updateDir, { recursive: true });

      const filePath = path.join(updateDir, path.basename(asset.name));

      // 提取 SHA-256
      let sha256 = extractSha256FromDigest(asset.digest);
      if (!sha256) {
        const checksums = release.assets?.find(item => item.name === "SHA256SUMS.txt");
        if (checksums?.browser_download_url) {
          const response = await (await import("electron")).net.fetch(checksums.browser_download_url, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("无法读取更新校验文件");
          const text = await response.text();
          for (const line of text.split(/\r?\n/)) {
            const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
            if (match?.[2] === asset.name) { sha256 = match[1]; break; }
          }
        }
      }
      if (!sha256) throw new Error("安装包缺少 SHA-256 校验值，请从发布页手动下载");

      // 下载文件
      await downloadFileStream(asset.browser_download_url, filePath, {
        timeout: 300000, // 单块空闲超时 5 分钟（不是总时长）
        maxRetries: 3,
        retryDelay: 2000,
        onProgress,
        verifySha256: sha256,
        signal: controller.signal,
      });

      if (controller.signal.aborted) throw new Error("下载已取消");

      const prepared: PreparedAppUpdate = {
        version: latest,
        url: release.html_url ?? "",
        assetName: asset.name,
        filePath,
        sha256,
      };

      // 保存到内存以便后续安装
      this.preparedUpdates.set(latest, prepared);

      return prepared;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("下载更新失败：已取消");
      }
      const msg = normalizeNetworkError(error);
      throw new Error(`下载更新失败：${msg}`);
    } finally {
      if (this.downloadController === controller) this.downloadController = null;
      this.downloadInProgress = false;
    }
  }

  /**
   * 安装已准备的更新
   */
  async install(version: string): Promise<void> {
    const prepared = this.preparedUpdates.get(version);

    if (!prepared) {
      throw new Error("请先下载并准备更新");
    }

    if (this.installing) throw new Error("更新安装程序已经启动");
    const info = await stat(prepared.filePath);
    if (!info.isFile() || !prepared.sha256) throw new Error("更新安装包失效，请重新下载");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(prepared.filePath)) hash.update(chunk);
    const actual = hash.digest("hex");
    if (actual !== prepared.sha256) throw new Error("安装包在下载后被修改，已阻止执行，请重新下载");
    this.installing = true;
    try {
    if (process.platform === "linux" && /\.AppImage$/i.test(prepared.filePath)) await chmod(prepared.filePath, 0o700);
    if (process.platform === "win32" && /\.exe$/i.test(prepared.filePath)) {
      // Windows NSIS 安装器需要 --updated 才会启用 keep-shortcuts：
      // 否则旧卸载器会删掉桌面快捷方式，再由新安装器重新创建。
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const child = spawn(prepared.filePath, ["--updated"], {
          detached: true,
          stdio: "ignore",
        });
        child.once("spawn", () => {
          settled = true;
          child.unref();
          resolve();
        });
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      });
    } else {
      const error = await shell.openPath(prepared.filePath);
      if (error) {
        throw new Error(`打开安装包失败：${error}`);
      }
    }

    } catch (error) {
      this.installing = false;
      throw error;
    }

    // 300ms 后退出应用，给系统时间启动安装程序
    setTimeout(() => app.quit(), 300);
  }

  /**
   * 取消下载（如果正在进行中）。
   * 只发取消信号，等 download() 的 finally 统一复位状态，
   * 避免在真实下载还没结束时允许第二次下载并发写同一个文件。
   */
  cancelDownload(): boolean {
    if (!this.downloadController) return false;
    this.downloadController.abort();
    return true;
  }

  /**
   * 清理所有已准备的更新（临时文件）
   */
  async cleanup(): Promise<void> {
    this.cancelDownload();
    // 已交给系统的安装包不能在退出时删除（macOS 挂载 dmg / Linux 执行 AppImage）。
    if (this.installing) return;
    const { unlink } = await import("node:fs/promises");

    for (const prepared of this.preparedUpdates.values()) {
      try {
        await unlink(prepared.filePath);
      } catch {
        /* 忽略清理错误 */
      }
    }

    this.preparedUpdates.clear();
  }
}

/**
 * 创建全局应用更新管理器实例
 */
export function createAppUpdateManager(
  owner: string = "jiu-ran",
  repo: string = "pi-desktop",
): AppUpdateManager {
  return new AppUpdateManager(owner, repo);
}
