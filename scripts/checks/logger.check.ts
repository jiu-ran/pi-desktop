import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, appendFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LOG_KEEP_FILES,
  LOG_MAX_FILE_BYTES,
  DEFAULT_LOG_TOTAL_BYTES,
  LOG_TOTAL_CHOICES_MB,
  configureLogs,
  formatLogLine,
  log,
  logStore,
  pickExpiredLogs,
  redactLog,
  shouldRotate,
} from "../../electron/logger.ts";

// 默认上限给小的：8MB（用户可在设置里改）
assert.equal(DEFAULT_LOG_TOTAL_BYTES, 8 * 1024 * 1024, "默认总量上限应为 8MB");
assert.deepEqual([...LOG_TOTAL_CHOICES_MB], [4, 8, 16, 32, 64, 128], "可选档位固定");
assert.equal(LOG_MAX_FILE_BYTES, 8 * 1024 * 1024);
// 由总量推出的单文件上限与保留个数必须自洽
{
  const { logSizing, normalizeLogTotalBytes } = await import("../../electron/logger.ts");
  const small = logSizing(4 * 1024 * 1024);
  assert.equal(small.totalBytes, 4 * 1024 * 1024);
  assert.ok(small.fileBytes <= small.totalBytes / 2, `单文件不能占掉半个总量：${small.fileBytes}`);
  assert.ok(small.fileBytes >= 512 * 1024, "单文件不低于 512KB");
  const big = logSizing(128 * 1024 * 1024);
  assert.equal(big.fileBytes, LOG_MAX_FILE_BYTES, "大额度下单文件封顶 8MB");
  assert.ok(big.keepFiles <= LOG_KEEP_FILES, "保留个数不超过上限");
  // 手改配置文件 / 传非法值时收敛到合法区间
  assert.equal(normalizeLogTotalBytes(16 * 1024 * 1024), 16 * 1024 * 1024);
  assert.equal(normalizeLogTotalBytes(0), DEFAULT_LOG_TOTAL_BYTES);
  assert.equal(normalizeLogTotalBytes("abc"), DEFAULT_LOG_TOTAL_BYTES);
  assert.equal(normalizeLogTotalBytes(9999 * 1024 * 1024), 128 * 1024 * 1024, "超大值收敛到 128MB");
  assert.equal(normalizeLogTotalBytes(1000), 1024 * 1024, "过小值抬到 1MB");
}
assert.equal(LOG_KEEP_FILES, 12);

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

  // 直接塞一个超过「当前单文件上限」的文件，下一次写入应触发轮转
  const fileBytes = logStore.limits().fileBytes;
  await appendFile(path.join(dir, "app.log"), "x".repeat(fileBytes + 10));
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
  assert.equal(typeof summary.limitBytes, "number", "统计里要带上限");
  assert.ok(summary.limitBytes > 0, "上限要大于 0");
  assert.ok(!summary.files.some((file) => file.name === "app-2019-01-01T00-00-00Z.log"), "最旧的大文件应先被删");
  assert.ok(summary.files.some((file) => file.name === "app.log"), "当前文件不能被删");

  // 清空
  await logStore.clear();
  const cleared = await logStore.summary();
  assert.equal(cleared.files.length, 0, `清空后不应残留日志文件：${cleared.files.map((f) => f.name).join(",")}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("logger.check ok 默认上限 / 轮转 / 轮转 / 清理 / 脱敏 / 落盘");

// 日志目录是启动时定的一个固定目录（安装目录下的 logs/）：切换目录要把旧缓冲刷干净，
// 目录不可写时要能探测出来（打包版据此回落到 userData）。
{
  const first = await mkdtemp(path.join(tmpdir(), "pi-logs-a-"));
  const second = await mkdtemp(path.join(tmpdir(), "pi-logs-b-"));
  try {
    const { isWritableDir, useAppLogs } = await import("../../electron/logger.ts");
    // 还没配置目录时先攒在内存
    logStore.configure("");
    logStore.write("app", "info", "pre", "启动早期的日志");
    await useAppLogs(first);
    await logStore.flushAll();
    const early = await readFile(path.join(first, "app.log"), "utf8").catch(() => "");
    assert.ok(early.includes("启动早期的日志"), `目录确定前的日志应补写到第一个目录：${early}`);

    logStore.write("app", "info", "pre", "第一个目录里的事");
    await useAppLogs(second);
    await logStore.flushAll();
    const firstText = await readFile(path.join(first, "app.log"), "utf8").catch(() => "");
    const secondText = await readFile(path.join(second, "app.log"), "utf8").catch(() => "");
    assert.ok(firstText.includes("第一个目录里的事"), "切换前应把旧目录的缓冲刷干净");
    assert.ok(!secondText.includes("第一个目录里的事"), "旧目录的日志不应出现在新目录里");

    logStore.write("app", "info", "pre", "第二个目录里的事");
    await logStore.flushAll();
    assert.ok(
      (await readFile(path.join(second, "app.log"), "utf8")).includes("第二个目录里的事"),
      "切换后应写到新目录",
    );

    // 可写探测：正常目录要 true；用「文件」当目录必须 false（安装目录不可写时走这条路）
    const filePath = path.join(first, "not-a-dir");
    await writeFile(filePath, "x");
    assert.equal(await isWritableDir(first), true, "可写目录应判定为可写");
    assert.equal(await isWritableDir(path.join(filePath, "logs")), false, "不可写目录应判定为不可写");
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
}
console.log("logger.check ok 固定日志目录 / 早期日志补写 / 切换刷盘 / 可写探测");

// 上限可调：设置页档位 → logStore 立刻生效并清理超量文件
{
  const { mkdtemp, writeFile, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const pathMod = await import("node:path");
  const dir = await mkdtemp(pathMod.join(tmpdir(), "pi-logs-limit-"));
  try {
    const { configureLogs, normalizeLogTotalBytes } = await import("../../electron/logger.ts");
    configureLogs(dir);
    // 造 3 个各 2MB 的历史文件 + 一个当前文件
    for (let i = 0; i < 3; i += 1) {
      await writeFile(pathMod.join(dir, `app-2020-01-0${i + 1}T00-00-00Z.log`), "x".repeat(2 * 1024 * 1024));
    }
    await writeFile(pathMod.join(dir, "app.log"), "y".repeat(1024));
    logStore.write("app", "info", "test", "当前文件");
    await logStore.flushAll();

    // 调到 4MB：总量必须落回上限内
    const limits = await logStore.setLimits(4 * 1024 * 1024);
    assert.equal(limits.limitBytes, 4 * 1024 * 1024, "上限要按设置生效");
    assert.ok(limits.fileBytes <= 1024 * 1024, `4MB 额度下单文件上限应更小：${limits.fileBytes}`);
    const summary = await logStore.summary();
    assert.ok(summary.totalBytes <= 4 * 1024 * 1024, `调整后总量应 ≤4MB，实际 ${(summary.totalBytes / 1024 / 1024).toFixed(1)}MB`);
    assert.ok(summary.files.some((file) => file.name === "app.log"), "正在写的文件不能被删");

    // 再调回默认：上限跟着变
    const back = await logStore.setLimits(DEFAULT_LOG_TOTAL_BYTES);
    assert.equal(back.limitBytes, DEFAULT_LOG_TOTAL_BYTES);
    assert.equal(normalizeLogTotalBytes(DEFAULT_LOG_TOTAL_BYTES), DEFAULT_LOG_TOTAL_BYTES);
    assert.deepEqual([...(await logStore.summary()).choicesMb ?? []], [4, 8, 16, 32, 64, 128], "要给设置页可选档位");
    const names = await readdir(dir);
    assert.ok(names.includes("app.log"), "当前文件仍在");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
console.log("logger.check ok 上限可调 4MB/默认 / 调小即清理 / 当前文件保留");
