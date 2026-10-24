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

// 编辑排队消息：只替换提示词末尾的用户文字，前面的上下文（附件 / 引用）原样保留
{
  const { replacePromptMessage, planQueueEdit } = await import("../../packages/ui/src/shared/queue-view.ts");
  const prompt = '<file name="C:\a\b.txt">\n内容\n</file>\n原来的话';
  assert.equal(
    replacePromptMessage(prompt, "原来的话", "改过的话"),
    '<file name="C:\a\b.txt">\n内容\n</file>\n改过的话',
    "编辑只替换末尾的用户文字",
  );
  assert.equal(replacePromptMessage("原来的话", "原来的话", "改过的话"), "改过的话");
  assert.equal(
    replacePromptMessage('<file name="a.txt">\n内容\n</file>', "", "只有附件"),
    '<file name="a.txt">\n内容\n</file>\n只有附件',
    "纯附件消息补充文字",
  );
  assert.equal(replacePromptMessage("别的上下文", "找不到的老文字", "新文字"), "新文字", "对不上时退回新文字");

  // 队列重排：目标换文字，其余保持原样与原顺序
  const queue = { steering: ["插话一", "插话二"], followUp: ["追加一"] };
  assert.deepEqual(
    planQueueEdit(queue, { mode: "steer", text: "插话二" }, "插话二（改）"),
    { steering: ["插话一", "插话二（改）"], followUp: ["追加一"] },
    "编辑插话只改那一条",
  );
  assert.deepEqual(
    planQueueEdit(queue, { mode: "followUp", text: "追加一" }, "追加一（改）"),
    { steering: ["插话一", "插话二"], followUp: ["追加一（改）"] },
    "编辑追加不影响插话",
  );
  assert.deepEqual(queue.steering, ["插话一", "插话二"], "不能改到原对象");
  console.log("queue edit OK 替换末尾 / 重排 / 不可变");
}

// 会话引用块：自定义正文也要能被历史解析回卡片
{
  const { buildSessionBlock, buildCustomSessionBlocks } = await import("../../packages/ui/src/shared/session-block.ts");
  const { splitAttachmentMarkers } = await import("../../packages/ui/src/shared/attachments.ts");
  const block = buildSessionBlock({
    file: "C:\s\a.jsonl",
    title: '登录 <改造> "任务"',
    body: "用户改过的正文",
    messages: 12,
  });
  assert.ok(block.startsWith('<session name="C:\s\a.jsonl" title="登录 &lt;改造&gt; &quot;任务&quot;" messages="12">'), block.slice(0, 100));
  assert.ok(block.includes("用户改过的正文"));
  const parsed = splitAttachmentMarkers(block + "\n接着干");
  assert.equal(parsed.attachments.length, 1, "自定义引用也要能解析成卡片");
  assert.equal(parsed.attachments[0]!.kind, "session");
  assert.equal(parsed.attachments[0]!.name, '登录 <改造> "任务"');
  assert.equal(parsed.attachments[0]!.messages, 12);
  assert.equal(parsed.text, "接着干", "正文里不该残留引用块");

  // 只拼「改过正文」的引用；没改的交给主进程生成
  const joined = buildCustomSessionBlocks([
    { path: "/a.jsonl", name: "A", customText: "自定义 A", messages: 3 },
    { path: "/b.jsonl", name: "B" },
    { path: "/c.jsonl", name: "C", customText: "   " },
  ]);
  assert.equal((joined.match(/<session name=/g) ?? []).length, 1, "没改过正文的引用不应重复拼");
  assert.ok(joined.includes("自定义 A"));
  assert.ok(!joined.includes("/b.jsonl"));
  console.log("session block OK XML 转义 / 卡片还原 / 只拼自定义");
}

// 编辑框里拿到的是「正文」，外层 <session> 由发送时重新拼（否则会套两层）
{
  const { extractSessionBody, buildSessionBlock } = await import("../../packages/ui/src/shared/session-block.ts");
  const block = buildSessionBlock({ file: "/a.jsonl", title: "A", body: "用户：问题\n助手：回答", messages: 2 });
  assert.equal(extractSessionBody(block), "用户：问题\n助手：回答", "应只取出正文");
  // 改完再拼回去，正好一层
  const rebuilt = buildSessionBlock({ file: "/a.jsonl", title: "A", body: "用户：改过的问题", messages: 2 });
  assert.equal((rebuilt.match(/<session /g) ?? []).length, 1, "重新拼装不能套娃");
  assert.equal(extractSessionBody("没有包裹的纯文本"), "没有包裹的纯文本", "没有包裹时原样返回");
  console.log("session body OK 去包裹 / 再拼回 / 兜底");
}
