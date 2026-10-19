import { app, shell } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
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
      const sha256 = extractSha256FromDigest(asset.digest);

      // 下载文件
      await downloadFileStream(asset.browser_download_url, filePath, {
        timeout: 300000, // 5 分钟超时
        maxRetries: 3,
        retryDelay: 2000,
        onProgress,
        verifySha256: sha256,
      });

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
      const msg = normalizeNetworkError(error);
      throw new Error(`下载更新失败：${msg}`);
    } finally {
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

    // 打开安装包
    const error = await shell.openPath(prepared.filePath);

    if (error) {
      throw new Error(`打开安装包失败：${error}`);
    }

    // 300ms 后退出应用，给系统时间启动安装程序
    setTimeout(() => app.quit(), 300);
  }

  /**
   * 取消下载（如果正在进行中）
   */
  cancelDownload(): void {
    // 注意：当前实现无法中止已发起的 fetch 请求
    // 如需支持，应该在 download() 中保存 AbortController 并在此调用 abort()
    if (this.downloadInProgress) {
      this.downloadInProgress = false;
      // 临时文件会在下载失败时自动清理
    }
  }

  /**
   * 清理所有已准备的更新（临时文件）
   */
  async cleanup(): Promise<void> {
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
