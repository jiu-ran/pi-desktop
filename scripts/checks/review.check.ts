import assert from "node:assert/strict";
import {
  appendDraft,
  buildReviewPrompt,
  isReviewableLine,
  type ReviewComment,
} from "../../packages/ui/src/shared/review.ts";

assert.equal(buildReviewPrompt([]), "");
assert.equal(isReviewableLine("add"), true);
assert.equal(isReviewableLine("ctx"), true);
assert.equal(isReviewableLine("meta"), false);

const comments: ReviewComment[] = [
  {
    id: "r1",
    path: "src/a.ts",
    lineIndex: 4,
    line: "42",
    side: "new",
    text: "const value = read();",
    body: "这里需要处理空值。",
  },
  {
    id: "r2",
    path: "src/b.ts",
    lineIndex: 1,
    line: "7",
    side: "old",
    text: "const old = 1;\nconst next = 2;",
    body: "这行删除后请确认调用方。\n如果没有调用方，可以删除。",
  },
];
const prompt = buildReviewPrompt(comments);
assert.match(prompt, /请根据以下代码评审意见修改当前工作区/);
assert.match(prompt, /### 1\. src\/a\.ts/);
assert.match(prompt, /第 42 行（当前版本）/);
assert.match(prompt, / {4}const value = read\(\);/);
assert.match(prompt, /这里需要处理空值/);
assert.match(prompt, /### 2\. src\/b\.ts/);
assert.match(prompt, /第 7 行（删除前版本）/);
assert.match(prompt, / {4}const next = 2;/);
assert.match(prompt, / {4}如果没有调用方，可以删除。/);
assert.ok(prompt.indexOf("src/a.ts") < prompt.indexOf("src/b.ts"), "保持添加顺序");

// 代码里出现反引号时不能破坏提示词格式。
const fenced = buildReviewPrompt([{
  id: "r3",
  path: "src/c.ts",
  lineIndex: 0,
  line: "",
  side: "new",
  text: "const tpl = `hello`;",
  body: "保留模板字符串。",
}]);
assert.match(fenced, / {4}const tpl = `hello`;/);

// 超长单行（例如 minified 文件）不能把整行都塞进提示词。
const long = buildReviewPrompt([{
  id: "r4",
  path: "dist/bundle.js",
  lineIndex: 0,
  line: "1",
  side: "new",
  text: "x".repeat(5000),
  body: "确认压缩配置。",
}]);
assert.match(long, /已截断/);
assert.ok(long.includes("x".repeat(2000)), "保留前 2000 个字符");
assert.ok(!long.includes("x".repeat(3000)), "截断后的长串不应出现");

assert.equal(appendDraft("", "review"), "review");
assert.equal(appendDraft("existing", ""), "existing");
assert.equal(appendDraft("existing\n", "\nreview"), "existing\n\nreview");
assert.equal(appendDraft("   ", "review"), "review");

console.log("review OK");
