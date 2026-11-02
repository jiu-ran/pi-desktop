import assert from "node:assert/strict";
import { parseBashInput } from "../../packages/ui/src/shared/bash-input.ts";
import { createTranscript } from "../../packages/ui/src/kernel/transcript.ts";
import { parseSessionHistory, sliceHistoryPage } from "../../electron/session-history.ts";

/**
 * 对话里的 `!` / `!!` 命令。
 *
 * 三条链路都要对上，少一条界面上就会出现「命令跑了但卡片一直是空的」：
 * 1. 输入解析（`!` 与 `!!` 的区别、正文里的感叹号不算）
 * 2. 流式事件按 requestId 落到卡片上，最终结果以 response 为准
 * 3. 会话文件里的 `bashExecution` 能重新渲染（重启 / 切回会话后还在）
 */

// 1. 输入解析
assert.deepEqual(parseBashInput("!ls -la"), { command: "ls -la", excludeFromContext: false });
assert.deepEqual(parseBashInput("  !!git status  "), { command: "git status", excludeFromContext: true });
assert.deepEqual(parseBashInput("!"), { command: "", excludeFromContext: false }, "只有感叹号也要认出来，交给界面提示");
assert.deepEqual(parseBashInput("!!!"), { command: "!", excludeFromContext: true });
assert.equal(parseBashInput("echo !"), null, "正文里的感叹号不是命令");
assert.equal(parseBashInput("普通消息"), null, "普通消息不能被当成命令");

// 2. 流式卡片
const live = createTranscript();
const block = live.beginBash("bash_1", "npm run check", false);
assert.equal(block.kind, "bash");
assert.equal(block.status, "running");
assert.equal(block.command, "npm run check");
assert.equal(live.applyEvent({ type: "bash_execution_update", id: "bash_1", delta: "building\n" }), true);
assert.equal(live.applyEvent({ type: "bash_execution_update", id: "bash_other", delta: "xx" }), false, "别的请求的增量不能写进这张卡");
assert.equal(live.applyEvent({ type: "bash_execution_update", id: "bash_1", delta: "done\n" }), true);
assert.equal(live.blocks[0]!.output, "building\ndone\n");
assert.equal(live.finishBash("bash_1", {
  output: "building\ndone\nfinal\n",
  exitCode: 2,
  cancelled: false,
  truncated: true,
  fullOutputPath: "/tmp/pi-bash.log",
}), true);
const finished = live.blocks[0]!;
assert.equal(finished.status, "error");
assert.equal(finished.isError, true);
assert.equal(finished.exitCode, 2);
assert.equal(finished.truncated, true);
assert.equal(finished.fullOutputPath, "/tmp/pi-bash.log");
assert.equal(finished.output, "building\ndone\nfinal\n", "最终输出以 response 为准");
assert.ok(typeof finished.durationMs === "number" && finished.durationMs >= 0);
assert.equal(live.finishBash("bash_missing", { output: "" }), false, "找不到卡片时安全返回");

const cancelled = createTranscript();
cancelled.beginBash("bash_2", "sleep 30", true);
cancelled.finishBash("bash_2", { output: "部分输出\n", cancelled: true });
const stopped = cancelled.blocks[0]!;
assert.equal(stopped.cancelled, true);
assert.equal(stopped.status, "done", "用户主动停止不是失败");
assert.equal(stopped.isError, false);
assert.equal(stopped.excludeFromContext, true);
assert.equal(stopped.exitCode, null);

const broken = createTranscript();
broken.beginBash("bash_3", "ls");
broken.failBash("bash_3", new Error("Pi 进程退出"));
const failed = broken.blocks[0]!;
assert.equal(failed.status, "error");
assert.equal(failed.isError, true);
assert.ok(failed.output?.includes("Pi 进程退出"), "卡片要留下失败原因");

// 3. 会话文件里的 bashExecution（重启 / 切回会话）
const history = createTranscript();
history.loadMessages([
  {
    role: "bashExecution",
    command: "git status",
    output: "clean\n",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: 1_700_000_000_000,
  },
  {
    role: "bashExecution",
    command: "cat missing",
    output: "not found\n",
    exitCode: 1,
    cancelled: false,
    truncated: true,
    fullOutputPath: "/tmp/full.log",
    excludeFromContext: true,
    timestamp: 1_700_000_001_000,
  },
]);
assert.equal(history.blocks.length, 2);
assert.equal(history.blocks[0]!.kind, "bash");
assert.equal(history.blocks[0]!.status, "done");
assert.equal(history.blocks[1]!.status, "error");
assert.equal(history.blocks[1]!.excludeFromContext, true);
assert.equal(history.blocks[1]!.fullOutputPath, "/tmp/full.log");
assert.equal(history.blocks[1]!.ts, 1_700_000_001_000);

const prepended = createTranscript();
prepended.prependMessages([{ role: "bashExecution", command: "pwd", output: "/repo\n", exitCode: 0 }]);
assert.equal(prepended.blocks[0]!.kind, "bash");
assert.equal(prepended.blocks[0]!.command, "pwd");

const parsed = parseSessionHistory([
  JSON.stringify({ type: "session", version: 3, id: "s", cwd: "/repo" }),
  JSON.stringify({ type: "message", id: "m1", message: { role: "bashExecution", command: "ls", output: "a\n", exitCode: 0 } }),
  JSON.stringify({ type: "message", id: "m2", message: { role: "user", content: "看完了" } }),
].join("\n"));
assert.deepEqual(parsed.map((message) => message.role), ["bashExecution", "user"], "bashExecution 要进历史，不能只靠内存");
const page = sliceHistoryPage(parsed, 0, 1);
assert.equal(page.total, 2);
assert.equal(page.messages[0]?.role, "user", "默认从最新一页开始");
const withBashBlock = sliceHistoryPage(parsed, 2, 1, { minBlocks: 2 });
assert.equal(withBashBlock.messages[0]?.role, "bashExecution", "bashExecution 也要算一个可见块，分页时不能被挤掉");

console.log("bash OK 输入解析 / 流式更新 / 停止与失败 / 会话历史");
