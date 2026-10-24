import assert from "node:assert/strict";
import {
  planQueueView,
  queueDraftText,
  queuePreview,
  stripQueueMarkers,
} from "../../packages/ui/src/shared/queue-view.ts";

const block = (id: string, text: string, queueText?: string) => ({ id, kind: "user", text, queueText });

// 已经在对话里渲染出来的消息：队列里那条不该再显示成「待发送」
{
  const plan = planQueueView([block("u1", "顺便查一下日志", "顺便查一下日志")], {
    steering: [],
    followUp: ["顺便查一下日志"],
  });
  assert.deepEqual(plan.pending, [], "已经渲染过的排队消息不应再列一遍");
  assert.deepEqual(plan.queuedIds, ["u1"], "对应气泡应标成排队中");
}

// 带附件时，Pi 队列里存的是完整提示词（含 <file> 块），要按 queueText 对上
{
  const prompt = '<file name="C:\\a\\log.txt">\n内容\n</file>\n看看这个';
  const plan = planQueueView([block("u1", "看看这个", prompt)], { steering: [], followUp: [prompt] });
  assert.deepEqual(plan.pending, [], "带附件的排队消息也要能对上气泡");
  assert.deepEqual(plan.queuedIds, ["u1"]);
}

// 对不上的（别的客户端排进来的）才显示成待发送
{
  const plan = planQueueView([block("u1", "我的消息", "我的消息")], {
    steering: [],
    followUp: ["我的消息", "别人排进来的"],
  });
  assert.deepEqual(plan.pending, [{ mode: "followUp", text: "别人排进来的" }], "对不上的条目要显示");
  assert.deepEqual(plan.queuedIds, ["u1"], "对上的那条只标气泡");
}

// 同一条消息排队两次：第二次没有气泡可对，就显示成待发送
{
  const plan = planQueueView([block("u1", "重复", "重复")], { steering: [], followUp: ["重复", "重复"] });
  assert.equal(plan.queuedIds.length, 1, "一个气泡只能对一条队列项");
  assert.deepEqual(plan.pending, [{ mode: "followUp", text: "重复" }], "多出来的那条要显示");
}

// 插话（steer）与追加（followUp）都参与匹配，顺序按队列顺序
{
  const plan = planQueueView([], { steering: ["插话一句"], followUp: ["再补一句"] });
  assert.deepEqual(plan.pending, [
    { mode: "steer", text: "插话一句" },
    { mode: "followUp", text: "再补一句" },
  ]);
}

// 空队列：什么都不显示
assert.deepEqual(planQueueView([block("u1", "x", "x")], { steering: [], followUp: [] }), { pending: [], queuedIds: [] });
assert.deepEqual(planQueueView([], null), { pending: [], queuedIds: [] });

// 换行差异不应影响匹配
{
  const plan = planQueueView([block("u1", "第一行", "第一行\r\n第二行")], {
    steering: [],
    followUp: ["第一行\n第二行"],
  });
  assert.deepEqual(plan.queuedIds, ["u1"], "CRLF / LF 差异不应影响匹配");
}

// 卡片预览：附件块换成标签，压缩空白，过长截断
assert.equal(stripQueueMarkers('<file name="C:\\a\\b.txt">\n内容\n</file>'), "[文件: C:\\a\\b.txt]");
assert.equal(queuePreview('<file name="C:\\a\\b.txt">\n内容\n</file>\n看看这个'), "[文件: C:\\a\\b.txt] 看看这个");
assert.equal(queuePreview("多行\n\n  文本  "), "多行 文本");
assert.equal(queuePreview(""), "（无文字内容）");
assert.equal(queuePreview("字".repeat(200), 10), "字".repeat(10) + "…");
assert.equal(queuePreview('<session name="C:\\s.jsonl" title="t">\n摘要\n</session>'), "[对话: C:\\s.jsonl]");

// 撤回后放回输入框的文本：不能带附件 XML
assert.equal(queueDraftText('<file name="C:\\a\\b.txt">\n内容\n</file>\n看看这个'), "[文件: C:\\a\\b.txt]\n看看这个");

console.log("queue-view.check ok 去重 / 附件匹配 / 撤回文本 / 预览");
