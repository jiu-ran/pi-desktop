import assert from "node:assert/strict";
import { parseSessionHistory, sliceHistoryPage } from "../../electron/session-history.ts";
import { SESSION_TITLE_MAX, sessionTitleFromText } from "../../electron/session-title.ts";

function line(obj: any): string {
  return JSON.stringify(obj);
}

// v3 会话文件：消息嵌在 { type: "message", message: {...} } 里
const fixture = [
  line({ type: "session", version: 3, id: "abc", cwd: "C:/tmp" }),
  line({ type: "model_change", id: "m1", provider: "p", modelId: "x" }),
  line({ type: "message", id: "e1", message: { role: "system", content: "sys" } }),
  ...Array.from({ length: 20 }, (_, i) =>
    line({
      type: "message",
      id: `e${i + 2}`,
      message:
        i % 2 === 0
          ? { role: "user", content: [{ type: "text", text: `u${i / 2}` }] }
          : { role: "assistant", content: [{ type: "text", text: `a${(i - 1) / 2}` }] },
    }),
  ),
  line({ type: "compaction", id: "c1", summary: "..." }),
  line({ type: "message", id: "t1", message: { role: "toolResult", toolCallId: "x", toolName: "bash", content: [] } }),
  "not-json",
  "",
].join("\n");

const history = parseSessionHistory(fixture);
assert.equal(history.length, 21, "只统计 user/assistant/toolResult，跳过 session/model_change/system/compaction");
assert.deepEqual(history.map((m) => m.role).slice(0, 3), ["user", "assistant", "user"]);
assert.equal(history.at(-1).role, "toolResult");

// 尾页：默认 8 条，落在末尾（允许向前对齐 user 多取几条）
const tail = sliceHistoryPage(history, 0, 8);
assert.equal(tail.total, 21);
assert.equal(tail.endIndex, 21);
assert.ok(tail.messages.length >= 8 && tail.messages.length <= 68, `尾页条数 ${tail.messages.length}`);
assert.equal(tail.startIndex, 21 - tail.messages.length);
assert.equal(tail.messages.at(-1).role, "toolResult");

// 向前翻页：不重不漏，直到 0
let cursor = tail.startIndex;
let pages = 1;
const seen: number[] = [];
while (cursor > 0) {
  const page = sliceHistoryPage(history, cursor, 8);
  assert.ok(page.endIndex === cursor, "页尾必须接上一页页首");
  assert.ok(page.startIndex < page.endIndex, "必须往前推进");
  seen.push(page.messages.length);
  cursor = page.startIndex;
  pages += 1;
  assert.ok(pages < 20, "翻页次数异常");
}
assert.equal(cursor, 0, "最终必须回到文件开头");
const covered = tail.messages.length + seen.reduce((a, b) => a + b, 0);
assert.equal(covered, history.length, `累计覆盖 ${covered} 条，应恰好为 ${history.length} 条（不重不漏）`);

// 页首对齐 user：不把一轮对话从中间切开
const aligned = sliceHistoryPage(history, 21, 5);
assert.equal(history[aligned.startIndex]?.role, "user", "页首应尽量对齐到 user 消息");

// limit 边界
assert.ok(sliceHistoryPage(history, 21, 0).messages.length >= 1, "limit=0 时至少返回 1 条");
assert.equal(sliceHistoryPage(history, 21, 9999).messages.length, 21, "limit 超长时返回全部");
assert.equal(sliceHistoryPage([], 0, 8).total, 0, "空历史安全");

// 旧格式（顶层 role）仍需兼容
const legacy = parseSessionHistory([line({ role: "user", content: "hi" }), line({ role: "system" })].join("\n"));
assert.equal(legacy.length, 1);

// 会话标题：长文本必须被截断（否则删除确认弹窗会被撑爆）
const longText = "npm warn deprecated rimraf@2.6.3: Rimraf versions prior to v4 are no longer supported " .repeat(6);
const title = sessionTitleFromText(longText);
assert.equal(title.length, SESSION_TITLE_MAX + 1, "超长标题应截断到上限 + 省略号");
assert.ok(title.endsWith("…"));
assert.equal(sessionTitleFromText("  多条\n空行   的标题 "), "多条 空行 的标题", "应压缩空白");
assert.equal(sessionTitleFromText(""), "");
assert.equal(sessionTitleFromText(undefined), "");

console.log(`history.check ok（共 ${history.length} 条，${pages} 页，覆盖 ${covered} 条）`);
