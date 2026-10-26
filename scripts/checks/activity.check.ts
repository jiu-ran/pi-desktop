import assert from "node:assert/strict";
import {
  activityTarget,
  activityVerb,
  describeActivityBlock,
  isFailed,
  isLiveTool,
  isSettled,
  type ActivityBlockLike,
} from "../../packages/ui/src/shared/activity.ts";
import { blockMatchesQuery, searchableText } from "../../packages/ui/src/shared/search-text.ts";

const step = (id: string, name: string, args: Record<string, any> = {}, extra: Partial<ActivityBlockLike> = {}): ActivityBlockLike => ({
  kind: "tool",
  id,
  name,
  args,
  status: "done",
  ...extra,
});

const read = (id: string, path = "src/a.ts", extra: Partial<ActivityBlockLike> = {}) =>
  step(id, "read", { path }, extra);

// 单步描述：命令去掉前置 cd、路径只留最后两级、MCP 名称拆成可读动作
assert.equal(activityVerb(step("b", "bash")), "运行");
assert.equal(activityVerb(step("m", "mcp__fs__read_file")), "read file");
assert.equal(activityVerb(step("x", "weird_tool")), "weird_tool");
assert.equal(activityTarget(step("b2", "bash", { command: "cd /tmp && npm run check" })), "npm run check");
assert.equal(activityTarget(read("p", "C:/work/project/src/main.ts")), "src/main.ts");
assert.match(describeActivityBlock(step("mcp2", "mcp__fs__read_file", { path: "C:/tmp/a.txt" })), /read file/);
assert.match(describeActivityBlock(read("p2", "C:/work/project/src/main.ts")), /main\.ts/);
assert.equal(describeActivityBlock({ kind: "thinking", id: "t", text: "x" }), "思考");
assert.equal(activityTarget(step("empty", "bash", {})), "", "没有参数时目标为空");

// 状态判定：失败 / 已结算 / 仍在运行
assert.equal(isFailed(step("f1", "bash", {}, { status: "error" })), true);
assert.equal(isFailed(step("f2", "bash", {}, { isError: true })), true);
assert.equal(isFailed(step("f3", "bash")), false);
assert.equal(isSettled(step("s1", "bash", {}, { status: "done" })), true);
assert.equal(isSettled(step("s2", "bash", {}, { status: "running" })), false);
assert.equal(isLiveTool(step("l1", "bash", {}, { status: "running" })), true);
assert.equal(isLiveTool({ kind: "thinking", id: "l2", streaming: true }), true);
assert.equal(isLiveTool(step("l3", "bash")), false);

// 对话搜索与工具卡自动展开共用同一份文本提取规则。
const bashBlock = { name: "bash", args: { command: "ls scripts/checks" } };
assert.deepEqual(searchableText(bashBlock).split(String.fromCharCode(10)), ["bash", '{"command":"ls scripts/checks"}']);
assert.equal(blockMatchesQuery(bashBlock, "scripts/checks"), true);
assert.equal(blockMatchesQuery({ output: "all good" }, "failed"), false);
assert.equal(blockMatchesQuery({ text: "abc" }, "  "), false);

console.log("activity OK 单步描述 / 失败判定 / 搜索文本");
