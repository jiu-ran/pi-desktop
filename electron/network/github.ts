import { requestJson } from "./http.ts";

/**
 * GitHub Release 资源对象
 */
export interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
  // GitHub 提供的完整性校验值（例如 sha256:...）
  digest?: string;
}

/**
 * GitHub Release 对象
 */
export interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAsset[];
}

/**
 * 从 GitHub 查询稳定版本的 Release
 *
 * 返回最新的正式版本（非 draft、非 prerelease、版本号格式正确）
 */
export async function fetchStableRelease(
  owner: string,
  repo: string,
  pageSize: number = 20,
): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${pageSize}`;
  const releases = await requestJson<GitHubRelease[]>(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!Array.isArray(releases)) throw new Error("GitHub 返回了无效的版本列表");
  const stable = releases.filter(r => !r.draft && !r.prerelease && /^v?\d+(?:\.\d+){1,3}$/i.test(r.tag_name ?? ""))
    .sort((a, b) => compareVersions(b.tag_name ?? "", a.tag_name ?? ""));
  return stable[0] ?? null;
}

/**
 * 比较两个版本号
 * 返回值：> 0 表示 left 更新，< 0 表示 right 更新，= 0 表示相同
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const a = parse(left);
  const b = parse(right);

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta) return delta;
  }

  return 0;
}

/**
 * 根据当前平台从 Release assets 中选择合适的文件
 *
 * Windows: 优先选择 .exe，其次 .zip
 * macOS:   优先选择 .dmg，其次 .zip
 * Linux:   优先选择 .AppImage，其次 .tar.gz
 */
export function findReleaseAsset(
  assets: GitHubReleaseAsset[] = [],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GitHubReleaseAsset | null {
  const patterns =
    platform === "win32"
      ? [/\.exe$/i, /win.*\.zip$/i]
      : platform === "darwin"
        ? [/\.dmg$/i, /mac.*\.zip$/i]
        : [/\.AppImage$/i, /linux.*\.tar\.gz$/i];

  for (const pattern of patterns) {
    const matching = assets.filter(a => pattern.test(a.name ?? "") && a.browser_download_url);
    const compatible = matching.filter(a => !/(?:arm64|aarch64|x64|x86_64|ia32)(?:[.-]|$)/i.test(a.name ?? "")
      || (arch === "arm64" ? /arm64|aarch64/i.test(a.name ?? "") : arch === "x64" ? /x64|x86_64/i.test(a.name ?? "") : /ia32/i.test(a.name ?? "")));
    const asset = compatible.find(a => (a.name ?? "").includes(arch)) ?? compatible[0];
    if (asset) return asset;
  }

  return null;
}

/**
 * 从 Release asset 的 digest 中提取 SHA-256
 *
 * GitHub 通常提供 sha256:xxxxx 格式的摘要
 */
export function extractSha256FromDigest(digest?: string): string {
  if (!digest) return "";

  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1] : "";
}
