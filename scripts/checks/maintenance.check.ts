import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pruneUpdateDir, trimRuntimeCaches } from "../../electron/maintenance.ts";

// 升级后清理：旧安装包只留最新的一个，缓存超阈值才清，而且绝不碰用户数据。
const root = await mkdtemp(path.join(tmpdir(), "pi-maintenance-"));
try {
  const updates = path.join(root, "updates");
  await mkdir(updates, { recursive: true });
  // 造三个「安装包」，mtime 递增：最新的应该被保留。
  const older = path.join(updates, "Pi.Desktop.Setup.0.2.1.exe");
  const middle = path.join(updates, "Pi.Desktop.Setup.0.2.2.exe");
  const newest = path.join(updates, "Pi.Desktop.Setup.0.2.3.exe");
  for (const [index, file] of [older, middle, newest].entries()) {
    await writeFile(file, "installer");
    const time = new Date(Date.now() - (3 - index) * 60_000);
    await utimes(file, time, time);
  }
  // 目录里的非安装包文件不能被误删。
  await writeFile(path.join(updates, "README.txt"), "keep me");

  const removed = await pruneUpdateDir(updates);
  const left = (await readdir(updates)).sort();
  assert.deepEqual(left, ["Pi.Desktop.Setup.0.2.3.exe", "README.txt"], "只保留最新安装包，其他文件不动");
  assert.equal(removed.length, 2, "应删除两个旧安装包");

  // 指定 keep 时按指定保留（下载完立刻清理的场景）。
  await writeFile(older, "installer");
  const removedKeep = await pruneUpdateDir(updates, file_name(older));
  const leftKeep = (await readdir(updates)).sort();
  assert.deepEqual(leftKeep, [file_name(older), "README.txt"], "指定 keep 时应保留该安装包");
  assert.equal(removedKeep.includes(file_name(newest)), true, "未指定的安装包应被删除");

  // 缓存：低于阈值不动，超过阈值清空缓存目录内容但保留目录本身。
  const cache = path.join(root, "Cache");
  await mkdir(path.join(cache, "nested"), { recursive: true });
  await writeFile(path.join(cache, "a.bin"), Buffer.alloc(1024));
  await writeFile(path.join(cache, "nested", "b.bin"), Buffer.alloc(1024));
  const untouched = await trimRuntimeCaches(root, 10 * 1024 * 1024);
  assert.equal(untouched.freed, 0, "低于阈值不应清理");
  assert.equal((await readdir(cache)).length, 2, "低于阈值时缓存文件应保留");

  const trimmed = await trimRuntimeCaches(root, 512);
  assert.ok(trimmed.freed > 0, "超过阈值应清理缓存");
  assert.deepEqual(trimmed.cleared, ["Cache"], "只清理缓存目录");
  assert.deepEqual(await readdir(cache), [], "缓存目录内容应清空");
  assert.ok((await readdir(root)).includes("Cache"), "缓存目录本身应保留（Chromium 认这个路径）");

  // 用户数据不在清理名单里：会话、设置等目录不会被动。
  const sessions = path.join(root, "sessions");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(sessions, "s.jsonl"), "{}");
  await trimRuntimeCaches(root, 1);
  assert.deepEqual(await readdir(sessions), ["s.jsonl"], "会话文件绝不能被清理");

  console.log("maintenance OK 旧安装包 / 缓存阈值 / 不碰用户数据");
} finally {
  await rm(root, { recursive: true, force: true });
}

function file_name(target: string): string {
  return path.basename(target);
}
