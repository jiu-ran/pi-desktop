import assert from "node:assert/strict";
import {
  DIGEST_MAX_CHARS,
  DIGEST_PER_MESSAGE,
  formatSessionDigest,
  sessionContextBlock,
  stripAttachmentMarkers,
} from "../../electron/session-context.ts";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });

// 工具结果不进上文：里面是成片的命令输出，对理解对话没有帮助
const digest = formatSessionDigest([
  user("帮我把登录改成 JWT"),
  assistant("好的，我先看现有实现"),
  { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "y".repeat(50_000) }] },
  { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: { path: "a.ts" } }, { type: "text", text: "已经改好了" }] },
]);
assert.ok(digest.text.includes("帮我把登录改成 JWT"), "用户消息应保留");
assert.ok(digest.text.includes("已经改好了"), "助手回复应保留");
assert.ok(!digest.text.includes("yyyy"), "工具结果不应进上文");
assert.ok(!digest.text.includes("arguments"), "工具调用参数不应进上文");

// 长消息逐条截断，但总体不能超过上限
const long = formatSessionDigest(
  Array.from({ length: 30 }, (_, i) => user(`第 ${i} 条 ${"字".repeat(3000)}`)),
  { perMessageChars: 200, maxChars: 1000 },
);
assert.ok(long.text.length < 1000 + 400, `整体应受上限约束，实际 ${long.text.length}`);
assert.ok(long.text.includes("省略"), "中间省略必须有标记");
assert.ok(long.text.startsWith("用户：第 0 条"), "开头保留最前面的消息");
assert.ok(long.text.includes("第 29 条"), "结尾保留最新的消息");
assert.ok(long.kept + long.omitted === 30, `保留 + 省略应等于总数，实际 ${long.kept}+${long.omitted}`);

// 默认上限
assert.equal(DIGEST_PER_MESSAGE, 700);
assert.equal(DIGEST_MAX_CHARS, 12_000);

// 内联附件（可能有几 MB）只留一行说明
const withAttachment = formatSessionDigest([
  user(`看看这个 <file name="C:\\a\\big.log">\n${"x".repeat(10_000)}\n</file> 有什么问题`),
]);
assert.ok(withAttachment.text.includes("[文件: C:\\a\\big.log]"), "附件标记应换成说明");
assert.ok(!withAttachment.text.includes("xxxx"), "附件正文不应进上文");
assert.equal(stripAttachmentMarkers('<directory name="C:\\d">\n树\n</directory>'), "[目录: C:\\d]");

// 空会话
const empty = formatSessionDigest([]);
assert.equal(empty.kept, 0);
assert.ok(empty.text.includes("还没有可读的文字内容"));

// 会话块的属性：name 是文件路径（历史渲染要按它还原成附件卡片），title 是会话名
const block = sessionContextBlock({
  file: "C:\\sessions\\a&b.jsonl",
  title: '登录 <改造> "任务"',
  messages: [user("第一句"), assistant("第二句")],
});
assert.ok(block.startsWith('<session name="C:\\sessions\\a&amp;b.jsonl" title="登录 &lt;改造&gt; &quot;任务&quot;" messages="2">'), block.slice(0, 120));
assert.ok(block.includes("第一句") && block.includes("第二句"));
assert.ok(block.trimEnd().endsWith("</session>"));

console.log("session-context.check ok 截断 / 省略 / 附件剥离 / XML 转义");

// 发送时的拼接顺序：对话上下文 → 文件附件 → 用户这次说的话
{
  const { composePrompt } = await import("../../packages/ui/src/shared/prompt.ts");
  // 注意：这里的 "\n" 在源码里是换行转义，用于确认尾随空白会被裁掉
  const prompt = composePrompt({
    sessionText: '<session name="a.jsonl">\n对话摘要\n</session>',
    fileText: '<file name="b.ts">\nexport const a = 1;\n</file>',
    message: "顺便看看这个会话",
  });
  const order = ["<session name=", "<file name=", "顺便看看这个会话"].map((token) => prompt.indexOf(token));
  assert.deepEqual([...order].sort((x, y) => x - y), order, "拼接顺序应为 会话 → 文件 → 用户输入");
  assert.ok(prompt.endsWith("顺便看看这个会话"), "用户输入必须在最后");
  assert.ok(!prompt.includes("\n\n\n"), "不能留下多余空行");
  assert.equal(composePrompt({ message: "只有一句话" }), "只有一句话");
  assert.equal(composePrompt({}), "");
  console.log("composePrompt OK 顺序 / 去空");
}

// 条数说明要区分「原始消息」与「有文字的消息」：工具结果占大头时不能让人误以为丢了大半对话
{
  const raw = [
    ...Array.from({ length: 6 }, () => ({ role: "toolResult", toolName: "bash", content: [{ type: "text", text: "out" }] })),
    user("问题一"),
    assistant("回答一"),
  ];
  const summary = formatSessionDigest(raw);
  assert.equal(summary.total, 2, "只有两条消息有文字");
  const text = sessionContextBlock({ file: "a.jsonl", title: "混合", messages: raw });
  assert.ok(text.includes("共 8 条消息（其中 2 条有文字），这里保留 2 条"), text.split("\n")[1]);
  console.log("digest 条数说明 OK");
}
