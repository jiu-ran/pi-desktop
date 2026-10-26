import assert from "node:assert/strict";
import {
  planQueueView,
  planQueueMode,
  planQueueWithdraw,
  planQueuedFlush,
  queueImagesByPrompt,
  queueDraftText,
  queuePreview,
  stripQueueMarkers,
} from "../../packages/ui/src/shared/queue-view.ts";

const block = (id: string, text: string, queueText?: string) => ({ id, kind: "user", text, queueText });

// 语义（0.2.8 起）：还排在队列里的消息统一列在输入框上方，对话里的乐观气泡暂时隐藏。
// 1) 队列里有内容 → 上方列出来，且对应气泡被隐藏
{
  const plan = planQueueView([block("u1", "顺便查一下日志", "顺便查一下日志")], {
    steering: [],
    followUp: ["顺便查一下日志"],
  });
  assert.deepEqual(plan.entries, [{ mode: "followUp", text: "顺便查一下日志" }], "排队中的消息要列到输入框上方");
  assert.deepEqual(plan.hiddenIds, ["u1"], "对话里那条乐观气泡应暂时隐藏");
}

// 2) 带附件时，Pi 队列里存的是完整提示词（含 <file> 块），要按 queueText 对上才能隐藏气泡
{
  const prompt = '<file name="C:\\a\\log.txt">\n内容\n</file>\n看看这个';
  const plan = planQueueView([block("u1", "看看这个", prompt)], { steering: [], followUp: [prompt] });
  assert.deepEqual(plan.entries, [{ mode: "followUp", text: prompt }], "带附件的也要列出来");
  assert.deepEqual(plan.hiddenIds, ["u1"], "带附件的排队消息也要能对上气泡");
}

// 3) 对不上气泡的（别的客户端排进来的、或消息还没渲染）同样列出来，但没有可隐藏的气泡
{
  const plan = planQueueView([block("u1", "我的消息", "我的消息")], {
    steering: [],
    followUp: ["我的消息", "别人排进来的"],
  });
  assert.deepEqual(
    plan.entries,
    [
      { mode: "followUp", text: "我的消息" },
      { mode: "followUp", text: "别人排进来的" },
    ],
    "队列里的条目按顺序全部列出",
  );
  assert.deepEqual(plan.hiddenIds, ["u1"], "只有真正对上的那条隐藏气泡");
}

// 4) 同一条消息排队两次：一个气泡只能对一条，另一条仍然要在上方列出
{
  const plan = planQueueView([block("u1", "重复", "重复")], { steering: [], followUp: ["重复", "重复"] });
  assert.equal(plan.hiddenIds.length, 1, "一个气泡只能对一条队列项");
  assert.equal(plan.entries.length, 2, "两条都排在队列里，都要列出来");
}

// 5) 插话（steer）与追加（followUp）都参与，顺序按队列顺序
{
  const plan = planQueueView([], { steering: ["插话一句"], followUp: ["再补一句"] });
  assert.deepEqual(plan.entries, [
    { mode: "steer", text: "插话一句" },
    { mode: "followUp", text: "再补一句" },
  ]);
  assert.deepEqual(plan.hiddenIds, [], "没有气泡可隐藏");
}

// 6) 空队列：上方不显示、对话也不隐藏任何东西
assert.deepEqual(planQueueView([block("u1", "x", "x")], { steering: [], followUp: [] }), {
  entries: [],
  hiddenIds: [],
});
assert.deepEqual(planQueueView([], null), { entries: [], hiddenIds: [] });

// 7) 换行差异不应影响「隐藏哪个气泡」的匹配
{
  const plan = planQueueView([block("u1", "第一行", "第一行\r\n第二行")], {
    steering: [],
    followUp: ["第一行\n第二行"],
  });
  assert.deepEqual(plan.hiddenIds, ["u1"], "CRLF / LF 差异不应影响匹配");
}

// 卡片预览：附件块换成标签，压缩空白，过长截断
assert.equal(stripQueueMarkers('<file name="C:\\a\\b.txt">\n内容\n</file>'), "[文件: C:\\a\\b.txt]");
assert.equal(queuePreview('<file name="C:\\a\\b.txt">\n内容\n</file>\n看看这个'), "[文件: C:\\a\\b.txt] 看看这个");
assert.equal(queuePreview("多行\n\n  文本  "), "多行 文本");
assert.equal(queuePreview(""), "（无文字内容）");
assert.equal(queuePreview("字".repeat(200), 10), "字".repeat(10) + "…");
assert.equal(queuePreview('<session name="C:\\s.jsonl" title="t">\n摘要\n</session>'), "[对话: C:\\s.jsonl]");

// 编辑框 / 撤回文本：只留用户写的话；不能带附件 XML，也不能带展示用的 [文件: …] 标签
// （带上标签再保存就会在提示词里多出一份图片路径 —— 气泡上看到两条重复路径）
assert.equal(queueDraftText('<file name="C:\\a\\b.txt">\n内容\n</file>\n看看这个'), "看看这个");
assert.equal(queueDraftText('<file name="C:\\a\\b.png"></file>\n看下图'), "看下图");
assert.equal(queueDraftText('<file name="C:\\a\\b.png"></file>'), "", "纯附件消息没有用户文字");
assert.equal(queueDraftText("普通的一句话"), "普通的一句话");

console.log("queue-view.check ok 去重 / 附件匹配 / 撤回文本 / 预览");

// 编辑排队消息：只替换提示词末尾的用户文字，前面的上下文（附件 / 引用）原样保留
{
  const { replacePromptMessage, planQueueEdit } = await import("../../packages/ui/src/shared/queue-view.ts");
  const prompt = '<file name="C:\a\b.txt">\n内容\n</file>\n原来的话';
  assert.equal(
    replacePromptMessage(prompt, "改过的话"),
    '<file name="C:\a\b.txt">\n内容\n</file>\n改过的话',
    "编辑只替换末尾的用户文字",
  );
  assert.equal(replacePromptMessage("原来的话", "改过的话"), "改过的话");
  assert.equal(
    replacePromptMessage('<file name="a.txt">\n内容\n</file>', "只有附件"),
    '<file name="a.txt">\n内容\n</file>\n只有附件',
    "纯附件消息补充文字",
  );
  assert.equal(replacePromptMessage("别的上下文", "新文字"), "新文字", "没有附件时就是整段替换");

  // 图片附件编辑：保存后提示词里只能有一份图片路径
  {
    const { rebuildPrompt, splitPromptBlocks } = await import("../../packages/ui/src/shared/queue-prompt.ts");
    const imageBlock = '<file name="C:\\Temp\\pi-desktop-paste\\image-1.png"></file>';
    const imagePrompt = imageBlock + "\n看这张图";
    assert.deepEqual(
      splitPromptBlocks(imagePrompt).blocks.map((block) => block.name),
      ["image-1.png"],
      "图片附件要能被识别成一个块",
    );
    assert.equal(splitPromptBlocks(imagePrompt).message, "看这张图", "块之外才是用户文字");

    // 用编辑框的预填文字重建提示词：标记恰好一份，用户文字恰好一份
    const rebuilt = rebuildPrompt(imagePrompt, queueDraftText(imagePrompt), undefined, "");
    assert.equal(rebuilt, imagePrompt, "原样重建不能多出一份路径");
    assert.equal(rebuilt.match(/<file name=/g)?.length, 1, "只能有一个附件标记");
    assert.equal((rebuilt.match(/image-1\.png/g) ?? []).length, 1, "图片路径只能出现一次");

    // 把展示用的 [文件: …] 标签当消息写回去，就会出现两份 —— 正是修掉的那个 bug
    const buggy = rebuildPrompt(imagePrompt, stripQueueMarkers(imagePrompt), undefined, "");
    assert.equal((buggy.match(/image-1\.png/g) ?? []).length, 2, "把展示标签写回提示词就会出现重复路径");

    // 新粘贴的附件追加在后面，原有块保留
    const withPasted = rebuildPrompt(imagePrompt, "看这两张图", undefined, '<file name="C:\\Temp\\p2.png"></file>');
    assert.equal(withPasted.match(/<file name=/g)?.length, 2, "新粘贴的附件要追加");
    assert.ok(withPasted.endsWith("看这两张图"), "用户文字在最后");

    // 移除某个附件：按 keepPaths 过滤块
    const dropped = rebuildPrompt(imagePrompt, "都不要了", [], "");
    assert.equal(dropped, "都不要了", "全部移除后只剩文字");
  }

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

// 带附件/引用时编辑排队消息：上下文必须原样保留（以前末尾对不上会把上下文整段丢掉）
{
  const { replacePromptMessage, splitPromptMessage } = await import("../../packages/ui/src/shared/queue-view.ts");
  const prompt = '<file name="a.txt">\n内容\n</file>\n<session name="s.jsonl" title="T">\n摘要\n</session>\n原来的话';
  const split = splitPromptMessage(prompt);
  assert.equal(split.message, "原来的话", "应切出末尾的用户文字");
  assert.ok(split.prefix.endsWith("</session>"), "前缀应包含全部上下文");
  assert.equal(
    replacePromptMessage(prompt, "改过的话"),
    '<file name="a.txt">\n内容\n</file>\n<session name="s.jsonl" title="T">\n摘要\n</session>\n改过的话',
  );
  // 末尾文字对不上（比如消息里剥离了技能卡）也不能丢上下文
  assert.equal(
    replacePromptMessage(prompt, "新文字"),
    '<file name="a.txt">\n内容\n</file>\n<session name="s.jsonl" title="T">\n摘要\n</session>\n新文字',
  );
  // 纯上下文（没有用户文字）时追加
  assert.equal(
    replacePromptMessage('<file name="a.txt">\n内容\n</file>', "补一句"),
    '<file name="a.txt">\n内容\n</file>\n补一句',
  );
  console.log("queue edit keeps context OK 拆分 / 替换 / 兜底");
}

// 主进程与渲染进程拼出的会话块必须一模一样：不一致会让历史里的引用卡片退化成纯文本
{
  const { buildSessionBlock } = await import("../../packages/ui/src/shared/session-block.ts");
  const { sessionContextBlock } = await import("../../electron/session-context.ts");
  const messages = [
    { role: "user", content: [{ type: "text", text: "第一句" }] },
    { role: "assistant", content: [{ type: "text", text: "第二句" }] },
  ];
  const fromMain = sessionContextBlock({ file: "C:\a\b.jsonl", title: "标题 & 特殊字符 <x>", messages });
  const body = fromMain.slice(fromMain.indexOf(">") + 1, fromMain.lastIndexOf("</session>")).trim();
  const fromRenderer = buildSessionBlock({ file: "C:\a\b.jsonl", title: "标题 & 特殊字符 <x>", body, messages: messages.length });
  assert.equal(fromRenderer.trimEnd(), fromMain.trimEnd(), "两侧拼出的会话块必须一致");
  console.log("session block parity OK 主进程 / 渲染进程一致");
}

// ---------- 单条撤回 ----------
{
  const queue = { steering: ["插话一", "插话二"], followUp: ["排队一", "排队二"] };
  const afterSteer = planQueueWithdraw(queue, { mode: "steer", text: "插话一" });
  assert.deepEqual(afterSteer.steering, ["插话二"], "撤回插话只去掉那一条");
  assert.deepEqual(afterSteer.followUp, ["排队一", "排队二"], "撤回插话不能动排队列表");
  const afterFollow = planQueueWithdraw(queue, { mode: "followUp", text: "排队二" });
  assert.deepEqual(afterFollow.followUp, ["排队一"], "撤回排队只去掉那一条");
  assert.deepEqual(afterFollow.steering, ["插话一", "插话二"]);
  // 同样的文字排了两次：只删一条
  const twice = planQueueWithdraw({ steering: [], followUp: ["再说一次", "再说一次"] }, { mode: "followUp", text: "再说一次" });
  assert.deepEqual(twice.followUp, ["再说一次"], "重复文字只撤回一条");
  // 找不到时保持原样（不能让别的消息消失）
  const missing = planQueueWithdraw(queue, { mode: "followUp", text: "不存在" });
  assert.deepEqual(missing.followUp, ["排队一", "排队二"]);
  // CRLF 也要对得上
  const crlf = planQueueWithdraw({ steering: [], followUp: ["第一行\r\n第二行"] }, { mode: "followUp", text: "第一行\n第二行" });
  assert.deepEqual(crlf.followUp, [], "CRLF 与 LF 视为同一条");
  console.log("queue withdraw OK 单条撤回 / 只删一条 / 找不到不动");
}

// ---------- 换投递方式：排队 ↔ 引导 ----------
{
  const queue = { steering: ["插话一"], followUp: ["排队一", "排队二"] };

  // 排队 → 引导：从排队列去掉，追加到引导列末尾
  const toSteer = planQueueMode(queue, { mode: "followUp", text: "排队二" }, "steer");
  assert.equal(toSteer.changed, true);
  assert.deepEqual(toSteer.queue.steering, ["插话一", "排队二"], "改引导要追加到引导列末尾");
  assert.deepEqual(toSteer.queue.followUp, ["排队一"], "排队列要少一条");

  // 引导 → 排队：同理
  const toFollow = planQueueMode(queue, { mode: "steer", text: "插话一" }, "followUp");
  assert.equal(toFollow.changed, true);
  assert.deepEqual(toFollow.queue.steering, [], "引导列要少一条");
  assert.deepEqual(toFollow.queue.followUp, ["排队一", "排队二", "插话一"], "改排队要追加到排队列末尾");

  // 同类型原样返回（调用方据此跳过重新入队）
  const same = planQueueMode(queue, { mode: "followUp", text: "排队一" }, "followUp");
  assert.equal(same.changed, false, "类型没变就不用动队列");
  assert.deepEqual(same.queue, queue, "类型没变时队列内容不变");

  // 队列里已经没有这条（刚被取走）：不动，交给调用方同步状态
  const gone = planQueueMode(queue, { mode: "steer", text: "不存在" }, "followUp");
  assert.equal(gone.changed, false);
  assert.deepEqual(gone.queue.followUp, ["排队一", "排队二"]);

  // 不改原对象
  assert.deepEqual(queue, { steering: ["插话一"], followUp: ["排队一", "排队二"] }, "纯函数不能改入参");

  // 给了书写顺序：改成排队要插在「比自己晚写」的那条前面，不能一律排到末尾
  {
    const written = { steering: ["插话一"], followUp: ["排队一", "排队二"] };
    // 用户书写顺序：插话一(0) → 排队一(1) → 排队二(2)
    const rank = new Map([["插话一", 0], ["排队一", 1], ["排队二", 2]]);
    const reordered = planQueueMode(written, { mode: "steer", text: "插话一" }, "followUp", rank);
    assert.deepEqual(
      reordered.queue.followUp,
      ["插话一", "排队一", "排队二"],
      `改成排队要按书写顺序插回去，实际 ${JSON.stringify(reordered.queue.followUp)}`,
    );
    // 反过来：排队二改成引导，它比排队一晚写，应当排在排队一后面
    const queueToSteer = planQueueMode(
      { steering: [], followUp: ["排队一", "排队二"] },
      { mode: "followUp", text: "排队二" },
      "steer",
      new Map([["排队一", 1], ["排队二", 2]]),
    );
    assert.deepEqual(queueToSteer.queue.steering, ["排队二"], "改成引导时引导列只有它");
    // 没有顺序信息的老队列：追加到末尾（行为可预期）
    const noRank = planQueueMode(written, { mode: "steer", text: "插话一" }, "followUp");
    assert.deepEqual(noRank.queue.followUp, ["排队一", "排队二", "插话一"], "没有顺序信息时追加到末尾");
    console.log("queue mode order OK 按书写顺序插回 / 无顺序时追加");
  }

  // 连续改回来：先排队→引导，再引导→排队，回到原顺序（各自列内顺序稳定）
  const round = planQueueMode(planQueueMode(queue, { mode: "followUp", text: "排队一" }, "steer").queue, { mode: "steer", text: "排队一" }, "followUp");
  assert.deepEqual(round.queue.followUp, ["排队二", "排队一"], "来回切换不会丢消息，也不会重复");
  assert.equal(round.queue.steering.length + round.queue.followUp.length, 3, "总条数不变");
  console.log("queue mode OK 排队↔引导 / 列内顺序稳定 / 不改入参");
}

// ---------- 发出后把乐观气泡挪到末尾 ----------
{
  // 典型现场：入队时气泡插在中间，上一轮输出还在它下面继续追加
  const blocks = [
    block("u0", "上一轮的问题", "上一轮的问题"),
    block("u1", "排队的那条", "排队的那条"),
    { id: "a1", kind: "text", text: "上一轮还在输出……" },
    { id: "a2", kind: "text", text: "上一轮结束" },
  ];
  const queued = { steering: [], followUp: ["排队的那条"] };
  const drained = { steering: [], followUp: [] };
  assert.deepEqual(planQueuedFlush(blocks, queued, queued), [], "队列没变化：不动");
  assert.deepEqual(planQueuedFlush(blocks, null, drained), [], "没有上一轮队列：不知道谁刚发出，别乱动");
  assert.deepEqual(
    planQueuedFlush(blocks, queued, drained),
    ["u1"],
    "刚被取走的那条：气泡要挪到末尾，否则会插在上一轮输出中间",
  );
  // 历史消息也带 queueText，但它不在「刚发出」的集合里，不能跟着重排
  assert.deepEqual(
    planQueuedFlush(blocks, { steering: [], followUp: ["排队的那条", "另一条"] }, drained),
    ["u1"],
    "只挪真正刚发出去的那条",
  );
  // 已经在末尾就不动
  const tail = [
    { id: "a1", kind: "text", text: "输出" },
    { id: "a2", kind: "text", text: "结束" },
    block("u9", "刚发出去的", "刚发出去的"),
  ];
  assert.deepEqual(planQueuedFlush(tail, { steering: [], followUp: ["刚发出去的"] }, drained), [], "已在末尾不重复移动");
  // 插话与排队都要处理
  const mix = [
    block("u1", "插话那条", "插话那条"),
    { id: "a1", kind: "text", text: "输出" },
  ];
  assert.deepEqual(planQueuedFlush(mix, { steering: ["插话那条"], followUp: [] }, drained), ["u1"], "插话被取走同样要挪");
  console.log("queue flush OK 只挪刚发出的那条");
}

// ---------- 重新入队时图片要「按条」带回去（不丢、不重复） ----------
{
  const png = (id: string) => ({ mimeType: "image/png", data: id });
  const blocks = [
    block("u1", "带图的排队消息", "带图的排队消息").valueOf() as any,
    block("u2", "纯文字排队消息", "纯文字排队消息").valueOf() as any,
    { id: "a1", kind: "text", text: "输出" },
  ] as any[];
  blocks[0].imageItems = [png("AAA")];
  const map = queueImagesByPrompt(blocks);
  assert.ok(map["带图的排队消息"], "带图的条目应收集到图片");
  assert.equal(map["带图的排队消息"].length, 1, "一张图只能收一次");
  assert.equal(map["带图的排队消息"][0].data, "AAA");
  assert.equal(map["纯文字排队消息"], undefined, "没图的条目不应凭空多出图片");

  // 同一段文字排两次也只会共用一组图（不能因为重复扫描而叠加）
  const twice = queueImagesByPrompt([
    { kind: "user", queueText: "同一句", imageItems: [png("BBB")] },
    { kind: "user", queueText: "同一句", imageItems: [png("BBB")] },
  ] as any[]);
  assert.equal(twice["同一句"].length, 1, "重复气泡不能把图片叠成两张");

  // 历史消息（没有 queueText）不参与，避免把老消息的图塞进队列
  const history = queueImagesByPrompt([{ kind: "user", imageItems: [png("CCC")] }] as any[]);
  assert.deepEqual(Object.keys(history), [], "没有 queueText 的历史消息不参与");
  console.log("queue images OK 按条带回 / 不重复 / 历史忽略");
}
