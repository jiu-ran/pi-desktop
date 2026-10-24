import assert from "node:assert/strict";
import {
  formatDuration,
  subagentModeLabel,
  subagentStateLabel,
  summarizeSubagent,
} from "../../packages/ui/src/plugins/subagent/summary.ts";

// details 缺失时返回 null，界面回退到普通工具卡片
assert.equal(summarizeSubagent(null), null);
assert.equal(summarizeSubagent(undefined), null);
assert.equal(summarizeSubagent({}), null, "没有 results 也没有 mode 时应回退");

// 单个子代理：从 result 与 progress 取名称、状态、耗时、工具数、token
const single = summarizeSubagent({
  mode: "single",
  results: [
    {
      agent: "reviewer",
      success: true,
      durationMs: 12_400,
      task: "审查 diff",
      finalOutput: "看起来没问题",
      progress: { toolCount: 7, turnCount: 3, tokens: 4200, activityState: "done" },
      usage: { totalTokens: 4200 },
    },
  ],
});
assert.ok(single);
assert.equal(single!.mode, "single");
assert.equal(single!.rows.length, 1);
assert.equal(single!.rows[0].agent, "reviewer");
assert.equal(single!.rows[0].state, "ok");
assert.equal(single!.rows[0].durationMs, 12400);
assert.equal(single!.rows[0].tools, 7);
assert.equal(single!.rows[0].turns, 3);
assert.equal(single!.rows[0].tokens, 4200);
assert.equal(single!.ok, 1);
assert.equal(single!.failed, 0);
assert.equal(single!.agents[0], "reviewer");
assert.deepEqual(single!.tasks, ["审查 diff"]);

// 并行：成功 / 失败 / 超时分别计数，失败项保留错误文本
const parallel = summarizeSubagent({
  mode: "parallel",
  results: [
    { agent: "a", success: true, durationMs: 900, finalOutput: "ok" },
    { agent: "b", success: false, error: "命令失败", finalOutput: "部分输出" },
    { agent: "c", timedOut: true, success: false },
  ],
});
assert.ok(parallel);
assert.equal(parallel!.rows.length, 3);
assert.equal(parallel!.ok, 1);
assert.equal(parallel!.failed, 2, "失败 + 超时应计入失败数");
assert.equal(parallel!.rows[1].state, "failed");
assert.equal(parallel!.rows[1].error, "命令失败");
assert.equal(parallel!.rows[2].state, "timeout");
assert.deepEqual(parallel!.agents, ["a", "b", "c"], "同名 agent 应去重但这里各不同");

// 运行中的进度快照：未结算且没有 success 字段时按运行中处理，并带出当前工具
const running = summarizeSubagent(
  {
    mode: "single",
    results: [{ agent: "worker", progress: { activityState: "running", currentTool: "bash", toolCount: 2, tokens: 800 } }],
  },
  false,
);
assert.equal(running!.rows[0].state, "running");
assert.equal(running!.rows[0].currentTool, "bash");
assert.equal(running!.running, 1);
// 同样的数据在已结算时不应一直显示「运行中」
assert.equal(summarizeSubagent({ mode: "single", results: [{ agent: "worker" }] }, true)!.rows[0].state, "ok");

// 停止 / 中断
const stopped = summarizeSubagent({ mode: "single", results: [{ agent: "x", stopped: true, success: false }] });
assert.equal(stopped!.rows[0].state, "stopped");
assert.equal(subagentStateLabel("stopped"), "已停止");

// 长输出只保留摘要，避免把记录撑爆
const long = summarizeSubagent({
  mode: "single",
  results: [{ agent: "x", success: true, finalOutput: "字".repeat(2000) }],
});
assert.ok(long!.rows[0].truncated, "长输出应标记截断");
assert.ok(long!.rows[0].output.length <= 401, `摘要应被截断，实际 ${long!.rows[0].output.length}`);

// 缺字段时的降级：agent 用占位名，不抛异常
const bare = summarizeSubagent({ mode: "chain", results: [{}] });
assert.equal(bare!.rows[0].agent, "子代理");
assert.equal(bare!.rows[0].tools, null);

// 模式与耗时的展示文案
assert.equal(subagentModeLabel("parallel"), "并行");
assert.equal(subagentModeLabel("workflow"), "工作流");
assert.equal(subagentModeLabel("unknown-mode"), "unknown-mode", "未知模式直接显示原值");
assert.equal(formatDuration(820), "820ms");
assert.equal(formatDuration(1500), "1.5s");
assert.equal(formatDuration(125_000), "2m 05s");
assert.equal(formatDuration(null), "");

console.log("subagent OK");
