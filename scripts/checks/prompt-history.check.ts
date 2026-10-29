import assert from "node:assert/strict";
import {
  EMPTY_HISTORY_STATE,
  PROMPT_HISTORY_LIMIT,
  appendPromptHistory,
  caretOnFirstLine,
  caretOnLastLine,
  recallNext,
  recallPrevious,
} from "../../packages/ui/src/shared/prompt-history.ts";

/**
 * 输入框历史（↑ / ↓）。
 *
 * 这里钉的都是「没有视觉反馈、错了只能用户撞上」的边界：
 * 翻到最旧再按 ↑、翻回草稿、连续重复、上限裁剪、多行时光标在哪一行。
 */

// ---- 追加 ----
assert.deepEqual(appendPromptHistory([], "  hello  "), ["hello"], "首尾空白要去掉");
assert.deepEqual(appendPromptHistory(["a"], "   "), ["a"], "空内容不入历史");
assert.deepEqual(appendPromptHistory(["a"], "a"), ["a"], "连续重复只留一条");
assert.deepEqual(appendPromptHistory(["a"], "b"), ["a", "b"]);

const long = Array.from({ length: PROMPT_HISTORY_LIMIT }, (_, index) => `m${index}`);
const appended = appendPromptHistory(long, "newest");
assert.equal(appended.length, PROMPT_HISTORY_LIMIT, "超出上限要裁剪");
assert.equal(appended.at(-1), "newest", "新的留在末尾");
assert.equal(appended[0], "m1", "裁掉的是最旧的那条");

// ---- ↑ 向上翻 ----
const history = ["first", "second", "third"];
const up1 = recallPrevious(history, EMPTY_HISTORY_STATE, "半句草稿");
assert.ok(up1);
assert.equal(up1.text, "third", "第一次 ↑ 显示最新一条");
assert.equal(up1.state.draft, "半句草稿", "要记住开始浏览前的草稿");

const up2 = recallPrevious(history, up1.state, up1.text);
assert.ok(up2);
assert.equal(up2.text, "second");

const up3 = recallPrevious(history, up2.state, up2.text);
assert.ok(up3);
assert.equal(up3.text, "first", "能翻到最旧一条");
assert.equal(recallPrevious(history, up3.state, up3.text), null, "最旧一条再按 ↑ 不再变化");

assert.equal(recallPrevious([], EMPTY_HISTORY_STATE, "x"), null, "没有历史时 ↑ 交回给默认行为");

// ---- ↓ 向下翻 ----
const down1 = recallNext(history, up3.state);
assert.ok(down1);
assert.equal(down1.text, "second");
const down2 = recallNext(history, down1.state);
assert.ok(down2);
assert.equal(down2.text, "third");
const backToDraft = recallNext(history, down2.state);
assert.ok(backToDraft);
assert.equal(backToDraft.text, "半句草稿", "翻过最新一条要还原原来的草稿");
assert.equal(backToDraft.state.index, null, "还原后退出浏览状态");
assert.equal(recallNext(history, EMPTY_HISTORY_STATE), null, "没在浏览时 ↓ 交回给默认行为");

// ---- 多行时光标位置 ----
const multiline = "line1\nline2\nline3";
assert.equal(caretOnFirstLine(multiline, 0), true);
assert.equal(caretOnFirstLine(multiline, 3), true, "首行内任意位置都算首行");
assert.equal(caretOnFirstLine(multiline, 6), false, "第二行不该被 ↑ 接管");
assert.equal(caretOnLastLine(multiline, multiline.length), true);
assert.equal(caretOnLastLine(multiline, 6), false, "在第二行时 ↓ 要留给默认行为");
assert.equal(caretOnFirstLine("", 0), true, "空输入框两个方向都算首/末行");
assert.equal(caretOnLastLine("", 0), true);

console.log(`prompt-history OK 追加去重裁剪 / ↑↓ 边界 / 草稿还原 / 多行光标（上限 ${PROMPT_HISTORY_LIMIT}）`);
