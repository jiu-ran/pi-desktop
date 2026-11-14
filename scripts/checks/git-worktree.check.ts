import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PiHost } from "../../electron/pi-host.ts";
import { buildWorktreeConflictPrompt } from "../../packages/ui/src/shared/git-changes.ts";

/**
 * 隔离工作区（Git Worktree）回归：创建 / 列表 / 移除、孤儿锁定工作区、
 * 三种策略合并回主分支、冲突自动中止、自定义分支与目录、检出已有分支并克隆会话。
 *
 * 从 git.check.ts 拆出来的：那一个文件跑下来 50 多秒，而这片场景自带一套仓库与
 * 两次提交的准备，拆开后两者在 `run-checks.mjs` 里并行跑，全量回归的墙钟时间砍一半。
 */
const execFileAsync = promisify(execFile);
const root = await realpath(await mkdtemp(path.join(tmpdir(), "pi-desktop-git-wt-")));
const worktreeRoot = await realpath(await mkdtemp(path.join(tmpdir(), "pi-desktop-worktrees-")));
const host = new PiHost({ emit() {}, worktreeRoot });
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const samePath = (a: string, b: string) => {
  const normA = path.resolve(a).replace(/\\/g, "/").toLowerCase();
  const normB = path.resolve(b).replace(/\\/g, "/").toLowerCase();
  return normA === normB;
};
const expectReject = async (run: () => Promise<unknown>, message: string) => {
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  assert(rejected, message);
};

try {
  // 准备：一个带初始提交的仓库；b.txt 已提交、随后被删掉（留着这次未提交删除，
  // 用来验证「主工作区不干净时拒绝合并」）。
  await writeFile(path.join(root, "a.txt"), "one\n");
  await host.gitAction(root, "init");
  await execFileAsync("git", ["config", "user.name", "Pi Check"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "check@example.com"], { cwd: root });
  await writeFile(path.join(root, "b.txt"), "two\n");
  await host.gitAction(root, "stage", { all: true });
  const baseCommit = await host.gitAction(root, "commit", { message: "初始提交" });
  const baseBranch = baseCommit.overview.branch;
  await rm(path.join(root, "b.txt"));

  // 隔离工作区：从 HEAD 派生独立分支与目录，主仓库不受影响
  const created = await host.gitWorktreeCreate(root, "parallel task");
  assert(created.ok && created.worktree.branch.startsWith("pi/"), "应创建 pi/ 分支");
  assert(created.worktree.managed && !created.worktree.primary, "新工作区应标记为 Pi 托管");
  assert(created.worktree.baseBranch === baseBranch, "默认应记录当前基础分支");
  assert(existsSync(created.worktree.path), "隔离工作区目录应存在");
  const occupied = (await host.gitBranches(root)).find(branch => branch.name === created.worktree.branch);
  assert(Boolean(occupied?.worktreePath), "列表应标明 worktree 占用的分支");
  await expectReject(() => host.gitAction(root, "switchBranch", { branch: occupied!.ref }), "不能切换到另一个 worktree 使用的分支");
  const worktrees = await host.gitWorktrees(root);
  assert(worktrees.some((item) => item.primary), "列表应包含主工作区");
  assert(
    worktrees.some((item) => item.managed && samePath(item.path, created.worktree.path)),
    "列表应包含新建的隔离工作区",
  );
  // 从隔离工作区内部调用 gitWorktrees 也应正确识别主工作区与托管状态
  const worktreesFromInside = await host.gitWorktrees(created.worktree.path);
  assert(samePath(worktreesFromInside.find((item) => item.primary)?.path ?? "", root), "在隔离工作区内查询时主工作区仍应是主仓库");
  assert(worktreesFromInside.some((item) => samePath(item.path, created.worktree.path) && item.managed), "在隔离工作区内查询自身仍应是 managed");

  await writeFile(path.join(created.worktree.path, "wt.txt"), "worktree only");
  assert((await host.gitWorktrees(root)).find((item) => samePath(item.path, created.worktree.path))?.dirty === true, "未提交改动应标记为 dirty");
  const mainStatus = (await host.gitOverview(root)).status;
  assert(!mainStatus.some((file) => file.path === "wt.txt"), "隔离工作区的文件不应出现在主仓库状态里");
  await expectReject(() => host.gitWorktreeRemove(root, root), "不能移除主工作区");
  await expectReject(() => host.gitWorktreeRemove(root, worktreeRoot), "非 worktree 目录应被拒绝");
  const removedWorktree = await host.gitWorktreeRemove(root, created.worktree.path, { deleteBranch: true });
  assert(removedWorktree.ok && removedWorktree.branchDeleted && !existsSync(created.worktree.path), "移除并勾选删分支后目录与分支都应被删除");
  assert(
    !(await host.gitBranches(root)).some((b) => b.name === created.worktree.branch),
    "deleteBranch 为 true 时本地分支应一并删除",
  );
  assert(
    !(await host.gitWorktrees(root)).some((item) => item.managed && samePath(item.path, created.worktree.path)),
    "移除后不应再出现在列表里",
  );

  // 测试：移除带 lock 且目录已被外部删除的孤儿工作区（如 JetBrains Air 等外部工具遗留）
  const orphanDir = path.join(worktreeRoot, "orphan-locked-wt");
  await execFileAsync("git", ["worktree", "add", orphanDir, "-b", "orphan-branch"], { cwd: root });
  await execFileAsync("git", ["worktree", "lock", orphanDir, "--reason", "Test locked worktree"], { cwd: root });
  await rm(orphanDir, { recursive: true, force: true });
  assert(!existsSync(orphanDir), "测试孤儿工作区目录已物理删除");
  const orphanListBefore = await host.gitWorktrees(root);
  assert(orphanListBefore.some((item) => samePath(item.path, orphanDir)), "孤儿锁定工作区应被 gitWorktrees 读出");
  const removedOrphan = await host.gitWorktreeRemove(root, orphanDir, { deleteBranch: true });
  assert(removedOrphan.ok && removedOrphan.branchDeleted, "孤儿锁定工作区应能成功强制移除并删除分支");
  const orphanListAfter = await host.gitWorktrees(root);
  assert(!orphanListAfter.some((item) => samePath(item.path, orphanDir)), "移除后孤儿工作区不应再出现");

  // 基于指定阶段（分支 / 提交哈希）创建隔离工作区，并通过 squash / rebase / merge 合并回主分支
  await expectReject(() => host.gitWorktreeCreate(root, "bad-ref", { startPoint: "--help" }), "起点参数不得注入选项");
  await expectReject(() => host.gitWorktreeCreate(root, "bad-ref", { startPoint: "deadbeefdeadbeef" }), "不存在的提交应报错");

  // 1) 基于指定历史提交创建，并用 squash 合并回基础分支
  const firstCommitHash = (await execFileAsync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: root })).stdout.trim();
  const wtSquash = await host.gitWorktreeCreate(root, "squash-feature", {
    startPoint: firstCommitHash,
    baseBranch,
  });
  assert(wtSquash.worktree.baseBranch === baseBranch, "应记录指定的目标基础分支");
  assert(wtSquash.worktree.baseRef === firstCommitHash.slice(0, 7), "从提交创建时 baseRef 应记录短哈希");
  assert(existsSync(path.join(wtSquash.worktree.path, "a.txt")), "从初始提交创建的 worktree 应包含初始文件");
  await writeFile(path.join(wtSquash.worktree.path, "squash-1.txt"), "part 1\n");
  await host.gitAction(wtSquash.worktree.path, "stage", { all: true });
  await host.gitAction(wtSquash.worktree.path, "commit", { message: "squash 提交 1" });
  await writeFile(path.join(wtSquash.worktree.path, "squash-2.txt"), "part 2\n");
  await host.gitAction(wtSquash.worktree.path, "stage", { all: true });
  await host.gitAction(wtSquash.worktree.path, "commit", { message: "squash 提交 2" });
  const wtSquashInfo = (await host.gitWorktrees(root)).find((item) => item.path === wtSquash.worktree.path);
  assert(wtSquashInfo?.ahead === 2 && !wtSquashInfo.dirty, "提交后应统计领先基础分支 2 个提交且工作区干净");

  // 主工作区此时仍有前面未提交的 b.txt 删除：合并应被保护性拒绝，恢复干净后才能合并
  await expectReject(
    () => host.gitWorktreeMerge(wtSquash.worktree.path, { worktreePath: wtSquash.worktree.path, strategy: "squash" }),
    "主工作区有未提交改动时应拒绝合并",
  );
  await execFileAsync("git", ["checkout", "--", "b.txt"], { cwd: root });

  const squashMerged = await host.gitWorktreeMerge(wtSquash.worktree.path, {
    worktreePath: wtSquash.worktree.path,
    strategy: "squash",
    message: "feat: 压缩合并两个提交",
  });
  assert(squashMerged.ok && !squashMerged.conflict && squashMerged.targetBranch === baseBranch, "squash 合并应成功");
  assert(existsSync(path.join(root, "squash-1.txt")) && existsSync(path.join(root, "squash-2.txt")), "squash 合并后主工作区应包含新文件");
  const latestSubject = (await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: root })).stdout.trim();
  assert(latestSubject === "feat: 压缩合并两个提交", "squash 合并应使用指定提交说明生成单个提交");
  await host.gitWorktreeRemove(root, wtSquash.worktree.path, { deleteBranch: true });

  // 2) 基于分支创建，主分支也有新提交时通过 rebase 线性合并
  const wtRebase = await host.gitWorktreeCreate(root, "rebase-bugfix", {
    startPoint: `refs/heads/${baseBranch}`,
  });
  await writeFile(path.join(wtRebase.worktree.path, "rebase-fix.txt"), "fixed\n");
  await host.gitAction(wtRebase.worktree.path, "stage", { all: true });
  await host.gitAction(wtRebase.worktree.path, "commit", { message: "fix: 修复问题" });
  // 主工作区同时推进一个不冲突的提交
  await writeFile(path.join(root, "main-advance.txt"), "main\n");
  await host.gitAction(root, "stage", { all: true });
  await host.gitAction(root, "commit", { message: "chore: 主分支推进" });
  const rebaseMerged = await host.gitWorktreeMerge(root, {
    worktreePath: wtRebase.worktree.path,
    strategy: "rebase",
  });
  assert(rebaseMerged.ok && existsSync(path.join(root, "rebase-fix.txt")), "rebase 合并应线性快进合入主工作区");
  await host.gitWorktreeRemove(root, wtRebase.worktree.path, { deleteBranch: true });

  // 3) 冲突场景：自动中止合并、保持主工作区与隔离工作区干净，并生成交给 Pi 的解冲突提示词
  const wtConflict = await host.gitWorktreeCreate(root, "conflict-task", {
    startPoint: `refs/heads/${baseBranch}`,
  });
  const branchesWithWorktree = await host.gitBranches(root);
  const currentRootBranch = branchesWithWorktree.find((b) => b.current);
  const occupiedWorktreeBranch = branchesWithWorktree.find((b) => b.name === wtConflict.worktree.branch);
  assert(Boolean(currentRootBranch) && currentRootBranch!.worktreePath === "", "当前工作区分支的 worktreePath 应为空，避免误显示已被其他工作区占用");
  assert(Boolean(occupiedWorktreeBranch?.worktreePath), "其他 worktree 检出的分支应标记 worktreePath");
  await writeFile(path.join(wtConflict.worktree.path, "a.txt"), "from-worktree-line\n");
  await host.gitAction(wtConflict.worktree.path, "stage", { all: true });
  await host.gitAction(wtConflict.worktree.path, "commit", { message: "feat: 工作区修改 a.txt" });
  await writeFile(path.join(root, "a.txt"), "from-main-line\n");
  await host.gitAction(root, "stage", { all: true });
  await host.gitAction(root, "commit", { message: "feat: 主分支修改 a.txt" });

  for (const strategy of ["squash", "merge", "rebase"] as const) {
    const conflictRes = await host.gitWorktreeMerge(root, {
      worktreePath: wtConflict.worktree.path,
      strategy,
    });
    assert(!conflictRes.ok && conflictRes.conflict, `${strategy} 遇到冲突时应返回 conflict: true`);
    assert(Boolean(conflictRes.conflicts?.includes("a.txt")), `${strategy} 冲突列表应包含 a.txt`);
    assert((await host.gitOverview(root)).status.length === 0, `${strategy} 冲突中止后主工作区必须保持干净`);
    assert((await host.gitOverview(wtConflict.worktree.path)).status.length === 0, `${strategy} 冲突中止后隔离工作区必须保持干净`);
  }
  const conflictPrompt = buildWorktreeConflictPrompt({
    worktreeBranch: wtConflict.worktree.branch,
    targetBranch: baseBranch,
    conflicts: ["a.txt"],
  });
  assert(
    conflictPrompt.includes(`git rebase ${baseBranch}`) && conflictPrompt.includes("a.txt"),
    "冲突提示词应包含目标分支 rebase 指令与冲突文件名",
  );
  await host.gitWorktreeRemove(root, wtConflict.worktree.path, { deleteBranch: true });

  // 4) 自定义分支名、自定义目录、检出已有分支与克隆会话测试
  const customWtParent = await realpath(await mkdtemp(path.join(tmpdir(), "pi-wt-custom-")));
  try {
    const customTargetDir = path.join(customWtParent, "my-custom-wt");
    const wtCustom = await host.gitWorktreeCreate(root, "custom-task", {
      branchMode: "create",
      branchName: "feat/custom-branch-name",
      startPoint: `refs/heads/${baseBranch}`,
      baseBranch,
      targetDir: customTargetDir,
    });
    assert(wtCustom.worktree.branch === "feat/custom-branch-name", "应支持用户自定义分支名称（不强制 pi/ 前缀）");
    assert(wtCustom.worktree.managed, "自定义目录创建的 Worktree 也应标记为 managed: true");
    await host.gitWorktreeRemove(root, wtCustom.worktree.path, { deleteBranch: false });

    // 检出刚才保留下来的已有本地分支 feat/custom-branch-name，并测试克隆加载对话
    const encodedRoot = `--${[...path.resolve(root)].map((ch) => ("\\/:".includes(ch) ? "-" : ch)).join("").replace(/^-/, "")}--`;
    const agentDir = process.env.PI_CODING_AGENT_DIR || path.join((await import("node:os")).homedir(), ".pi", "agent");
    const rootSessDir = path.join(agentDir, "sessions", encodedRoot);
    await (await import("node:fs/promises")).mkdir(rootSessDir, { recursive: true });
    const sampleSessionFile = path.join(rootSessDir, "2026-10-29T00-00-00-000Z_test-wt-session.jsonl");
    await writeFile(
      sampleSessionFile,
      [
        JSON.stringify({ type: "session", version: 3, id: "test-wt-session", timestamp: "2026-10-29T00:00:00.000Z", cwd: root }),
        JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "在隔离工作区继续这个对话" }] } }),
      ].join("\n") + "\n",
    );
    const wtExisting = await host.gitWorktreeCreate(root, "existing-branch-task", {
      branchMode: "existing",
      existingBranch: "refs/heads/feat/custom-branch-name",
      baseBranch,
      sourceSessionFile: sampleSessionFile,
    });
    assert(wtExisting.worktree.branch === "feat/custom-branch-name", "应支持检出已有本地分支创建 Worktree");
    assert(Boolean(wtExisting.sessionFile) && existsSync(wtExisting.sessionFile!), "创建 Worktree 时应支持克隆会话文件");
    const wtSessions = await host.sessions(wtExisting.worktree.path);
    assert(wtSessions.some((s) => s.title.includes("在隔离工作区继续这个对话")), "新 Worktree 的会话列表应包含已克隆的对话");
    await host.gitWorktreeRemove(root, wtExisting.worktree.path, { deleteBranch: true });
    await (await import("node:fs/promises")).unlink(sampleSessionFile).catch(() => {});
  } finally {
    await rm(customWtParent, { recursive: true, force: true });
  }

  console.log("git-worktree OK", baseBranch);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(worktreeRoot, { recursive: true, force: true });
}
