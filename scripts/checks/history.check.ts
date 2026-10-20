import assert from "node:assert/strict";
import { parseSessionHistory, sliceHistoryPage } from "../../electron/session-history.ts";
import { SESSION_TITLE_MAX, firstUserTitle, sessionTitleFromText } from "../../electron/session-title.ts";

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

// 单页上限：即使为了对齐 user 向前扩，也不能超过 240 条
const boundary = Array.from({ length: 300 }, (_, i) => ({
  role: i === 59 ? "user" : "assistant",
  content: i === 59 ? "q" : [],
}));
const capped = sliceHistoryPage(boundary, 0, 240);
assert.ok(capped.messages.length <= 240, `单页不能超过 240 条，实际 ${capped.messages.length}`);

// 首屏至少 minTurns 轮对话：长工具链会话的尾部可能只有 1 个 user
const toolLoop = [];
toolLoop.push({ role: "user", content: "起点" });
for (let i = 0; i < 200; i += 1) {
  toolLoop.push({ role: i % 2 === 0 ? "assistant" : "toolResult", content: [] });
}
toolLoop.push({ role: "user", content: "最后一问" });
for (let i = 0; i < 30; i += 1) toolLoop.push({ role: i % 2 === 0 ? "assistant" : "toolResult", content: [] });
const tailOnly = sliceHistoryPage(toolLoop, 0, 8);
assert.equal(tailOnly.messages.filter((m) => m.role === "user").length, 1, "仅 8 条时尾部只有一轮");
const withTurns = sliceHistoryPage(toolLoop, 0, 40, { minTurns: 3 });
assert.equal(withTurns.messages.filter((m) => m.role === "user").length, 2, "历史里只有 2 个 user 时全部纳入");
assert.equal(withTurns.startIndex, 0, "向前扩到文件开头");

const normal = [];
for (let i = 0; i < 30; i += 1) {
  normal.push({ role: "user", content: `q${i}` });
  normal.push({ role: "assistant", content: [] });
}
const firstPage = sliceHistoryPage(normal, 0, 40, { minTurns: 3 });
assert.ok(firstPage.messages.length >= 40, "首屏至少 40 条");
assert.equal(firstPage.endIndex, 60);

// minBlocks：长工具链里 8 条原始消息可能只渲染成 4 行，应继续向前扩到至少 8 个块
const sparse: any[] = [];
for (let turn = 0; turn < 6; turn += 1) {
  sparse.push({ role: "user", content: `t${turn}` });
  for (let i = 0; i < 4; i += 1) {
    sparse.push({ role: "assistant", content: [{ type: "thinking", thinking: `think ${turn}-${i}` }] });
    sparse.push({ role: "toolResult", toolCallId: `t${turn}-${i}`, toolName: "bash", content: [] });
  }
}
const plainEight = sliceHistoryPage(sparse, 0, 8);
assert.ok(plainEight.messages.length >= 8 && plainEight.messages.length <= 9, `默认按 8 条原始消息取页，实际 ${plainEight.messages.length}`);
const blockEight = sliceHistoryPage(sparse, 0, 8, { minBlocks: 8 });
assert.ok(blockEight.messages.length > 8, `minBlocks 应扩页，实际 ${blockEight.messages.length} 条`);
assert.ok(blockEight.startIndex < plainEight.startIndex, "minBlocks 页首应更靠前");
assert.equal(blockEight.endIndex, plainEight.endIndex, "endIndex 不变");

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
// 首条消息只有附件标记时，标题不能出现 <file …> 标记
assert.equal(
  sessionTitleFromText('<file name="C:\\tmp\\shot.png"></file>'),
  "shot.png",
  "纯图片消息应退化为文件名",
);
assert.equal(
  sessionTitleFromText('<file name="C:\\tmp\\a.ts">\nconst a = 1;\n</file>'),
  "a.ts",
  "纯文件消息应退化为文件名",
);
assert.equal(
  sessionTitleFromText('<file name="C:\\tmp\\huge.log" size="5242880" inline="false">\n[文件较大，未内联]\n</file>'),
  "huge.log",
  "未内联的大文件标记也应能生成标题",
);
assert.equal(
  sessionTitleFromText('<file name="C:\\tmp\\shot.png"></file>\n\n看看这个布局'),
  "看看这个布局",
  "附件标记不能进入标题",
);

// 会话首条消息的标题识别（决定侧边栏是否把会话当成空会话）
const userLine = (content: any) => line({ type: "message", message: { role: "user", content } });
assert.equal(
  firstUserTitle([userLine([{ type: "image", mimeType: "image/png", data: "abc" }])]),
  "图片消息",
  "只有图片的首条消息不能被当成空会话",
);
assert.equal(firstUserTitle([userLine([])]), "新会话", "存在用户消息但无文本时也不能是空会话");
assert.equal(firstUserTitle([userLine([{ type: "text", text: "hello" }])]), "hello");
assert.equal(firstUserTitle([line({ type: "session", version: 3 })]), "", "没有用户消息才是空会话");
assert.equal(
  firstUserTitle([
    userLine([
      {
        type: "text",
        text: '<file name="C:\\tmp\\a.ts" size="12" inline="false">\n[已通过路径引用]\n</file>',
      },
    ]),
  ]),
  "a.ts",
  "只有路径附件时用文件名做标题",
);
assert.equal(
  firstUserTitle([userLine([{ type: "text", text: `<file name="C:\\tmp\\big.log">\n${'x'.repeat(5000)}\n</file>` }])]),
  "big.log",
  "超长内联内容不能进入标题",
);

console.log(`history.check ok（共 ${history.length} 条，${pages} 页，覆盖 ${covered} 条）`);
