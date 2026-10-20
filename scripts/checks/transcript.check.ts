import { createTranscript } from "../../packages/ui/src/kernel/transcript.ts";

const t = createTranscript();
t.loadMessages([
  { role: "system", content: "" },
  { role: "user", content: [{ type: "text", text: "你好" }] },
  { role: "assistant", content: [
    { type: "thinking", thinking: "想一下" },
    { type: "text", text: "我先看文件" },
    { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
  ] },
  { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "line1" }], isError: false, durationMs: 12 },
]);
console.log("history", t.blocks.map((b) => `${b.kind}:${b.status ?? ""}:${(b.text ?? b.output ?? "").slice(0, 10)}`).join(" | "));

const events = [
  { type: "message_start", message: { role: "user" } },
  { type: "message_end", message: { role: "user" } },
  { type: "message_start", message: { role: "assistant" } },
  { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "分析" } },
  { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "改" } },
  { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "一下" } },
  { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, id: "c2", toolName: "edit" } },
  { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: { id: "c2", name: "edit", arguments: { path: "b.ts" } } } },
  { type: "message_end", message: { role: "assistant", stopReason: "toolUse" } },
  { type: "tool_execution_start", toolCallId: "c2", toolName: "edit", args: { path: "b.ts" } },
  { type: "tool_execution_end", toolCallId: "c2", toolName: "edit", result: { content: [{ type: "text", text: "ok" }] }, isError: false, durationMs: 5 },
];
for (const e of events) t.applyEvent(e);
console.log("live", t.blocks.map((b) => `${b.kind}:${b.status ?? (b.streaming ? "stream" : "")}:${(b.text ?? b.output ?? "").slice(0, 10)}`).join(" | "));
const partial = createTranscript();
partial.applyEvent({ type: "message_start", message: { role: "assistant" } });
partial.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "partial" } });
partial.applyEvent({ type: "agent_settled" });
const partialBlock = partial.blocks.find((b) => b.kind === "text");
if (!partialBlock || partialBlock.streaming || partialBlock.details?.partial !== true) {
  throw new Error("settled streams should finalize partial blocks");
}
const stuckTool = createTranscript();
stuckTool.applyEvent({ type: "tool_execution_start", toolCallId: "c3", toolName: "bash", args: {} });
stuckTool.applyEvent({ type: "agent_settled" });
const settledTool = stuckTool.blocks.find((block) => block.id === "c3");
if (!settledTool || settledTool.status !== "done") throw new Error("agent_settled should finish running tools");
const tool = t.blocks.find((b) => b.id === "c2");
if (!tool || tool.status !== "done" || tool.args?.path !== "b.ts" || tool.output !== "ok") throw new Error("tool merge failed");
if (t.blocks.filter((b) => b.kind === "tool" && b.id === "c2").length !== 1) throw new Error("duplicate tool");

const replay = createTranscript();
const snapshotMessages = [
  { role: "user", content: [{ type: "text", text: "检查状态" }] },
  { role: "assistant", content: [{ type: "text", text: "Pi 返回的最终结果" }] },
];
replay.loadMessages(snapshotMessages);
replay.attachUsage("Token：总计 18");
const usageBlock = replay.blocks.find((block) => block.kind === "text");
if (usageBlock?.usageText !== "Token：总计 18") throw new Error("用量必须附加到当前轮回复");
const snapshot = createTranscript();
snapshot.loadMessages(snapshotMessages);
const visible = (blocks: Array<{ kind: string; text?: string }>) => blocks.filter((block) => block.kind === "text").map((block) => block.text);
if (JSON.stringify(visible(replay.blocks)) !== JSON.stringify(visible(snapshot.blocks))) {
  throw new Error("RPC 快照必须能覆盖由事件派生的消息状态");
}
console.log("OK");

// 用户消息：附件标记应从正文剥除，图片以数据形式保留供缩略图展示
const withFiles = createTranscript();
withFiles.loadMessages([{
  role: "user",
  content: [
    { type: "text", text: '<file name="C:\\tmp\\shot.png"></file>\n\n看这个 bug' },
    { type: "image", mimeType: "image/png", data: "AAAA" },
    { type: "text", text: '<file name="C:\\a\\b.ts">\nconst a = 1;\n</file>' },
    { type: "text", text: '<directory name="C:\\a\\dir">\n./x\n</directory>' },
  ],
}]);
const ub = withFiles.blocks[0];
if (ub?.text !== "看这个 bug") throw new Error(`附件标记未被剥除：${JSON.stringify(ub?.text)}`);
if (ub.attachments?.length !== 2) throw new Error("附件数量不正确（图片应由缩略图展示）");
if (JSON.stringify(ub.attachments?.map((a) => a.name)) !== JSON.stringify(["b.ts", "dir"])) {
  throw new Error(`附件名称不正确：${JSON.stringify(ub.attachments?.map((a) => a.name))}`);
}
if (ub.attachments[1].kind !== "folder") throw new Error("目录附件类型不正确");
if (ub.images !== 1 || ub.imageItems?.[0]?.data !== "AAAA") throw new Error("图片数据未保留");
if (ub.text?.includes("const a = 1")) throw new Error("文件内容不应出现在气泡里");

// 仅有非图片附件时也要生成气泡
const onlyFile = createTranscript();
onlyFile.loadMessages([{ role: "user", content: [{ type: "text", text: '<file name="C:\\a\\notes.md">\n# hi\n</file>' }] }]);
if (onlyFile.blocks.length !== 1 || onlyFile.blocks[0].attachments?.length !== 1) throw new Error("纯附件消息未渲染");
if (onlyFile.blocks[0].text !== "") throw new Error("文件内容不应出现在气泡里");

// 超大文件的标记：内容未内联，前端要能展示大小与「未内联」提示
const bigFile = createTranscript();
bigFile.loadMessages([{
  role: "user",
  content: [{ type: "text", text: '看看这个日志\n<file name="C:\\tmp\\huge.log" size="5242880" inline="false">\n[文件较大（5.0 MB），未内联到对话中。]\n</file>' }],
}]);
const bigBlock = bigFile.blocks[0];
if (bigBlock?.text !== "看看这个日志") throw new Error(`大文件标记未被剥除：${JSON.stringify(bigBlock?.text)}`);
if (bigBlock.attachments?.[0]?.inlined !== false) throw new Error("大文件应标记为未内联");
if (bigBlock.attachments?.[0]?.size !== 5242880) throw new Error("大文件大小未解析");
if (!bigBlock.attachments?.[0]?.name) throw new Error("大文件名丢失");

console.log("attachments ok");

// 发送失败回滚：pushUser 必须返回块，removeBlock 只移除指定块
const removable = createTranscript();
const firstUser = removable.pushUser("还没发出去", 0);
const secondUser = removable.pushUser("下一条", 0);
if (!firstUser?.id || removable.blocks.length !== 2) throw new Error("pushUser 应返回新建块");
removable.removeBlock(firstUser.id);
const afterCount: number = removable.blocks.length;
if (afterCount !== 1 || removable.blocks[0].id !== secondUser.id) {
  throw new Error("removeBlock 只应移除指定的乐观消息");
}
removable.removeBlock("not-exists");
if (removable.blocks.filter((block) => block.id === secondUser.id).length !== 1) {
  throw new Error("removeBlock 不存在的 id 不应改变内容");
}
console.log("removeBlock ok");
