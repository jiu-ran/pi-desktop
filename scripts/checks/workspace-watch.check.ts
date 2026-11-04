import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isWatchedRelative,
  parentDirectoryOf,
  WorkspaceWatcher,
  type WorkspaceDiskChange,
} from "../../electron/workspace-watch.ts";

// 纯函数：哪些路径值得通知界面
assert.equal(parentDirectoryOf("a/b/c.txt"), "a/b");
assert.equal(parentDirectoryOf("c.txt"), "", "顶层项属于根目录");
assert.equal(parentDirectoryOf("a\\b\\c.txt"), "a/b", "Windows 的反斜杠也要归一");
assert.equal(parentDirectoryOf("/a/b/c.txt"), "a/b");

assert.equal(isWatchedRelative("src/index.ts"), true);
assert.equal(isWatchedRelative("src\\index.ts"), true);
assert.equal(isWatchedRelative(""), false);
assert.equal(isWatchedRelative("node_modules/x/y.js"), false);
assert.equal(isWatchedRelative("packages/ui/node_modules/x/y.js"), false, "嵌套的 node_modules 同样忽略");
assert.equal(isWatchedRelative(".git/HEAD"), false);
assert.equal(isWatchedRelative(".gitrefs/heads/main"), true, "只有真正的 .git 目录名才忽略");
assert.equal(isWatchedRelative(".pi/agent.json"), false);
assert.equal(isWatchedRelative(".pi-desktop/logs/app.log"), false);
assert.equal(isWatchedRelative("src/.readme.md.pi-0123456789abcdef.tmp"), false, "原子写的临时文件不通知");
assert.equal(isWatchedRelative("src/.readme.md.pi-notatemp.tmp"), true, "不是我们的临时文件就照常通知");

// 真监听：临时目录里造文件，看回调收到什么
const root = await mkdtemp(path.join(tmpdir(), "pi-watch-"));
const changes: WorkspaceDiskChange[] = [];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const watcher = new WorkspaceWatcher((change) => changes.push(change), 120);
try {
  await mkdir(path.join(root, "src"), { recursive: true });
  watcher.watch(root);
  watcher.watch(root);
  assert.deepEqual(watcher.roots(), [path.resolve(root)], "重复 watch 不重复挂");

  await writeFile(path.join(root, "src", "a.ts"), "a\n", "utf8");
  await wait(500);
  const first = changes.at(-1);
  assert.ok(first, "写文件应该触发一次回调");
  // Windows 会顺带报一次父目录自身的 mtime 变化（`src` → 根目录），所以这里只要求
  // 「该重读的目录里有 src」，不假定只有它一个。
  assert.ok(first!.directories.includes("src"), `directories=${first!.directories.join(",")}`);
  assert.ok(first!.relativePaths.includes("src/a.ts"), `relativePaths=${first!.relativePaths.join(",")}`);

  // 被忽略的目录：不打扰界面
  const beforeIgnored = changes.length;
  await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "x", "index.js"), "1\n", "utf8");
  await wait(400);
  assert.equal(changes.length, beforeIgnored, "node_modules 里的动静不该通知");

  // 去抖：同一批写入合并成一次回调
  const beforeBatch = changes.length;
  await writeFile(path.join(root, "a.txt"), "1\n", "utf8");
  await writeFile(path.join(root, "b.txt"), "2\n", "utf8");
  await wait(500);
  const batch = changes.slice(beforeBatch);
  assert.equal(batch.length, 1, `同一批写入应合并成一次，实际 ${batch.length}`);
  assert.ok(batch[0].directories.includes(""), "顶层文件变化 → 根目录要重读");
  assert.ok(batch[0].relativePaths.includes("a.txt") && batch[0].relativePaths.includes("b.txt"));

  // unwatch 之后彻底安静
  watcher.unwatch(root);
  assert.deepEqual(watcher.roots(), []);
  const beforeUnwatch = changes.length;
  await writeFile(path.join(root, "c.txt"), "3\n", "utf8");
  await wait(400);
  assert.equal(changes.length, beforeUnwatch, "unwatch 之后不该再有回调");
} finally {
  watcher.closeAll();
  await rm(root, { recursive: true, force: true });
}

console.log("workspace-watch OK 忽略规则 / 父目录归一 / 真监听 / 去抖合并 / unwatch");
