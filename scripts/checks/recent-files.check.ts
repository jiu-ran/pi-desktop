import assert from "node:assert/strict";
import { loadRecentFiles, rememberRecentFile } from "../../packages/ui/src/shared/recent-files.ts";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
};

assert.deepEqual(loadRecentFiles(""), []);
assert.deepEqual(loadRecentFiles("/repo"), []);

rememberRecentFile("/repo", "src/a.ts");
rememberRecentFile("/repo", "src/b.ts");
assert.deepEqual(loadRecentFiles("/repo"), ["src/b.ts", "src/a.ts"]);

// 重复打开只移动到最前，不产生重复项。
rememberRecentFile("/repo", "src/a.ts");
assert.deepEqual(loadRecentFiles("/repo"), ["src/a.ts", "src/b.ts"]);

// 项目外的绝对路径不进入“最近打开”，避免快速打开跳到项目外。
rememberRecentFile("/repo", "/tmp/outside.ts");
rememberRecentFile("/repo", `C:${String.fromCharCode(92)}temp${String.fromCharCode(92)}outside.ts`);
await Promise.resolve();
assert.deepEqual(loadRecentFiles("/repo"), ["src/a.ts", "src/b.ts"]);

// 最近列表最多 20 条。
for (let i = 0; i < 25; i += 1) rememberRecentFile("/repo", `src/f${i}.ts`);
const recent = loadRecentFiles("/repo");
assert.equal(recent.length, 20);
assert.equal(recent[0], "src/f24.ts");
assert.ok(!recent.includes("src/a.ts"));

console.log("recent-files OK");
