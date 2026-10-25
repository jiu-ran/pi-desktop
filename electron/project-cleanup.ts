import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.ts";

/**
 * 清理旧版本留在用户项目里的痕迹。
 *
 * 0.2.5 / 0.2.6 曾把运行日志写到 `<项目>/.pi-desktop/logs`，并顺手往仓库的
 * `.git/info/exclude` 追加一行 `.pi-desktop/`。日志现在已经改到安装目录，
 * 但这两样东西还留在用户的项目里——看起来就像「装个新版本又改了我的东西」。
 *
 * 只清理**能确认是自己留下的**痕迹：
 *   - `.pi-desktop` 目录里除了 `logs` 什么都没有；
 *   - exclude 里存在我们写的那一行（精确匹配）。
 * 有任何其它内容一律不动，只记一条日志。
 */

const IGNORE_LINE = ".pi-desktop/";

/** 去掉我们追加的忽略行；返回新内容与是否改动（其它行原样保留）。 */
export function stripIgnoreLine(text: string): { text: string; changed: boolean } {
  const source = String(text ?? "");
  if (!source.includes(IGNORE_LINE)) return { text: source, changed: false };
  const lines = source.split("\n");
  const kept = lines.filter((line) => line.trim() !== IGNORE_LINE);
  if (kept.length === lines.length) return { text: source, changed: false };
  return { text: kept.join("\n"), changed: true };
}

/** 只含 `logs`（或空）的 .pi-desktop 目录才是我们留下的。 */
export function isLegacyLogsDir(entries: string[]): boolean {
  return entries.every((name) => name === "logs");
}

/** 解析 `.git`（可能是 worktree 里的 gitdir 文件），拿不到就返回空串。 */
async function gitDirOf(cwd: string): Promise<string> {
  const dotGit = path.join(cwd, ".git");
  const info = await stat(dotGit).catch(() => null);
  if (info?.isFile()) {
    const text = await readFile(dotGit, "utf8").catch(() => "");
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    return match ? path.resolve(cwd, match[1]!.trim()) : "";
  }
  return info?.isDirectory() ? dotGit : "";
}

/** 清掉旧版本写进这个仓库的忽略行。 */
export async function cleanIgnoreLine(cwd: string): Promise<boolean> {
  const gitDir = await gitDirOf(cwd);
  if (!gitDir) return false;
  const excludeFile = path.join(gitDir, "info", "exclude");
  const current = await readFile(excludeFile, "utf8").catch(() => "");
  if (!current) return false;
  const { text, changed } = stripIgnoreLine(current);
  if (!changed) return false;
  await writeFile(excludeFile, text).catch(() => {});
  return true;
}

/** 删掉旧版本的日志目录（只在不含别的内容时）。 */
export async function cleanLogsDir(cwd: string): Promise<boolean> {
  const target = path.join(cwd, ".pi-desktop");
  const entries = await readdir(target).catch(() => null);
  if (!entries) return false;
  if (!isLegacyLogsDir(entries)) {
    log.info("cleanup", `${target} 里还有其它内容，保留不删`);
    return false;
  }
  await rm(target, { recursive: true, force: true }).catch(() => {});
  return true;
}

/** 打开项目时调用一次：把旧版本留下的痕迹清掉（失败不影响打开）。 */
export async function cleanLegacyProjectArtifacts(cwd: string): Promise<void> {
  if (!cwd) return;
  try {
    const [removedDir, removedLine] = await Promise.all([cleanLogsDir(cwd), cleanIgnoreLine(cwd)]);
    if (removedDir || removedLine) {
      log.info(
        "cleanup",
        `清理旧版本日志痕迹：${[removedDir ? ".pi-desktop" : "", removedLine ? ".git/info/exclude 里的忽略行" : ""]
          .filter(Boolean)
          .join(" / ")}（${cwd}）`,
      );
    }
  } catch {
    // 清理是顺手做的，失败静默
  }
}
