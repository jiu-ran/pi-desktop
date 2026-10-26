import assert from "node:assert/strict";
import {
  buildTurnSteps,
  deriveTurnItems,
  editStat,
  formatStepDuration,
  isTurnStep,
  stepLabel,
  stepTarget,
  summarizeTurn,
  turnDurationLabel,
  TURN_MIN_STEPS,
  type TurnGroup,
} from "../../packages/ui/src/shared/activity-turns.ts";
import type { ActivityBlockLike, ActivityEntry } from "../../packages/ui/src/shared/activity.ts";

/**
 * 执行记录 = 时间线：一次用户请求一组（收起只占一行），展开后**按真实顺序**列出每一步。
 * 断言用的是真实会话规模：5 轮 / 52 个工具 / 46 段思考。
 */
const at = (base: number, offset: number): number => base + offset;

const tool = (id: string, name: string, args: Record<string, any> = {}, extra: Partial<ActivityBlockLike> = {}): ActivityBlockLike => ({
  kind: "tool",
  id,
  name,
  args,
  status: "done",
  ts: at(1_000, 0),
  ...extra,
});

const read = (id: string, path = "src/a.ts", extra: Partial<ActivityBlockLike> = {}) => tool(id, "read", { path }, extra);
const bash = (id: string, command = "npm run check", extra: Partial<ActivityBlockLike> = {}) => tool(id, "bash", { command }, extra);
const edit = (id: string, path = "src/a.ts", extra: Partial<ActivityBlockLike> = {}) => tool(id, "edit", { path }, extra);
const think = (id: string, text = "先看看文件", extra: Partial<ActivityBlockLike> = {}): ActivityBlockLike => ({
  kind: "thinking",
  id,
  text,
  ts: at(1_000, 0),
  ...extra,
});
const user = (id: string): ActivityBlockLike => ({ kind: "user", id });
const text = (id: string): ActivityBlockLike => ({ kind: "text", id, text: "做完了" });

/** 复刻真实会话的块序列：每轮「思考 → 工具 → …」最后跟一段回复 */
function realSession(): ActivityBlockLike[] {
  const blocks: ActivityBlockLike[] = [];
  let n = 0;
  const stamp = (): number => at(1_000, (n += 1) * 1_000);
  const push = (block: ActivityBlockLike): void => {
    blocks.push({ ...block, ts: stamp() } as ActivityBlockLike);
  };
  const turn = (thinking: number, tools: Array<ActivityBlockLike>): void => {
    for (let i = 0; i < thinking; i += 1) push(think(`th-${n}`));
    for (const item of tools) push(item);
  };

  push(user(`u1`));
  turn(
    24,
    [
      ...Array.from({ length: 26 }, (_, i) => bash(`t1-b${i}`, `npm run check -- ${i}`)),
      read("t1-r1", "packages/ui/src/kernel/transcript.ts"),
      read("t1-r2", "packages/ui/src/shared/activity.ts"),
      read("t1-r3", "electron/main.ts"),
      tool("t1-w1", "write", { path: "docs/note.md" }),
    ],
  );
  push(text("x1"));

  push(user(`u2`));
  turn(4, [read("t2-r1"), edit("t2-e1", "packages/ui/src/shared/activity.ts"), bash("t2-b1", "npx tsc --noEmit")]);
  push(text("x2"));

  push(user(`u3`));
  turn(9, [
    ...Array.from({ length: 5 }, (_, i) => bash(`t3-b${i}`, `git status ${i}`)),
    read("t3-r1"),
    read("t3-r2", "packages/ui/src/components/chat/AgentChat.vue"),
    read("t3-r3", "packages/ui/src/styles/conversation.css"),
    ...Array.from({ length: 3 }, (_, i) => edit(`t3-e${i}`, `packages/ui/src/shared/part-${i}.ts`)),
  ]);
  push(text("x3"));

  push(user(`u4`));
  turn(4, [bash("t4-b1"), bash("t4-b2"), tool("t4-w1", "write", { path: "docs/a.md" })]);
  push(text("x4"));

  push(user(`u5`));
  turn(5, [...Array.from({ length: 4 }, (_, i) => bash(`t5-b${i}`, `node check-${i}.mjs`)), edit("t5-e1", "README.md")]);
  push(text("x5"));

  return blocks;
}

const blocks = realSession();
const items = deriveTurnItems(blocks);
const turns = items.filter((item) => item.kind === "turn").map((item) => item.group) as TurnGroup[];

// 顶层行数：5 条用户 + 5 个执行记录 + 5 段回复
assert.equal(items.filter((item) => item.kind === "block").length, 10, "用户消息与回复保持独立");
assert.equal(turns.length, 5, "一轮对话一条执行记录");
assert.equal(items.length, 15, `顶层应只有 15 行，实际 ${items.length}`);

// 步数合计：46 段思考 + 52 个工具
const totalSteps = turns.reduce((sum, group) => sum + group.entries.length, 0);
assert.equal(totalSteps, 98, `所有活动步都要收进组里，实际 ${totalSteps}`);
assert.equal(turns.reduce((sum, group) => sum + group.thinkingCount, 0), 46, "思考段数要统计全");
assert.equal(turns.reduce((sum, group) => sum + group.toolCount, 0), 52, "工具数要统计全");

// 组头摘要
const first = turns[0]!;
assert.match(first.summary, /^执行了 54 步/, `组头应说明步数：${first.summary}`);
assert.match(first.summary, /改 1 个文件/, `组头应说明改动文件数：${first.summary}`);
assert.match(first.summary, /26 条命令/, `组头应说明命令数：${first.summary}`);
assert.match(first.summary, /读 3 个文件/, `组头应说明读取数：${first.summary}`);
assert.match(first.summary, /思考 24 段/, `组头应说明思考段数：${first.summary}`);
assert.equal(first.editCount, 1, "改动文件数按去重路径统计");

// 时间线：顺序必须与块的原始顺序一致，不能按类别归并
assert.equal(first.steps.length, first.entries.length, "每一步都要在时间线上");
assert.deepEqual(
  first.steps.map((step) => step.block.id),
  first.entries.map((entry) => entry.block.id),
  "时间线顺序 = 真实发生顺序",
);
assert.equal(first.steps[0]!.kind, "thinking", "第一条是思考");
assert.equal(first.steps[24]!.key, "bash", "24 段思考之后接着是命令，没有被挪到别处");
assert.equal(first.steps.at(-1)!.key, "edit", "write 收在时间线末尾（改动）");

// 单步展示字段：动作名、摘要、相对时间
assert.equal(stepLabel(bash("b", "npm run check")), "运行");
assert.equal(stepLabel(edit("e", "src/a.ts")), "改动");
assert.equal(stepLabel(think("t", "x")), "思考");
assert.equal(stepTarget(bash("b2", "cd /tmp && npm run check")), "npm run check", "命令去掉前置 cd");
assert.equal(stepTarget(read("r", "packages/ui/src/kernel/transcript.ts")), "kernel/transcript.ts", "路径只留最后两级");
assert.equal(stepTarget(think("t2", "  先 看看\n文件  ")), "先 看看 文件", "思考摘要压成一行");
assert.ok(stepTarget(think("long", "x".repeat(200))).endsWith("…"), "过长的思考摘要要截断");

// 单步耗时：每步算自己的，不是「相对本轮开始」的累计
const stamped = buildTurnSteps([
  { block: { ...bash("b1"), ts: 10_000 }, index: 0 },
  { block: { ...bash("b2"), ts: 11_400 }, index: 1 },
  { block: { ...bash("b3"), ts: 22_000 }, index: 2 },
]);
assert.deepEqual(stamped.map((step) => step.elapsedMs), [1_400, 10_600, -1], "每步耗时 = 到下一步开始的间隔，最后一步没有后继");
assert.deepEqual(stamped.map((step) => step.elapsedLabel), ["1 秒", "11 秒", ""], "整秒四舍五入，最后一步没有后继就不显示");

// 工具自带的 durationMs 优先：它比「到下一步的间隔」更准
const recorded = buildTurnSteps([
  { block: { ...bash("r1"), ts: 10_000, durationMs: 320 }, index: 0 },
  { block: { ...bash("r2"), ts: 10_400, durationMs: 5_400 }, index: 1 },
  { block: { ...think("r3"), ts: 15_900 }, index: 2 },
]);
assert.deepEqual(recorded.map((step) => step.elapsedMs), [320, 5_400, -1], "有记录的用记录值，思考块用间隔");
assert.deepEqual(recorded.map((step) => step.elapsedLabel), ["0.3 秒", "5 秒", ""], "毫秒级也给出可读文案");
assert.equal(formatStepDuration(0), "0.0 秒", "零耗时也要占位");
assert.equal(formatStepDuration(65_000), "1 分 5 秒", "超过一分钟按分秒");
assert.equal(formatStepDuration(-1), "", "没有时间就不显示");
// 改动步骤带增删行数：时间线里的卡片没有头部，行上要能看到 +N / −N
const stats = buildTurnSteps([
  {
    block: {
      ...edit("e1", "src/a.ts"),
      args: { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" + String.fromCharCode(10) + "c" }] },
    },
    index: 0,
  },
  { block: { ...tool("w1", "write", { path: "src/b.ts", content: "x" + String.fromCharCode(10) + "y" }) }, index: 1 },
  { block: bash("b9"), index: 2 },
]);
assert.equal(stats[0]!.added, 2, "edit 的新增行数");
assert.equal(stats[0]!.removed, 1, "edit 的删除行数");
assert.equal(stats[1]!.added, 2, "write 只报新增");
assert.equal(stats[1]!.removed, null, "write 不报删除（整份文件都是新增）");
assert.equal(stats[2]!.added, null, "命令步骤没有增删");
assert.equal(editStat(bash("b10")), null, "非改动工具不算增删");
assert.equal(editStat({ ...edit("e2"), args: { path: "src/a.ts" } }), null, "没有差异时不算增删");

const unstamped = buildTurnSteps([{ block: { ...bash("n1"), ts: undefined }, index: 0 }]);
assert.equal(unstamped[0]!.elapsedLabel, "", "没有时间戳时不显示耗时");
assert.equal(unstamped[0]!.elapsedMs, -1);

// 失败与运行中
const failing = buildTurnSteps([
  { block: { ...bash("f1"), ts: 1_000 }, index: 0 },
  { block: { ...bash("f2"), ts: 2_000, isError: true, status: "error" }, index: 1 },
  { block: { ...bash("f3"), ts: 3_000, status: "running" }, index: 2 },
]);
assert.deepEqual(failing.map((step) => step.failed), [false, true, false], "失败步骤要标出来");
assert.deepEqual(failing.map((step) => step.live), [false, false, true], "运行中的步骤要有标记");

// 少于 2 步的片段不单独做组头
const small = deriveTurnItems([user("u"), bash("b1"), text("x")]);
assert.equal(small.filter((item) => item.kind === "turn").length, 0, `少于 ${TURN_MIN_STEPS} 步不折叠`);
assert.equal(small.length, 3, "两步以下的片段逐块显示");

// subagent 这类要交互的工具会断开组，保持独立卡片
const withSubagent = deriveTurnItems([
  user("u"),
  bash("b1"),
  bash("b2"),
  tool("s1", "subagent", { agent: "worker" }),
  bash("b3"),
  bash("b4"),
]);
assert.equal(withSubagent.filter((item) => item.kind === "turn").length, 2, "subagent 前后各成一组");
assert.equal(withSubagent[2]!.kind, "block", "subagent 自己保持独立卡片");
assert.equal(isTurnStep(tool("e", "edit")), true, "edit 要收进组里");

// 失败计数与耗时
const failingTurn = summarizeTurn([
  { block: { ...bash("b1"), ts: 1_000 }, index: 0 },
  { block: { ...bash("b2"), ts: 6_200, isError: true, status: "error" }, index: 1 },
  { block: { ...bash("b3"), ts: 12_400 }, index: 2 },
]);
assert.equal(failingTurn.failedCount, 1, "失败数要统计");
assert.match(failingTurn.summary, /1 处失败/, "组头要提示失败");
assert.equal(turnDurationLabel(failingTurn), "11 秒", `耗时按时间戳算：${turnDurationLabel(failingTurn)}`);
// 时间戳挤在同一毫秒（回放 / 恢复的会话）：用工具自报的耗时之和兜底，组头不能没有总时长
const replayed = summarizeTurn([
  { block: { ...bash("rp1"), ts: 5_000, durationMs: 62_000 }, index: 0 },
  { block: { ...bash("rp2"), ts: 5_000, durationMs: 1_500 }, index: 1 },
]);
assert.equal(replayed.durationMs, 63_500, `时间戳并在一起时用记录耗时之和：${replayed.durationMs}`);
assert.equal(turnDurationLabel(replayed), "1 分 4 秒", `总时长文案：${turnDurationLabel(replayed)}`);
// 正常会话：首尾时间戳差更大，优先用它（并行工具不会把总时长加爆）
const spanned = summarizeTurn([
  { block: { ...bash("sp1"), ts: 1_000, durationMs: 60_000 }, index: 0 },
  { block: { ...bash("sp2"), ts: 121_000, durationMs: 60_000 }, index: 1 },
]);
assert.equal(spanned.durationMs, 120_000, `有时间戳时按首尾差：${spanned.durationMs}`);
assert.equal(turnDurationLabel({ durationMs: 0 }), "0.0 秒", "极短的回合也给一个占位时间，不再空白");
assert.equal(turnDurationLabel({ durationMs: 92_000 }), "1 分 32 秒");
assert.equal(turnDurationLabel({ durationMs: 120_000 }), "2 分");

// 运行中的一轮：显示正在做什么 + 已完成步数
const liveEntries: Array<ActivityEntry<ActivityBlockLike>> = [
  { block: { ...bash("b1", "npm run check"), ts: 1_000 }, index: 0 },
  { block: { ...bash("b2", "npx tsc"), status: "running", ts: 2_000 }, index: 1 },
];
const live = summarizeTurn(liveEntries);
assert.equal(live.live, true);
assert.match(live.summary, /正在运行/, `运行中要说明在做什么：${live.summary}`);
assert.match(live.summary, /已完成 2 步/, `运行中要显示进度：${live.summary}`);

// detail（title 提示）按顺序取前 8 步，超出补 +N
const detail = summarizeTurn(
  Array.from({ length: 10 }, (_, i) => ({ block: { ...bash(`d${i}`, `cmd-${i}`), ts: 1_000 + i }, index: i })),
).detail;
assert.match(detail, /^运行 cmd-0/, `提示从第一步开始：${detail}`);
assert.match(detail, /\+2$/, `超过 8 步要补计数：${detail}`);

console.log("activity-turns OK 回合分组 / 时间线顺序 / 单步摘要 / 单步耗时 / 失败与运行中");
