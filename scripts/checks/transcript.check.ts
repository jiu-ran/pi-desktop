import { createTranscript } from "../../packages/ui/src/kernel/transcript.ts";
import { buildCopyTexts } from "../../packages/ui/src/shared/copy-text.ts";

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

// 工具结果里的图片：保留为缩略图，base64 不能变成文本输出
const imageTranscript = createTranscript();
imageTranscript.loadMessages([
  { role: "assistant", content: [{ type: "toolCall", id: "img1", name: "read", arguments: { path: "a.png" } }] },
  {
    role: "toolResult",
    toolCallId: "img1",
    toolName: "read",
    content: [
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ],
  },
]);
const imageTool = imageTranscript.blocks.find((block) => block.id === "img1");
if (!imageTool || imageTool.imageItems?.length !== 1 || imageTool.images !== 1) {
  throw new Error("工具结果里的图片应保留为 imageItems");
}
if ((imageTool.output ?? "").includes("iVBORw0KGgo")) throw new Error("图片 base64 不应出现在文本输出里");

const liveImage = createTranscript();
liveImage.applyEvent({ type: "tool_execution_start", toolCallId: "img2", toolName: "read", args: { path: "b.png" } });
liveImage.applyEvent({
  type: "tool_execution_end",
  toolCallId: "img2",
  toolName: "read",
  result: { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] },
  isError: false,
});
const liveTool = liveImage.blocks.find((block) => block.id === "img2");
if (!liveTool || liveTool.imageItems?.length !== 1) throw new Error("流式工具结果也应收集图片");

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

// 复制按钮：只在整轮结束后提供完整文本
const copyBlocks: any[] = [
  { kind: "user", id: "u1", text: "问题" },
  { kind: "text", id: "t1", text: "第一段" },
  { kind: "text", id: "t2", text: "第二段" },
];
const copySettled = buildCopyTexts(copyBlocks, false);
if (copySettled.get(2) !== "第一段\n\n第二段") throw new Error("整轮结束后应可复制合并后的回复");
if (buildCopyTexts(copyBlocks, true).size !== 0) throw new Error("会话流式中不应提供复制文本");
const copyPartialBlock = buildCopyTexts([{ kind: "text", id: "t3", text: "半截", streaming: true }] as any, false);
if (copyPartialBlock.size !== 0) throw new Error("单个文本块仍在流式时不应提供复制文本");

// streaming 标记滞后（事件还没到）但后面还有工具在跑：仍然算「本轮没结束」，
// 否则复制按钮会在对话过程中冒出来，复制到半截回复。
const copyWhileToolRuns = buildCopyTexts([
  { kind: "user", id: "u9", text: "看一下" },
  { kind: "text", id: "t9", text: "我先跑一下检查" },
  { kind: "tool", id: "c9", name: "bash", args: {}, status: "running", output: "" },
] as any, false);
if (copyWhileToolRuns.size !== 0) throw new Error("工具仍在运行时不应提供复制文本");
const copyAfterToolDone = buildCopyTexts([
  { kind: "user", id: "u9", text: "看一下" },
  { kind: "text", id: "t9", text: "我先跑一下检查" },
  { kind: "tool", id: "c9", name: "bash", args: {}, status: "done", output: "ok" },
] as any, false);
if (copyAfterToolDone.get(1) !== "我先跑一下检查") throw new Error("工具全部结束后应可复制本轮回复");

// 复制按钮只出现在整段对话的最后一段回复下面：中间段落（包括引导消息拆出来的）不再给。
const copyOnlyLast = buildCopyTexts([
  { kind: "user", id: "u1", text: "第一轮" },
  { kind: "text", id: "t1", text: "第一轮的回复" },
  { kind: "tool", id: "c1", name: "bash", args: {}, status: "done", output: "ok" },
  { kind: "text", id: "t2", text: "中间说明" },
  { kind: "user", id: "u2", text: "第二轮" },
  { kind: "text", id: "t3", text: "第二轮的回复" },
] as any, false);
if (copyOnlyLast.size !== 1) throw new Error("只有最后一段回复应有复制按钮");
if (copyOnlyLast.get(5) !== "第二轮的回复") throw new Error("复制内容应是最后一段回复");
if (copyOnlyLast.has(1) || copyOnlyLast.has(3)) throw new Error("中间段落不应再给复制按钮");

// 引导（steering）消息会把一轮拆成多段：按钮仍然只留在最后，不落在对话中间。
const copyAfterSteering = buildCopyTexts([
  { kind: "user", id: "s1", text: "开始" },
  { kind: "text", id: "s2", text: "先看看文件" },
  { kind: "tool", id: "s3", name: "bash", args: {}, status: "done", output: "ok" },
  { kind: "user", id: "s4", text: "顺便跑一下测试" },
  { kind: "text", id: "s5", text: "都跑完了" },
] as any, false);
if (copyAfterSteering.size !== 1) throw new Error("引导消息后只应有一个复制按钮");
if (copyAfterSteering.get(4) !== "都跑完了") throw new Error("复制按钮应落在最后一段回复");
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

// 技能调用：正文折叠成卡片，只保留技能名与调用者追加的问题
const skill = createTranscript();
const skillText = [
  '<skill name="frontend-design" location="/home/u/.pi/skills/frontend-design/SKILL.md">',
  "References are relative to /home/u/.pi/skills/frontend-design.",
  "",
  "# Frontend",
  "写点东西",
  "</skill>",
  "",
  "帮我做个页面",
].join("\n");
skill.loadMessages([{ role: "user", content: [{ type: "text", text: skillText }] }]);
const skillBlock = skill.blocks[0];
if (skill.blocks.length !== 1 || skillBlock.kind !== "user") throw new Error("技能消息应保留为一个用户块");
if (skillBlock.skill?.name !== "frontend-design") throw new Error("技能名解析失败");
if (skillBlock.text !== "帮我做个页面") throw new Error("应只保留追加的问题");
if (!skillBlock.skill.content.includes("写点东西") || skillBlock.skill.content.includes("</skill>")) throw new Error("技能正文解析失败");

// 只有技能、没有追加问题时也必须保留
const onlySkill = createTranscript();
onlySkill.loadMessages([{ role: "user", content: [{ type: "text", text: '<skill name="a" location="/x/SKILL.md">\nbody\n</skill>' }] }]);
if (onlySkill.blocks.length !== 1 || onlySkill.blocks[0].skill?.name !== "a") throw new Error("纯技能消息不应被丢弃");

console.log("skill OK");

// 自动重试：保留尝试次数，成功后收成一行提示
const retry = createTranscript();
retry.applyEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 3000, errorMessage: "429 Too Many Requests" });
const retryNotice = retry.blocks[0];
if (retryNotice.kind !== "notice" || retryNotice.level !== "warning") throw new Error("重试应生成 warning 提示");
if (retryNotice.retry?.attempt !== 2 || retryNotice.retry.delayMs !== 3000 || retryNotice.retry.done) throw new Error("重试进度不正确");
retry.applyEvent({ type: "auto_retry_end", success: true, attempt: 2 });
if (!retryNotice.retry.done || !retryNotice.retry.success) throw new Error("重试成功后应结束进度");
if (String(retryNotice.level) !== "info" || !retryNotice.text?.includes("成功")) throw new Error("重试成功应更新提示");

// 上下文压缩：运行中可显示，结束后携带摘要与 token 变化
const compaction = createTranscript();
compaction.applyEvent({ type: "compaction_start", reason: "threshold" });
const compactionNotice = compaction.blocks[0];
if (compactionNotice.kind !== "notice" || !compactionNotice.compaction?.running) throw new Error("压缩开始应生成运行中提示");
compaction.applyEvent({
  type: "compaction_end",
  reason: "threshold",
  result: { summary: "## 摘要\n保留关键改动", tokensBefore: 154200, estimatedTokensAfter: 32000 },
  aborted: false,
  willRetry: false,
});
if (compactionNotice.compaction?.running || compactionNotice.compaction?.summary !== "## 摘要\n保留关键改动") throw new Error("压缩结束应保存摘要");
if (!compactionNotice.text?.includes("154.2k → 32.0k")) throw new Error("压缩提示应显示 token 变化");

console.log("notices OK");

// 工具调用流式事件：Pi 的 toolcall_start / toolcall_delta 只带 contentIndex + partial，
// 不含 id / name。必须从 partial 里取，否则会多出一个无名占位块（界面上的空「工具」卡片）。
const toolStream = createTranscript();
const partialCall = { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "echo hi" } };
toolStream.applyEvent({ type: "message_start", message: { role: "assistant", content: [] } });
toolStream.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [] } } });
toolStream.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content: [partialCall] } } });
toolStream.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command":', partial: { content: [partialCall] } } });
toolStream.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: partialCall, partial: { content: [partialCall] } } });
const streamTools = toolStream.blocks.filter((block) => block.kind === "tool");
if (streamTools.length !== 1) throw new Error(`工具块应按 toolCall.id 去重，实际 ${streamTools.length} 个`);
if (streamTools[0].name !== "bash") throw new Error(`工具块名称应取自 partial，实际 ${streamTools[0].name}`);
if (streamTools[0].id !== "call_1") throw new Error("工具块 id 应取自 partial");
if (!toolStream.blocks.some((block) => block.kind === "tool" && block.details?.streamedArgs === '{"command":')) {
  throw new Error("流式参数应累积到 streamedArgs");
}
toolStream.applyEvent({ type: "message_end", message: { role: "assistant", content: [partialCall] } });
if (toolStream.blocks.filter((block) => block.kind === "tool").length !== 1) throw new Error("消息结束后不应残留多余工具块");

// 残留的无名占位块必须被清理，避免界面上出现空「工具」卡片
const stale = createTranscript();
stale.applyEvent({ type: "message_start", message: { role: "assistant", content: [] } });
stale.blocks.push({ kind: "tool", id: "ghost", name: "", args: {}, status: "pending", output: "", details: null, isError: false, durationMs: null });
const withGhost: number = stale.blocks.length;
if (withGhost !== 1) throw new Error("前置条件：应存在一个无名占位块");
stale.applyEvent({ type: "agent_settled" });
const afterSettle: number = stale.blocks.length;
if (afterSettle !== 0) throw new Error("结算后应清掉无名占位工具块");

console.log("tool stream OK");
