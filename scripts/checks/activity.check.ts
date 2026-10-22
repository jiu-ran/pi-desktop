import assert from "node:assert/strict";
import {
  activityCountLabel,
  deriveActivityItems,
  describeActivityBlock,
  isActivityStep,
  summarizeActivity,
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

// 4 步常规活动折叠为一组；主要工具 edit 打断分组并保持独立。
const mixed = deriveActivityItems([
  read("r1"),
  step("b1", "bash", { command: "npm run check" }),
  { kind: "thinking", id: "t1", text: "先检查类型", streaming: false },
  read("r2", "src/b.ts"),
  step("e1", "edit", { path: "src/a.ts" }),
  read("r3"),
]);
assert.equal(mixed.length, 3, "4 步活动 + 独立 edit + 不足 4 步的尾段");
assert.equal(mixed[0]!.kind, "activity");
assert.equal(mixed[1]!.kind, "block");
assert.equal(mixed[2]!.kind, "block");
const group = mixed[0]!.kind === "activity" ? mixed[0].group : null;
assert.ok(group, "应得到活动组");
assert.equal(group.toolCount, 3);
assert.equal(group.thinkingCount, 1);
assert.equal(group.live, false);
assert.equal(group.errored, false);
assert.match(group.summary, /读取/);
assert.ok(group.summary.includes("读取 src/a.ts"), "摘要包含读取动作");
assert.ok(group.summary.includes("运行 npm run check"), "摘要包含清理后的命令");
assert.match(describeActivityBlock(step("b2", "bash", { command: "cd /tmp && npm run check" })), /运行 npm run check/);
assert.equal(activityCountLabel(group), "3 工具 · 1 思考");

// 少于 4 步不折叠，避免把两次 read 也藏起来。
const short = deriveActivityItems([read("s1"), read("s2"), read("s3")]);
assert.equal(short.length, 3);
assert.ok(short.every((item) => item.kind === "block"));

// 错误工具让组默认可知，摘要给出失败动作；live 组给出当前动作。
const errored = deriveActivityItems([
  read("e1"),
  read("e2"),
  read("e3"),
  read("e4", "src/fail.ts", { status: "error", isError: true }),
]);
assert.equal(errored[0]!.kind, "activity");
const errorGroup = errored[0]!.kind === "activity" ? errored[0].group : null;
assert.ok(errorGroup);
assert.equal(errorGroup.errored, true);
assert.match(errorGroup.summary, /失败/);

const live = summarizeActivity([
  { index: 0, block: read("l1") },
  { index: 1, block: read("l2") },
  { index: 2, block: step("l3", "bash", { command: "npm test" }, { status: "running" }) },
  { index: 3, block: { kind: "thinking", id: "l4", text: "", streaming: true } },
]);
assert.equal(live.live, true);
assert.match(live.summary, /^正在运行 npm test/);

// 图片工具保留原卡片；MCP 名称、路径和命令摘要可读。
assert.equal(isActivityStep(read("img", "a.png", { images: 1 })), false);
assert.equal(isActivityStep(step("mcp", "mcp__github__search_issues", { query: "bug" })), true);
assert.match(describeActivityBlock(step("mcp2", "mcp__fs__read_file", { path: "C:/tmp/a.txt" })), /read file/);
assert.match(describeActivityBlock(read("p", "C:/work/project/src/main.ts")), /src\/main\.ts|main\.ts/);

// 全是思考时也有可读计数。
const thoughts = deriveActivityItems([
  { kind: "thinking", id: "th1", text: "a" },
  { kind: "thinking", id: "th2", text: "b" },
  { kind: "thinking", id: "th3", text: "c" },
  { kind: "thinking", id: "th4", text: "d" },
]);
assert.equal(thoughts[0]!.kind, "activity");
if (thoughts[0]!.kind === "activity") {
  assert.equal(activityCountLabel(thoughts[0].group), "4 段思考");
  assert.match(thoughts[0].group.summary, /思考/);
}

// 超长工具链按 20 步上限拆分，搜索展开时不会一次挂载整段会话。
const longRun = Array.from({ length: 21 }, (_, i) => read(`m${i}`));
const split = deriveActivityItems(longRun);
assert.equal(split.length, 2, "20 步活动组 + 1 步尾块");
assert.equal(split[0]!.kind, "activity");
if (split[0]!.kind === "activity") assert.equal(split[0].group.entries.length, 20);
assert.equal(split[1]!.kind, "block");

// 对话搜索与工具卡自动展开共用同一份文本提取规则。
const bashBlock = { name: "bash", args: { command: "ls scripts/checks" } };
assert.deepEqual(searchableText(bashBlock).split(String.fromCharCode(10)), ["bash", '{"command":"ls scripts/checks"}']);
assert.equal(blockMatchesQuery(bashBlock, "scripts/checks"), true);
assert.equal(blockMatchesQuery({ output: "all good" }, "failed"), false);
assert.equal(blockMatchesQuery({ text: "abc" }, "  "), false);

console.log("activity OK");
