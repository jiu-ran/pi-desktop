import type { ChangeFileItem } from "./diff.ts";
import type { GitStatusFile } from "../env.d.ts";

/**
 * 合并后的变更条目：
 * - Git 状态是事实来源（暂存区 / 工作区 / 未跟踪）
 * - 会话记录只补充「本会话改过」标记和快照 diff，用于已提交或非仓库场景
 */
export interface RepoChange {
  /** 规范化后的绝对路径，用作合并 key */
  absPath: string;
  /** 展示路径：仓库内相对路径（会话独有条目保留原路径） */
  path: string;
  name: string;
  dir: string;
  /** 暂存区状态（porcelain 第一列） */
  index: string;
  /** 工作区状态（porcelain 第二列） */
  worktree: string;
  untracked: boolean;
  /** 本会话中 Agent 通过 edit / write 改过 */
  agentTouched: boolean;
  /** 会话快照（即使已经提交也保留） */
  session?: ChangeFileItem;
}

export interface MergeChangesInput {
  /** 当前项目目录 */
  cwd: string;
  /** Git 仓库根目录（非仓库为空） */
  root?: string;
  status?: GitStatusFile[];
  session?: ChangeFileItem[];
}

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const ANY_ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/])/;

/** 统一分隔符并折叠 `.` / `..`，保证不同来源的路径能对上。 */
export function collapsePath(value: string): string {
  const unified = String(value ?? "").replace(/\\/g, "/");
  const drive = unified.match(/^[a-zA-Z]:/)?.[0] ?? "";
  const rest = drive ? unified.slice(drive.length) : unified;
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${drive}/${parts.join("/")}`;
}

/** 合并用的比较 key：Windows 路径大小写不敏感。 */
export function pathKey(value: string): string {
  const collapsed = collapsePath(value);
  return WINDOWS_ABSOLUTE.test(collapsed) ? collapsed.toLowerCase() : collapsed;
}

/** 把 Git 仓库内相对路径或会话里的绝对路径统一成绝对路径。 */
export function resolveChangePath(cwd: string, base: string, value: string): string {
  const raw = String(value ?? "").replace(/\\/g, "/");
  if (ANY_ABSOLUTE.test(raw)) return collapsePath(raw);
  const prefix = (base || cwd || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return collapsePath(`${prefix}/${raw.replace(/^\.\//, "")}`);
}

export function mergeRepoChanges({ cwd, root, status = [], session = [] }: MergeChangesInput): RepoChange[] {
  const merged = new Map<string, RepoChange>();

  for (const file of status) {
    if (!file?.path) continue;
    const absPath = resolveChangePath(cwd, root ?? "", file.path);
    const path = file.path.replace(/\\/g, "/");
    merged.set(pathKey(absPath), {
      absPath,
      path,
      name: path.split("/").at(-1) ?? path,
      dir: path.split("/").slice(0, -1).join("/"),
      index: file.index ?? " ",
      worktree: file.worktree ?? " ",
      untracked: Boolean(file.untracked),
      agentTouched: false,
    });
  }

  for (const item of session) {
    if (!item?.path) continue;
    const absPath = resolveChangePath(cwd, root ?? "", item.path);
    const key = pathKey(absPath);
    const existing = merged.get(key);
    if (existing) {
      existing.agentTouched = true;
      existing.session = item;
      continue;
    }
    merged.set(key, {
      absPath,
      path: item.path.replace(/\\/g, "/"),
      name: item.name,
      dir: item.dir,
      index: " ",
      worktree: " ",
      untracked: false,
      agentTouched: true,
      session: item,
    });
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** 暂存区有改动（porcelain 第一列不是空格 / 未跟踪） */
export function isStaged(change: RepoChange): boolean {
  return !change.untracked && change.index !== " " && change.index !== "?";
}

/** 工作区有改动（porcelain 第二列不是空格 / 未跟踪） */
export function isUnstaged(change: RepoChange): boolean {
  return !change.untracked && change.worktree !== " " && change.worktree !== "?";
}

/** 只在会话记录里出现、Git 里已经没有的改动（通常是已提交） */
export function isSessionOnly(change: RepoChange): boolean {
  return !change.untracked && !isStaged(change) && !isUnstaged(change) && change.agentTouched;
}

/** 变更列表 / 文件树统一使用的状态字母：U 未跟踪，其余取工作区或暂存区状态。 */
export function badgeCode(change: RepoChange): string {
  if (change.untracked) return "U";
  const code = change.worktree !== " " && change.worktree !== "?" ? change.worktree : change.index;
  const letter = code.trim();
  return letter === "?" ? "U" : letter || "M";
}

/** 状态字母对应的展示分类，决定颜色。 */
export function badgeKind(change: RepoChange): string {
  const code = badgeCode(change);
  if (code === "D") return "删除";
  if (code === "A" || code === "U") return "新增";
  if (code === "R" || code === "C") return "重命名";
  return "修改";
}

/**
 * 隔离工作区合并回基础分支发生冲突时，生成交给该工作区 Pi 解决冲突的提示词。
 */
export function buildWorktreeConflictPrompt({
  worktreeBranch,
  targetBranch,
  conflicts,
}: {
  worktreeBranch: string;
  targetBranch: string;
  conflicts: readonly string[];
}): string {
  const branch = String(worktreeBranch || "").trim() || "HEAD";
  const target = String(targetBranch || "").trim() || "main";
  const files = conflicts.map((file) => String(file).trim()).filter(Boolean);
  const lines = [
    `当前隔离工作区分支 \`${branch}\` 在合并回基础分支 \`${target}\` 时发生冲突（合并已自动中止，主工作区保持干净）。`,
  ];
  if (files.length) {
    lines.push("", "冲突文件：", ...files.map((file) => `- \`${file}\``));
  }
  lines.push(
    "",
    `请在本工作区执行 \`git rebase ${target}\`，逐个解决上述冲突文件后继续变基（\`git add\` 并 \`git rebase --continue\`），不要丢弃双方的有效改动；完成后确认工作区干净，以便重新合并到 \`${target}\`。`,
  );
  return lines.join("\n");
}
