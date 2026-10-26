/**
 * 自动更新开关的判断：检查完之后要不要顺手把安装包下下来。
 *
 * 「自动下载」默认开启——用户装上软件就该自己保持最新，不该被动等他想起来点一下。
 * 但安装不自动：Windows / macOS 安装器会替换正在运行的二进制，必须由用户点
 * 「安装并重启」。所以这里只决定「下载」，安装始终是显式动作。
 */
export interface AutoDownloadSettings {
  /** 设置页「自动下载更新」 */
  appUpdateAuto: boolean;
}

export interface AutoDownloadResult {
  updateAvailable: boolean;
  /** 检查失败（限流 / 断网）时不能去下载，会再踩一次同样的错 */
  error?: string;
}

export function shouldAutoDownloadUpdate(settings: AutoDownloadSettings, result: AutoDownloadResult): boolean {
  if (!settings?.appUpdateAuto) return false;
  if (result?.error) return false;
  return Boolean(result.updateAvailable);
}

