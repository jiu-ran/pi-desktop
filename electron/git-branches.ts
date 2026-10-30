import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface GitBranch {
  /** 完整引用，避免同名本地 / 远程分支歧义 */
  ref: string;
  name: string;
  remote: boolean;
  current: boolean;
  hash: string;
  subject: string;
  upstream: string;
  tracking: string;
  /** 在其他 worktree 检出的分支不能重复切换 */
  worktreePath: string;
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await execute("git", args, { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  } catch (error: any) {
    throw new Error(String(error?.stderr || error?.message || error).trim());
  }
}

export async function listGitBranches(root: string): Promise<GitBranch[]> {
  const out = await git(root, ["for-each-ref", "--sort=-committerdate",
    "--format=%(refname)%00%(HEAD)%00%(objectname:short)%00%(subject)%00%(upstream:short)%00%(upstream:track)%00%(worktreepath)%00%(symref)",
    "refs/heads/", "refs/remotes/"]);
  return out.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const [ref, head, hash, subject, upstream, tracking, worktreePath, symbolic] = line.split("\0");
    if (!ref || symbolic || !/^refs\/(heads|remotes)\//.test(ref)) return [];
    return [{ ref, name: ref.replace(/^refs\/(heads|remotes)\//, ""), remote: ref.startsWith("refs/remotes/"),
      current: head === "*", hash, subject, upstream, tracking, worktreePath: head === "*" ? "" : worktreePath }];
  });
}

async function validateName(root: string, value: unknown): Promise<string> {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 240
    || value.startsWith("-") || value === "HEAD" || /[\x00-\x20\x7f]/.test(value)) {
    throw new Error("无效的分支名称（上限 240 字，不能包含空白或以 - 开头）");
  }
  // 使用完整 ref 校验，禁止 @{-1} 等 checkout 表达式、选项及路径参数。
  try { await git(root, ["check-ref-format", `refs/heads/${value}`]); }
  catch { throw new Error("无效的分支名称，不能包含 ..、~、^、:、?、*、[ 或反斜杠等字符"); }
  return value;
}

/** 不提供 force / discard / 自动 stash：切换必须保持文件和索引安全。 */
export async function changeGitBranch(root: string, action: "switchBranch" | "createBranch" | "deleteBranch", payload: {
  branch?: string;
  localName?: string;
  startPoint?: string;
  force?: boolean;
}): Promise<string> {
  const branches = await listGitBranches(root);
  if (action === "deleteBranch") {
    const targetRef = payload.branch?.startsWith("refs/") ? payload.branch : `refs/heads/${payload.branch ?? ""}`;
    const branch = branches.find(item => item.ref === targetRef || (!item.remote && item.name === payload.branch));
    if (!branch) throw new Error("目标分支已不存在，请刷新分支列表");
    if (branch.remote) throw new Error("不能直接删除远程跟踪分支，请仅删除本地分支");
    if (branch.current) throw new Error("不能删除当前所在的分支，请先切换到其他分支");
    if (branch.worktreePath) throw new Error(`此分支正在工作区中使用（${branch.worktreePath}），请先在「工作区」页签移除该工作区`);
    await validateName(root, branch.name);
    try {
      await git(root, ["branch", payload.force ? "-D" : "-d", "--", branch.name]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/not fully merged/i.test(msg)) {
        throw new Error(`分支「${branch.name}」包含尚未合并的提交。若确认丢弃这些提交，请勾选「强制删除」后重试。`);
      }
      throw err;
    }
    return `已删除本地分支 ${branch.name}`;
  }
  if (action === "switchBranch") {
    const branch = branches.find(item => item.ref === payload.branch);
    if (!branch) throw new Error("目标分支已不存在，请刷新分支列表");
    if (branch.current) return `已在分支 ${branch.name}`;
    if (branch.worktreePath) throw new Error(`此分支已在另一工作区使用：${branch.worktreePath}`);
    if (!branch.remote) await validateName(root, branch.name);
    // 重新读取而不信任 UI 快照，未跟踪文件也属于需要保护的改动。
    if ((await git(root, ["status", "--porcelain=v1", "-uall"])).trim()) {
      throw new Error("当前工作区有未提交或未跟踪改动，请先提交或自行暂存到 stash，再切换分支；不会自动丢弃改动");
    }
    if (branch.remote) {
      const name = await validateName(root, payload.localName);
      if (branches.some(item => item.ref === `refs/heads/${name}`)) throw new Error("同名本地分支已存在，请切换本地分支或换一个名称");
      await git(root, ["switch", "-c", name, "--track", branch.ref]);
      return `已创建跟踪 ${branch.name} 的本地分支 ${name} 并切换`;
    }
    await git(root, ["switch", "--no-guess", "--", branch.name]);
    return `已切换到分支 ${branch.name}`;
  }
  const name = await validateName(root, payload.branch);
  if (branches.some(item => item.ref === `refs/heads/${name}`)) throw new Error("同名本地分支已存在");
  // 没有 HEAD 的空仓库不允许在此制造虚假的分支成功状态。
  await git(root, ["rev-parse", "--verify", "HEAD"]);
  const start = payload.startPoint || "HEAD";
  if (start !== "HEAD" && !branches.some(item => item.ref === start || item.name === start)) throw new Error("请选择有效的起点分支");
  if (start !== "HEAD" && (await git(root, ["status", "--porcelain=v1", "-uall"])).trim()) {
    throw new Error("从其他分支新建前请先处理未提交改动");
  }
  await git(root, ["switch", "-c", name, start]);
  return `已新建并切换到分支 ${name}`;
}
