import { blockDiff, diffStat, parseDiff } from "../../packages/ui/src/shared/diff.ts";

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
console.log("OK");
