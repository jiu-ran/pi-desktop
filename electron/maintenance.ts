import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 应用自身的垃圾清理。
 *
 * 目标只有一个：升级到新版本时顺手清掉旧版本留下的无用内容，而不是让它一直累积。
 * 只碰这两类东西，绝不碰会话、设置和用户文件：
 *   1. 更新安装包（每装一个版本就多一个 100MB+ 的包，以前从没删过）；
 *   2. Chromium 运行时缓存（超过阈值才清，清掉后 Chromium 会自己重建）。
 */

/** 安装包文件名模式：清理时只动这些，别碰目录里的其他东西。 */
const INSTALLER_FILE = /\.(exe|msi|dmg|appimage|zip|tar\.gz)$/i;

/** 运行时缓存目录：都不含用户数据，删掉只会让下次启动稍慢一点。 */
const CACHE_DIRS = ["Cache", "Code Cache", "GPUCache", "GrShaderCache", "ShaderCache", "DawnWebGPUCache", "DawnGraphiteCache"];

/** 缓存总量超过这个值才动手：太小的话清理收益还不如重建成本。 */
export const CACHE_LIMIT_BYTES = 512 * 1024 * 1024;

async function sizeOf(target: string, depth = 0): Promise<number> {
  if (depth > 6) return 0;
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  let total = 0;
  let names: string[];
  try {
    names = await readdir(target);
  } catch {
    return 0;
  }
  for (const name of names) total += await sizeOf(path.join(target, name), depth + 1);
  return total;
}

/**
 * 清理旧的更新安装包：只保留 `keep` 指定的文件；不指定时保留最新的一个，
 * 这样用户刚下载还没安装的包不会被删掉。
 */
export async function pruneUpdateDir(dir: string, keep = ""): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const installers = names.filter((name) => INSTALLER_FILE.test(name));
  if (!installers.length) return [];
  let keepName = keep;
  if (!keepName) {
    const times = await Promise.all(
      installers.map(async (name) => {
        try {
          return { name, time: (await stat(path.join(dir, name))).mtimeMs };
        } catch {
          return { name, time: 0 };
        }
      }),
    );
    times.sort((a, b) => b.time - a.time);
    keepName = times[0]?.name ?? "";
  }
  const removed: string[] = [];
  for (const name of installers) {
    if (name === keepName) continue;
    try {
      await rm(path.join(dir, name), { force: true });
      removed.push(name);
    } catch {
      // 正在被安装器占用时删不掉，下次启动再试。
    }
  }
  return removed;
}

/** 缓存超过阈值时清空这些目录的内容（保留目录本身，Chromium 认这个路径）。 */
export async function trimRuntimeCaches(userData: string, limit = CACHE_LIMIT_BYTES): Promise<{ freed: number; cleared: string[] }> {
  const entries: Array<{ name: string; size: number }> = [];
  for (const name of CACHE_DIRS) {
    entries.push({ name, size: await sizeOf(path.join(userData, name)) });
  }
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= limit) return { freed: 0, cleared: [] };
  const cleared: string[] = [];
  let freed = 0;
  for (const entry of entries) {
    if (entry.size === 0) continue;
    const target = path.join(userData, entry.name);
    try {
      const names = await readdir(target);
      for (const name of names) await rm(path.join(target, name), { recursive: true, force: true });
      cleared.push(entry.name);
      freed += entry.size;
    } catch {
      // 被占用就跳过，下次启动再清。
    }
  }
  return { freed, cleared };
}

export interface MaintenanceResult {
  removedInstallers: string[];
  freedBytes: number;
  clearedCaches: string[];
}

/**
 * 启动时执行一次维护：清旧安装包 + 缓存超阈值才清。
 * 任何失败都只记日志，绝不阻塞或影响启动。
 */
export async function runStartupMaintenance(userData: string): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { removedInstallers: [], freedBytes: 0, clearedCaches: [] };
  try {
    result.removedInstallers = await pruneUpdateDir(path.join(userData, "updates"));
  } catch {
    // 忽略：清理失败不影响使用。
  }
  try {
    const trimmed = await trimRuntimeCaches(userData);
    result.freedBytes = trimmed.freed;
    result.clearedCaches = trimmed.cleared;
  } catch {
    // 忽略
  }
  return result;
}
