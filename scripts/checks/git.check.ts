import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PiHost } from "../../electron/pi-host.ts";
import { badgeCode, badgeKind, isSessionOnly, isStaged, isUnstaged, mergeRepoChanges, type RepoChange } from "../../packages/ui/src/shared/git-changes.ts";
import { buildChangeTree, flattenChangeTree } from "../../packages/ui/src/shared/git-tree.ts";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-git-"));
const worktreeRoot = await mkdtemp(path.join(tmpdir(), "pi-desktop-worktrees-"));
const host = new PiHost({ emit() {}, worktreeRoot });
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const expectReject = async (run: () => Promise<unknown>, message: string) => {
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  assert(rejected, message);
};

try {
  await writeFile(path.join(root, "a.txt"), "one\n");

  const before = await host.gitOverview(root);
  assert(!before.isRepo, "未初始化的目录不应识别为 Git 仓库");
  assert(before.status.length === 0 && before.commits.length === 0, "非仓库不应返回状态或提交");

  const init = await host.gitAction(root, "init");
  assert(init.ok && init.overview.isRepo, "初始化后应识别为 Git 仓库");
  assert(init.overview.canWrite, "仓库根目录就是项目目录时应允许写操作");
  assert(!init.overview.hasRemote, "新仓库不应有远程仓库");
  assert(!init.overview.hasCommits, "新仓库还没有提交");
  assert(init.overview.status.some((file) => file.untracked && file.path === "a.txt"), "初始化后文件应为未跟踪");

  // 固定提交身份，避免 CI 上缺少全局 git 配置
  await execFileAsync("git", ["config", "user.name", "Pi Check"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "check@example.com"], { cwd: root });
  const configured = await host.gitOverview(root);
  assert(configured.userName === "Pi Check" && configured.userEmail === "check@example.com", "应读取仓库用户配置");

  await expectReject(() => host.gitAction(root, "init"), "重复初始化应被拒绝");

  const staged = await host.gitAction(root, "stage", { paths: ["a.txt"] });
  const stagedFile = staged.overview.status.find((file) => file.path === "a.txt");
  assert(stagedFile?.index === "A" && !stagedFile.untracked, "暂存后应标记为新增且不再是未跟踪");

  await expectReject(() => host.gitAction(root, "commit", { message: "   " }), "空提交信息应被拒绝");
  await expectReject(() => host.gitAction(root, "stage", { paths: ["../escape.txt"] }), "越界路径应被拒绝");
  await expectReject(() => host.gitAction(root, "stage", { paths: [path.join(root, "a.txt")] }), "绝对路径应被拒绝");

  const commit = await host.gitAction(root, "commit", { message: "初始提交" });
  assert(commit.overview.commits.length === 1, "提交后应出现一条历史");
  assert(commit.overview.hasCommits, "提交后 hasCommits 应为 true");
  assert(commit.overview.status.length === 0, "提交后工作区应干净");
  assert(commit.message.includes("已提交"), "提交结果应带提示文案");

  await writeFile(path.join(root, "b.txt"), "two\n");
  const dirty = await host.gitOverview(root);
  assert(dirty.status.length === 1 && dirty.status[0].untracked, "新文件应出现在未跟踪列表");

  const allStaged = await host.gitAction(root, "stage", { all: true });
  assert(allStaged.overview.status.every((file) => !file.untracked), "全部暂存后不应有未跟踪文件");

  const unstaged = await host.gitAction(root, "unstage", { paths: ["b.txt"] });
  assert(unstaged.overview.status.some((file) => file.path === "b.txt" && file.untracked), "取消暂存应回到未跟踪");

  // 删除的文件也要能看 diff（工作区文件已不存在）
  await host.gitAction(root, "stage", { paths: ["b.txt"] });
  await host.gitAction(root, "commit", { message: "加入 b" });
  await rm(path.join(root, "b.txt"));
  const removed = await host.gitOverview(root);
  assert(removed.status.some((file) => file.path === "b.txt" && file.worktree === "D"), "删除后应出现在未暂存删除中");
  const removedDiff = await host.gitInspect(root, "working", "b.txt");
  assert(removedDiff.diff.includes("-two"), "已删除文件也应返回删除 diff");

  await expectReject(() => host.gitAction(root, "push"), "没有远程仓库时推送应报错");
  await expectReject(() => host.gitAction(root, "pull"), "没有上游分支时拉取应报错");
  await expectReject(() => host.gitAction(root, "fetch"), "没有远程仓库时获取应报错");

  // 隔离工作区：从 HEAD 派生独立分支与目录，主仓库不受影响
  const created = await host.gitWorktreeCreate(root, "parallel task");
  assert(created.ok && created.worktree.branch.startsWith("pi/"), "应创建 pi/ 分支");
  assert(created.worktree.managed && !created.worktree.primary, "新工作区应标记为 Pi 托管");
  assert(existsSync(created.worktree.path), "隔离工作区目录应存在");
  const worktrees = await host.gitWorktrees(root);
  assert(worktrees.some((item) => item.primary), "列表应包含主工作区");
  assert(
    worktrees.some((item) => item.managed && item.path === created.worktree.path),
    "列表应包含新建的隔离工作区",
  );
  await writeFile(path.join(created.worktree.path, "wt.txt"), "worktree only");
  const mainStatus = (await host.gitOverview(root)).status;
  assert(!mainStatus.some((file) => file.path === "wt.txt"), "隔离工作区的文件不应出现在主仓库状态里");
  await expectReject(() => host.gitWorktreeRemove(root, root), "不能移除主工作区");
  await expectReject(() => host.gitWorktreeRemove(root, worktreeRoot), "非 worktree 目录应被拒绝");
  const removedWorktree = await host.gitWorktreeRemove(root, created.worktree.path);
  assert(removedWorktree.ok && !existsSync(created.worktree.path), "移除后目录应被删除");
  assert(
    !(await host.gitWorktrees(root)).some((item) => item.managed && item.path === created.worktree.path),
    "移除后不应再出现在列表里",
  );

  // 合并规则：Git 状态为准，会话记录只补标记与快照
  const merged = mergeRepoChanges({
    cwd: root,
    root,
    status: [{ code: "M", index: "M", worktree: " ", path: "a.txt", untracked: false }],
    session: [
      { path: "a.txt", name: "a.txt", dir: "", kind: "修改", added: 1, removed: 0, hunks: [], pending: false },
      { path: "old.txt", name: "old.txt", dir: "", kind: "新增", added: 2, removed: 0, hunks: [], pending: false },
    ],
  });
  const touched = merged.find((item) => item.path === "a.txt");
  assert(Boolean(touched?.agentTouched) && isStaged(touched!) && !isUnstaged(touched!), "同名文件应合并为一条并带上 Agent 标记");
  const committedSession = merged.find((item) => item.path === "old.txt");
  assert(Boolean(committedSession) && isSessionOnly(committedSession!), "Git 里已没有的会话改动应标记为已提交快照");

  // 变更树：目录分层、单链目录压缩、折叠后不再展开子节点
  const change = (file: string): RepoChange => ({
    absPath: `/repo/${file}`,
    path: file,
    name: file.split("/").at(-1) ?? file,
    dir: file.split("/").slice(0, -1).join("/"),
    index: " ",
    worktree: "M",
    untracked: false,
    agentTouched: false,
  });
  const tree = buildChangeTree([
    change("src/main.ts"),
    change("src/app/util.ts"),
    change("README.md"),
  ]);
  assert(tree[0].kind === "folder" && tree[0].count === 2, "目录应聚合文件数量");
  const flat = flattenChangeTree(tree, new Set());
  assert(
    flat.map((row) => `${row.depth}:${row.name}`).join(",") === "0:src,1:app,2:util.ts,1:main.ts,0:README.md",
    "变更树应按目录展开",
  );
  const collapsedRows = flattenChangeTree(tree, new Set(["src"]));
  assert(collapsedRows.length === 2, "折叠目录后应隐藏子节点");
  const compressed = buildChangeTree([change("java/com/juran/App.java")]);
  assert(
    compressed[0].kind === "folder" && compressed[0].name === "java/com/juran" && compressed[0].count === 1,
    "单链目录应压缩成一行",
  );

  // 文件树与版本控制面板共用同一套状态字母
  const badgeSample = (over: Partial<RepoChange>): RepoChange => ({
    absPath: "",
    path: "",
    name: "",
    dir: "",
    index: " ",
    worktree: " ",
    untracked: false,
    agentTouched: false,
    ...over,
  });
  assert(badgeCode(badgeSample({ untracked: true })) === "U", "未跟踪应显示 U");
  assert(badgeKind(badgeSample({ untracked: true })) === "新增", "未跟踪应归为新增");
  assert(badgeCode(badgeSample({ worktree: "D" })) === "D", "工作区删除应显示 D");
  assert(badgeKind(badgeSample({ worktree: "D" })) === "删除", "删除应归为删除");
  assert(badgeCode(badgeSample({ index: "M", worktree: " " })) === "M", "暂存修改应显示 M");
  assert(badgeKind(badgeSample({ index: "M", worktree: " " })) === "修改", "修改应归为修改");

  console.log("git", commit.overview.branch, commit.overview.commits.length, "merged", merged.length);
  console.log("OK");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(worktreeRoot, { recursive: true, force: true });
}
