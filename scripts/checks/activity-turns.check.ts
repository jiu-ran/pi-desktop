import assert from "node:assert/strict";
import {
  buildActivitySections,
  deriveTurnItems,
  isTurnStep,
  summarizeTurn,
  turnDurationLabel,
  TURN_MIN_STEPS,
  type TurnGroup,
} from "../../packages/ui/src/shared/activity-turns.ts";
import type { ActivityBlockLike, ActivityEntry } from "../../packages/ui/src/shared/activity.ts";

/**
 * 回合分组（一次用户请求 = 一条「执行记录」）。
 * 断言用的是真实会话的规模：5 轮 / 52 个工具 / 46 段思考 —— 原来渲染 47 行，现在 15 行。
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
  // 第 1 轮：24 段思考 + 30 个工具（26 bash / 3 read / 1 write）
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
assert.equal(items.length, 15, `顶层应只有 15 行，实际 ${items.length}（原来 47 行）`);

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

// 组内二级分组：思考 / 读取 / 运行 / 改动
const labels = first.sections.map((section) => section.label);
assert.deepEqual(labels, ["思考", "运行", "读取", "改动"], `二级分组按首次出现排序并合并同类动作：${labels.join("/")}`);
const bashSection = first.sections.find((section) => section.key === "bash")!;
assert.equal(bashSection.count, 26, "26 条命令合成一行");
assert.match(bashSection.preview, /^npm run check/, `预览应显示命令：${bashSection.preview}`);
assert.match(bashSection.preview, /\+\d+$/, "超过 2 条要显示 +N");
const editSection = first.sections.find((section) => section.key === "edit")!;
assert.equal(editSection.entries.length, 1, "write 归到改动");

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
const failing = summarizeTurn([
  { block: { ...bash("b1"), ts: 1_000 }, index: 0 },
  { block: { ...bash("b2"), ts: 6_200, isError: true, status: "error" }, index: 1 },
  { block: { ...bash("b3"), ts: 12_400 }, index: 2 },
]);
assert.equal(failing.failedCount, 1, "失败数要统计");
assert.match(failing.summary, /1 处失败/, "组头要提示失败");
assert.equal(turnDurationLabel(failing), "11 秒", `耗时按时间戳算：${turnDurationLabel(failing)}`);
assert.equal(turnDurationLabel({ durationMs: 0 }), "", "没有时间戳时不显示耗时");
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

// 二级分组顺序按首次出现，同类跨位置也合并
const sections = buildActivitySections([
  { block: bash("b1"), index: 0 },
  { block: think("t1"), index: 1 },
  { block: bash("b2"), index: 2 },
  { block: read("r1"), index: 3 },
]);
assert.deepEqual(sections.map((section) => section.key), ["bash", "thinking", "read"], "分组顺序按首次出现");
assert.equal(sections[0]!.count, 2, "同类的两条命令合并到一组");
assert.equal(sections[1]!.preview, "1 段", "单段思考的预览文案");

console.log("activity-turns OK 回合分组 / 二级分类 / 摘要 / 耗时 / 独立卡片");
