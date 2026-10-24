import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, appendFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LOG_KEEP_FILES,
  LOG_MAX_FILE_BYTES,
  LOG_MAX_TOTAL_BYTES,
  configureLogs,
  formatLogLine,
  log,
  logStore,
  pickExpiredLogs,
  redactLog,
  shouldRotate,
} from "../../electron/logger.ts";

// 上限就是用户要求的 100MB
assert.equal(LOG_MAX_TOTAL_BYTES, 100 * 1024 * 1024, "总量上限必须是 100MB");
assert.equal(LOG_MAX_FILE_BYTES, 8 * 1024 * 1024);
assert.ok(LOG_KEEP_FILES * LOG_MAX_FILE_BYTES <= LOG_MAX_TOTAL_BYTES, "保留文件总量不能超过 100MB");

// 单文件轮转判定
assert.equal(shouldRotate(LOG_MAX_FILE_BYTES - 1), false);
assert.equal(shouldRotate(LOG_MAX_FILE_BYTES), true);

// 清理策略：按时间删旧的；正在写的文件永不删；总量超限继续删
{
  const files = [
    { name: "app.log", size: 1024, mtimeMs: 10 },        // 正在写
    { name: "app-old1.log", size: 1024, mtimeMs: 1 },
    { name: "app-old2.log", size: 1024, mtimeMs: 2 },
    { name: "app-old3.log", size: 1024, mtimeMs: 3 },
  ];
  const expired = pickExpiredLogs(files, ["app.log"], 10_000, 3);
  assert.deepEqual(expired, ["app-old1.log"], `文件数超限应从最旧的删，实际 ${expired.join(",")}`);
  assert.ok(!expired.includes("app.log"), "正在写的文件不能删");

  const bySize = pickExpiredLogs(
    [
      { name: "a.log", size: 60, mtimeMs: 5 },
      { name: "b.log", size: 60, mtimeMs: 1 },
      { name: "c.log", size: 60, mtimeMs: 2 },
    ],
    ["a.log"],
    130,
    10,
  );
  assert.deepEqual(bySize, ["b.log"], `总量超限应删最旧的，实际 ${bySize.join(",")}`);
}

// 脱敏：密钥不能进日志
{
  assert.equal(redactLog("key sk-abcdefghijklmnop1234"), "key sk-***");
  assert.equal(redactLog("token ghp_abcdefghijklmnopqrst"), "token gh*_***");
  assert.equal(redactLog("Authorization: Bearer abcdefghijklmn"), "Authorization: Bearer ***");
  assert.equal(redactLog('{"api_key":"supersecret123"}'), '{"api_key":"***"}');
  assert.equal(redactLog("password=hunter2hunter2"), "password=***");
  assert.equal(
    redactLog(`data:image/png;base64,${"A".repeat(120)}`),
    "data:image/png;base64,<省略>",
    "内联图片不能整段写进日志",
  );
  assert.ok(redactLog(`blob ${"Z".repeat(300)}`).includes("省略 300 字符"), "超长 base64 只留长度");
  // 正常内容不受影响
  assert.equal(redactLog("打开 C:\\Users\\a\\b.ts 失败"), "打开 C:\\Users\\a\\b.ts 失败");
}

// 行格式：时间戳 + 级别 + 作用域，多行压成一行
{
  const line = formatLogLine("warn", "ipc", "第一行\n第二行", new Date("2026-10-25T02:03:04.005Z"));
  assert.equal(line, "2026-10-25T02:03:04.005Z [WARN] (ipc) 第一行 ⏎ 第二行\n");
}

// 真正落盘：写、轮转、总量不超上限
const dir = await mkdtemp(path.join(tmpdir(), "pi-logs-"));
try {
  configureLogs(dir);
  log.info("test", "第一条");
  await logStore.flushAll();
  const text = await readFile(path.join(dir, "app.log"), "utf8");
  assert.ok(text.includes("(test) 第一条"), `应写入 app.log，实际：${text}`);
  assert.ok(text.includes("INFO"), "行内要有级别");

  // 直接塞一个超过 8MB 的文件，下一次写入应触发轮转
  await appendFile(path.join(dir, "app.log"), "x".repeat(LOG_MAX_FILE_BYTES + 10));
  log.info("test", "轮转后的第一条");
  await logStore.flushAll();
  const names = await readdir(dir);
  assert.ok(names.some((name) => /^app-\d{4}-\d{2}-\d{2}T.*\.log$/.test(name)), `应生成轮转文件：${names.join(",")}`);
  const rotatedSize = await stat(path.join(dir, "app.log")).then((info) => info.size);
  assert.ok(rotatedSize < 4096, `轮转后当前文件应重新开始，实际 ${rotatedSize} 字节`);

  // 造一堆旧文件，确认清理后总量不超过 100MB
  for (let i = 0; i < LOG_KEEP_FILES + 4; i += 1) {
    const file = path.join(dir, `app-2020-01-0${(i % 9) + 1}T00-00-0${i % 10}Z.log`);
    await writeFile(file, "y".repeat(1024));
    await utimes(file, 1_600_000_000 + i, 1_600_000_000 + i);
  }
  // 一个 60MB 老文件：删掉后总量必须落回上限内
  const huge = path.join(dir, "app-2019-01-01T00-00-00Z.log");
  await writeFile(huge, "z".repeat(60 * 1024 * 1024));
  await utimes(huge, 1_500_000_000, 1_500_000_000);
  await logStore.prune();
  const summary = await logStore.summary();
  assert.ok(summary.totalBytes <= LOG_MAX_TOTAL_BYTES, `清理后总量必须 ≤100MB，实际 ${(summary.totalBytes / 1024 / 1024).toFixed(1)}MB`);
  assert.ok(!summary.files.some((file) => file.name === "app-2019-01-01T00-00-00Z.log"), "最旧的大文件应先被删");
  assert.ok(summary.files.some((file) => file.name === "app.log"), "当前文件不能被删");

  // 清空
  await logStore.clear();
  const cleared = await logStore.summary();
  assert.equal(cleared.files.length, 0, `清空后不应残留日志文件：${cleared.files.map((f) => f.name).join(",")}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("logger.check ok 100MB 上限 / 轮转 / 清理 / 脱敏 / 落盘");

// 日志跟着项目走：没有项目时先攒在内存里，选中项目后补写进去；切换项目时旧目录先刷盘
{
  const first = await mkdtemp(path.join(tmpdir(), "pi-logs-a-"));
  const second = await mkdtemp(path.join(tmpdir(), "pi-logs-b-"));
  try {
    // 先重置到一个「未配置」的状态：用一个新实例不方便，这里直接验证 switchTo 行为
    logStore.configure("");
    logStore.write("app", "info", "pre", "启动早期的日志");
    await logStore.switchTo(path.join(first, ".pi-desktop", "logs"));
    await logStore.flushAll();
    const early = await readFile(path.join(first, ".pi-desktop", "logs", "app.log"), "utf8").catch(() => "");
    assert.ok(early.includes("启动早期的日志"), `没有项目目录时的日志应补写到第一个项目：${early}`);

    logStore.write("app", "info", "pre", "第一个项目里的事");
    await logStore.switchTo(path.join(second, ".pi-desktop", "logs"));
    await logStore.flushAll();
    const firstText = await readFile(path.join(first, ".pi-desktop", "logs", "app.log"), "utf8").catch(() => "");
    const secondText = await readFile(path.join(second, ".pi-desktop", "logs", "app.log"), "utf8").catch(() => "");
    assert.ok(firstText.includes("第一个项目里的事"), "切换前应把旧目录的缓冲刷干净");
    assert.ok(!secondText.includes("第一个项目里的事"), "旧项目的日志不应出现在新项目里");

    logStore.write("app", "info", "pre", "第二个项目里的事");
    await logStore.flushAll();
    const secondAfter = await readFile(path.join(second, ".pi-desktop", "logs", "app.log"), "utf8").catch(() => "");
    assert.ok(secondAfter.includes("第二个项目里的事"), "切换后应写到新项目目录");
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
}
console.log("logger.check ok 跟着项目走 / 早期日志补写 / 切换刷盘");
