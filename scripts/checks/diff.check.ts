import { blockDiff, diffStat, mergeHunks, parseDiff, parseUnifiedDiff } from "../../packages/ui/src/shared/diff.ts";

const diff = [
  "  9 const a = 1;",
  "-10 const b = 2;",
  "+10 const b = 3;",
  "+11 const c = 4;",
  "    ...",
  " 42 export {};",
].join("\n");

const lines = parseDiff(diff);
for (const l of lines) console.log(JSON.stringify(l));
if (lines.filter((l) => (l.type === "add" || l.type === "del") && !l.num).length) throw new Error("line number lost");
if (lines[1].text !== "const b = 2;" || lines[2].num !== "10") throw new Error("parse mismatch");
if (lines[4].type !== "gap") throw new Error("gap not detected");
const stat = diffStat(lines);
if (stat.added !== 2 || stat.removed !== 1) throw new Error("stat mismatch");

const pending = blockDiff({ name: "edit", args: { edits: [{ oldText: "a\nb", newText: "c" }] } });
if (diffStat(pending).added !== 1 || diffStat(pending).removed !== 2) throw new Error("pending edit preview");
const write = blockDiff({ name: "write", args: { content: "x\ny\nz" } });
if (write.length !== 3 || write[2].num !== "3") throw new Error("write preview");

// 会话快照：多段改动合成一份连续 diff，只保留省略行作为分隔
const merged = mergeHunks([
  { lines: [{ type: "del", num: "1", text: "a" }, { type: "add", num: "1", text: "b" }] },
  { lines: [{ type: "add", num: "9", text: "c" }] },
]);
if (merged.map((line) => line.type).join(",") !== "del,add,gap,add") throw new Error("会话快照应合并成一份 diff");
if (diffStat(merged).added !== 2 || diffStat(merged).removed !== 1) throw new Error("合并后统计应保持不变");

// 实时 diff：hunk 头作为 meta 行，不再用空行分隔
const patch = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " ctx",
  "@@ -20,1 +20,2 @@",
  "+extra",
].join(String.fromCharCode(10));
const live = parseUnifiedDiff(patch);
if (live.length !== 1 || live[0].file !== "a.ts") throw new Error("实时 diff 应按文件分组");
if (live[0].lines[0].type !== "meta" || !live[0].lines[0].text.startsWith("@@ -1,2 +1,2 @@")) throw new Error("应渲染 hunk 头");
if (live[0].added !== 2 || live[0].removed !== 1) throw new Error("实时 diff 统计错误");
if (live[0].lines.filter((line) => line.type === "meta").length !== 2) throw new Error("多 hunk 应保留各自 hunk 头");

console.log("OK");
