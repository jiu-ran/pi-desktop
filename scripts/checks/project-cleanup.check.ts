import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cleanIgnoreLine,
  cleanLegacyProjectArtifacts,
  cleanLogsDir,
  isLegacyLogsDir,
  stripIgnoreLine,
} from "../../electron/project-cleanup.ts";

// 旧版本（0.2.5 / 0.2.6）往项目里写过日志目录，并往 .git/info/exclude 追加过一行；
// 「装个新版本又改了我的东西」就是这两样。这里验证只清理能确认属于我们的部分。
{
  assert.equal(stripIgnoreLine("node_modules/\n.pi-desktop/\ndist/\n").text, "node_modules/\ndist/\n");
  assert.equal(stripIgnoreLine("node_modules/\n").changed, false, "没有那一行时不该改动");
  assert.equal(stripIgnoreLine(".pi-desktop/").text, "", "只有我们那一行时清空");
  assert.equal(stripIgnoreLine(".pi-desktop/sub\n").changed, false, "别的路径不能误删");
  assert.equal(stripIgnoreLine("# .pi-desktop/\n").changed, false, "注释行不能误删");

  assert.equal(isLegacyLogsDir([]), true, "空目录算我们的");
  assert.equal(isLegacyLogsDir(["logs"]), true, "只有 logs 算我们的");
  assert.equal(isLegacyLogsDir(["logs", "notes.txt"]), false, "还有别的东西就不能删");
  assert.equal(isLegacyLogsDir(["other"]), false);
  console.log("project-cleanup OK 忽略行精确匹配 / 目录判定");
}

// 真造一个仓库：有 .git/info/exclude 与 .pi-desktop/logs，跑一次清理
{
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-cleanup-"));
  await mkdir(path.join(cwd, ".git", "info"), { recursive: true });
  await mkdir(path.join(cwd, ".pi-desktop", "logs"), { recursive: true });
  await writeFile(path.join(cwd, ".pi-desktop", "logs", "app.log"), "x");
  await writeFile(path.join(cwd, ".git", "info", "exclude"), "node_modules/\n.pi-desktop/\n");

  assert.equal(await cleanLogsDir(cwd), true, "应删掉只含 logs 的 .pi-desktop");
  assert.equal(await cleanIgnoreLine(cwd), true, "应去掉那行忽略");
  const exclude = await readFile(path.join(cwd, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude, "node_modules/\n", `其它行必须原样保留：${JSON.stringify(exclude)}`);

  // 再跑一次是幂等的（没有可清的东西）
  assert.equal(await cleanLogsDir(cwd), false);
  assert.equal(await cleanIgnoreLine(cwd), false);

  // 有用户自己内容的目录不能被删
  await mkdir(path.join(cwd, ".pi-desktop", "notes"), { recursive: true });
  await writeFile(path.join(cwd, ".pi-desktop", "notes", "mine.md"), "keep");
  assert.equal(await cleanLogsDir(cwd), false, "有用户内容时不能删");
  assert.equal(
    await readFile(path.join(cwd, ".pi-desktop", "notes", "mine.md"), "utf8"),
    "keep",
    "用户内容必须保留",
  );

  // 顶层入口：不抛错
  await cleanLegacyProjectArtifacts(cwd);
  await cleanLegacyProjectArtifacts(path.join(cwd, "does-not-exist"));
  console.log("project-cleanup OK 真实目录清理 / 幂等 / 不碰用户内容");
}
