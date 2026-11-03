import assert from "node:assert/strict";
import {
  FILE_SORT_DEFAULT,
  FILE_SORT_OPTIONS,
  normalizeSortDirection,
  normalizeSortMode,
  sameSortSetting,
  sortEntries,
} from "../../packages/ui/src/shared/file-sort.ts";

// 文件树排序：文件夹分组 + 名称排序（数字按数值、大小写不敏感、中文按本地规则）
const entry = (name: string, kind: "file" | "folder") => ({ name, kind, relative: name });

const messy = [
  entry("README.md", "file"),
  entry("src", "folder"),
  entry("file10.txt", "file"),
  entry("file2.txt", "file"),
  entry("App.ts", "file"),
  entry("app.ts", "file"),
  entry("node_modules", "folder"),
  entry("中文.md", "file"),
];

assert.deepEqual(
  sortEntries(messy).map((item) => `${item.kind === "folder" ? "D" : "F"}:${item.name}`),
  [
    "D:node_modules",
    "D:src",
    "F:App.ts",
    "F:app.ts",
    "F:file2.txt",
    "F:file10.txt",
    "F:README.md",
    "F:中文.md",
  ],
  "文件夹在前 + 名称 A→Z：数字按数值排、大小写不敏感、中文排在拉丁字母之后",
);

assert.deepEqual(
  sortEntries(messy, { mode: "mixed", direction: "asc" }).map((item) => item.name),
  ["App.ts", "app.ts", "file2.txt", "file10.txt", "node_modules", "README.md", "src", "中文.md"],
  "混合模式：不分类型，纯按名字",
);

assert.deepEqual(
  sortEntries(messy, { mode: "folders-first", direction: "desc" }).map((item) => item.name),
  ["src", "node_modules", "中文.md", "README.md", "file10.txt", "file2.txt", "app.ts", "App.ts"],
  "倒序时文件夹仍然在前，只是各自内部倒过来",
);

assert.deepEqual(
  sortEntries(messy, { mode: "mixed", direction: "desc" }).map((item) => item.name),
  ["中文.md", "src", "README.md", "node_modules", "file10.txt", "file2.txt", "app.ts", "App.ts"],
  "混合 + 倒序：整体倒过来",
);

// 不改入参
const original = [...messy];
sortEntries(messy);
assert.deepEqual(messy, original, "排序要返回副本，不能改原数组");

// 同名不同路径时结果稳定（否则每次渲染都可能换顺序）
const twins = [entry("a", "file"), { name: "a", kind: "file" as const, relative: "z/a" }, { name: "a", kind: "file" as const, relative: "b/a" }];
const first = sortEntries(twins).map((item) => item.relative);
const second = sortEntries([...twins].reverse()).map((item) => item.relative);
assert.deepEqual(first, second, "同名项用路径兜底，顺序必须稳定");
assert.deepEqual(first, ["a", "b/a", "z/a"], "兜底按相对路径升序");

// 设置规整
assert.equal(normalizeSortMode("mixed"), "mixed");
assert.equal(normalizeSortMode("nope"), "folders-first");
assert.equal(normalizeSortDirection("desc"), "desc");
assert.equal(normalizeSortDirection(undefined), "asc");
assert.deepEqual(FILE_SORT_DEFAULT, { mode: "folders-first", direction: "asc" }, "默认是 VS Code 那种：文件夹在前、名称升序");

// 菜单四项：两种分组 × 两种方向，且互不重复
assert.equal(FILE_SORT_OPTIONS.length, 4);
assert.equal(new Set(FILE_SORT_OPTIONS.map((option) => `${option.mode}:${option.direction}`)).size, 4);
assert.ok(FILE_SORT_OPTIONS.every((option) => option.label.trim().length > 0));
assert.equal(sameSortSetting({ mode: "mixed", direction: "desc" }, { mode: "mixed", direction: "desc" }), true);
assert.equal(sameSortSetting({ mode: "mixed", direction: "asc" }, { mode: "folders-first", direction: "asc" }), false);

console.log("file-sort OK 文件夹在前 / 混合 / 双向 / 数字与大小写 / 稳定 / 菜单项");
