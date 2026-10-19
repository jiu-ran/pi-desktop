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
