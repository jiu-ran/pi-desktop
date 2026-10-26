import assert from "node:assert/strict";
import {
  MERGE_MIN_STEPS,
  buildTimelineRows,
  canMergePair,
  compactValues,
  matchTarget,
  runAffixes,
  runTarget,
} from "../../packages/ui/src/shared/timeline-rows.ts";

type Step = {
  key: string;
  kind: "thinking" | "tool";
  target: string;
  failed: boolean;
  live: boolean;
  id: string;
};

const step = (id: string, target: string, key = "bash", extra: Partial<Step> = {}): Step => ({
  id,
  key,
  kind: key === "thinking" ? "thinking" : "tool",
  target,
  failed: false,
  live: false,
  ...extra,
});

// ---- 前缀比对：找出「只有中间在变」 ----
const apMatch = matchTarget("cat > scripts/checks/_ap1.cjs <<'CJS'", "cat > scripts/checks/_ap2.cjs <<'CJS'");
assert.ok(apMatch, "两条只差文件名要能比对出来");
assert.equal(apMatch!.prefix, "cat > scripts/checks/_ap");
assert.equal(apMatch!.changed, "2", "变化段取的是当前这一步的差异部分");
assert.equal(apMatch!.suffix, ".cjs <<'CJS'");
assert.equal(apMatch!.mergeable, true, "相同部分占绝大多数，可以合并");

const unrelated = matchTarget("npm run check", "git status --short");
assert.ok(unrelated, "不同命令也能切出差异（整段不同）");
assert.equal(unrelated!.mergeable, false, "差异太大不该合并");
assert.equal(matchTarget("完全一样", "完全一样"), null, "完全相同的两步不产生前缀压缩");
assert.equal(matchTarget("", "x"), null, "空摘要不参与比对");

// ---- 能不能合并 ----
assert.equal(canMergePair(step("a", "npm run check -- 0"), step("b", "npm run check -- 1")), true);
assert.equal(canMergePair(step("a", "npm run check -- 0"), step("b", "npm run check -- 1", "read")), false, "不同工具不合并");
assert.equal(
  canMergePair(step("a", "读 a.ts", "read"), step("b", "读 b.ts", "read")),
  true,
  "同类工具只差文件名可以合并",
);
assert.equal(canMergePair(step("t1", "先看看", "thinking"), step("t2", "再看看", "thinking")), false, "思考不合并");

// ---- 一组步骤的共同前后缀 ----
const catSteps = Array.from({ length: 4 }, (_, index) =>
  step(`c${index}`, `cat > scripts/checks/_ap${index + 1}.cjs <<'CJS'`));
const affixes = runAffixes(catSteps);
assert.equal(affixes.prefix, "cat > scripts/checks/_ap");
assert.equal(affixes.suffix, ".cjs <<'CJS'");
assert.deepEqual(affixes.values, ["1", "2", "3", "4"]);

// ---- 变化段压成区间 ----
assert.equal(compactValues(["1", "2", "3", "4"]), "1..4");
assert.equal(compactValues(["0", "1", "2"]), "0..2");
assert.equal(compactValues(["1", "3", "5"]), "1|3|5", "不连续的数字逐个列出");
assert.equal(compactValues(["a", "b"]), "a|b");
assert.equal(compactValues(["a", "b", "c", "d"]), "a|b|c|…", "超过三个只列前三个");
assert.equal(runTarget(catSteps), "cat > scripts/checks/_ap{1..4}.cjs <<'CJS'");

// ---- 用户截图里的那一组：4 条 cat + 1 段思考 ----
const screenshot = [
  step("s1", "cat > scripts/checks/_ap1.cjs <<'CJS'"),
  step("s2", "cat > scripts/checks/_ap2.cjs <<'CJS'"),
  step("s3", "cat > scripts/checks/_ap3.cjs <<'CJS'"),
  step("s4", "Typecheck passes. Now: 1. CSS: chat inline code…", "thinking"),
  step("s5", "cat > scripts/checks/_ap4.cjs <<'CJS'"),
];
{
  const merged = buildTimelineRows(screenshot, { merge: true });
  assert.equal(merged.length, 3, `4 条同类命令 + 思考应压成 3 行，实际 ${merged.length}`);
  assert.equal(merged[0]!.kind, "run");
  if (merged[0]!.kind === "run") {
    assert.equal(merged[0]!.steps.length, 3, "连续同类的三条先合并（思考打断了后面的）");
    assert.match(merged[0]!.target, /_ap\{1\.\.3\}\.cjs/);
  }
  assert.equal(merged[1]!.kind, "step", "思考保持独立一行");
  assert.equal((merged[1] as { startIndex: number }).startIndex, 4, "思考是第 4 步（前 3 条命令合并占 1–3）");
  assert.equal((merged[0] as { startIndex: number }).startIndex, 1, "第一行从第 1 步开始");
  assert.equal(merged[2]!.kind, "step", "最后一条不足 3 步，退回单步");
  if (merged[2]!.kind === "step") assert.match(merged[2]!.step.target, /_ap4.cjs/);
}
{
  // 关掉合并：每步一行，但相邻同类步骤带上淡化用的前缀信息
  const rows = buildTimelineRows(screenshot, { merge: false });
  assert.equal(rows.length, 5, "不合并时行数不变");
  assert.equal(rows[0]!.kind, "step");
  if (rows[0]!.kind === "step") assert.equal(rows[0]!.match, undefined, "第一步没有上一步可比");
  if (rows[1]!.kind === "step") {
    assert.ok(rows[1]!.match, "第二步应带上「相同前缀」信息");
    assert.equal(rows[1]!.match!.changed, "2");
  }
  if (rows[3]!.kind === "step") assert.equal(rows[3]!.match, undefined, "换类型（思考）不该淡化");
}

// ---- 合并的边界 ----
{
  // 只有两条相同的命令：不到阈值，逐步显示（但会淡化）
  const two = [step("a", "npm run check -- 0"), step("b", "npm run check -- 1")];
  assert.equal(buildTimelineRows(two, { merge: true }).length, 2, `少于 ${MERGE_MIN_STEPS} 步不合并`);
  assert.equal(buildTimelineRows(two, { merge: true, minRun: 2 }).length, 1, "阈值可以调低");
  // 中间夹了一条不同的：断开，不合并
  const broken = [
    step("a", "npm run check -- 0"),
    step("b", "npm run check -- 1"),
    step("c", "git status"),
    step("d", "npm run check -- 2"),
    step("e", "npm run check -- 3"),
  ];
  const rows = buildTimelineRows(broken, { merge: true, minRun: 2 });
  assert.equal(rows.length, 3, `被打断的连续段要分开合并，实际 ${rows.length} 行`);
  assert.equal(rows[1]!.kind, "step", "中间那条单独成行");
}

// ---- 失败 / 运行中的状态要带到合并行上 ----
{
  const rows = buildTimelineRows([
    step("a", "npm run check -- 0"),
    step("b", "npm run check -- 1", "bash", { failed: true }),
    step("c", "npm run check -- 2"),
  ]);
  assert.equal(rows[0]!.kind, "run");
  if (rows[0]!.kind === "run") {
    assert.equal(rows[0]!.failed, true, "组里有一条失败，合并行要标出来");
    assert.equal(rows[0]!.live, false);
  }
  const liveRows = buildTimelineRows([
    step("a", "npm run check -- 0"),
    step("b", "npm run check -- 1", "bash", { live: true }),
    step("c", "npm run check -- 2"),
  ]);
  if (liveRows[0]!.kind === "run") assert.equal(liveRows[0]!.live, true, "运行中也要带出来");
}

// ---- 无共同前后缀时不瞎合并 ----
{
  const rows = buildTimelineRows([
    step("a", "npm run check"),
    step("b", "git status --short"),
    step("c", "npx tsc --noEmit"),
  ]);
  assert.equal(rows.length, 3, "三条互不相同的命令不该被合并");
  assert.ok(rows.every((row) => row.kind === "step"));
}

console.log("timeline-rows OK 同前缀淡化 / 参数合并 / 阈值与打断 / 状态传递");
