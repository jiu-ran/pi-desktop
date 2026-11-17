import assert from "node:assert/strict";
import { installFakeLocalStorage } from "./support/harness.ts";

/**
 * 排队消息的「编辑期间先拿走」与「撤回带回附件」。
 *
 * 真实问题：
 * 1. 引导（steer）消息排在 Pi 的队列里时随时会被投递进当前回合 —— 用户还在编辑框里
 *    改它，它可能已经发了出去，保存则因为队列里找不到这条而静默失败。
 *    现在打开编辑框先 holdQueuedEdit（其余消息原样重新入队），保存 / 取消再放回原位。
 * 2. 撤回 / 全部撤回只回得来文字，图片就丢了 —— 现在连同附件路径一起返回。
 * 3. 编辑框里删不掉「输入框带过来的」图片 —— 现在按 keepPaths 过滤图片块与图片数据。
 */
installFakeLocalStorage();

const { createWorkbench } = await import("../../packages/ui/src/kernel/workbench.ts");

const cwd = "/tmp/pi-queue-hold";
const sessionFile = `${cwd}/session.jsonl`;
const firstImage = "C:\\Temp\\pi-paste\\a.png";
const secondImage = "C:\\Temp\\pi-paste\\b.png";
const docPath = `${cwd}/note.txt`;
const firstPrompt = `<file name="${firstImage}"></file>\n<file name="${secondImage}"></file>\n<file name="${docPath}"></file>\n看这两张图`;
const otherPrompt = "顺便跑个测试";

let queueState: { steering: string[]; followUp: string[] } = {
  steering: [],
  followUp: [firstPrompt, otherPrompt],
};
const calls: Array<{ method: string; args: any[] }> = [];

const snapshot = () => ({
  state: {
    sessionFile,
    sessionName: "",
    model: "test/model",
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
  },
  models: [],
  sessions: [{ id: sessionFile, path: sessionFile, title: "测试会话", empty: false, timestamp: Date.now() }],
  commands: [],
  branch: "main",
  levels: [],
  messages: [],
});

const host = {
  onEvent: () => () => {},
  locate: async () => ({ found: true, version: "test", path: "/pi" }),
  recent: async () => [],
  open: async () => snapshot(),
  snapshot: async () => snapshot(),
  messagePage: async () => ({ messages: [], total: 0, start: 0 }),
  sessions: async () => snapshot().sessions,
  authorizeWorkspace: async () => cwd,
  prepareAttachments: async (_cwd: string, paths: string[]) => ({
    text: paths.map((item) => `<file name="${item}"></file>`).join("\n"),
    images: [],
    items: paths.map((item) => ({
      path: item,
      name: item.split(/[\\/]/).pop(),
      kind: "file",
      image: /\.(png|jpe?g)$/i.test(item),
      mimeType: "image/png",
      data: `BASE64:${item.split(/[\\/]/).pop()}`,
    })),
  }),
  call: async (_cwd: string, method: string, args: any[] = []) => {
    calls.push({ method, args });
    if (method === "clearQueue") return { steering: [...queueState.steering], followUp: [...queueState.followUp] };
    if (method === "steer" || method === "followUp") return null;
    return null;
  },
};

const bus = { on: () => () => {}, emit: () => {}, onAny: () => () => {} } as any;
const workbench = createWorkbench({ host: host as any, bus });
const ws = await workbench.open(cwd);
const thread = ws.activeThread;

const images = [
  { mimeType: "image/png", data: "BASE64:a.png" },
  { mimeType: "image/png", data: "BASE64:b.png" },
];
const block = thread.transcript.pushUser("看这两张图", 2, { queueText: firstPrompt, imageItems: images });
thread.transcript.pushUser("顺便跑个测试", 0, { queueText: otherPrompt });
thread.queue = { ...queueState };

// 1) 打开编辑：目标从队列里拿走，其余原样重新入队；气泡标记成 held（不显示、不挪位）
calls.length = 0;
const held = await workbench.holdQueuedEdit({ mode: "followUp", text: firstPrompt });
assert.equal(held.ok, true, "打开编辑应成功");
assert.equal(held.index, 0, "原位置应为第 0 条");
const heldBlock = thread.blocks.find((item) => item.id === block.id)!;
assert.equal(heldBlock.held, true, "编辑中的气泡要标记成 held");
assert.deepEqual(thread.queue.followUp, [otherPrompt], "只剩其余那条排队消息");
const requeuedAfterHold = calls.filter((call) => call.method === "followUp").map((call) => call.args[0]);
assert.deepEqual(requeuedAfterHold, [otherPrompt], "其余消息按原顺序重新入队，编辑中的那条不能重新入队");

// 2) 保存：按原位置插回，带新文字与原图片
queueState = { steering: [], followUp: [otherPrompt] };
calls.length = 0;
const saved = await workbench.editQueued(
  { mode: "followUp", text: firstPrompt },
  { message: "看这两张图（改）", index: held.index },
);
assert.equal(saved, true, "保存应成功");
const afterSave = thread.queue.followUp;
assert.equal(afterSave.length, 2, `保存后队列应回到两条，实际 ${JSON.stringify(afterSave)}`);
assert.ok(String(afterSave[0]).endsWith("看这两张图（改）"), "编辑后的那条回到原来的位置（第 0 条）");
assert.equal(afterSave[1], otherPrompt, "其余那条仍在后面");
const savedCall = calls.filter((call) => call.method === "followUp" && String(call.args[0]).endsWith("看这两张图（改）"))[0]!;
assert.ok(savedCall, "编辑后的那条要重新入队");
assert.deepEqual(
  (savedCall.args[1] ?? []).map((item: any) => item.data),
  ["BASE64:a.png", "BASE64:b.png"],
  "编辑时没删图片：两张图都要带回去",
);
assert.equal(heldBlock.held, false, "保存后 held 标记要清掉");

// 3) 删掉第一张图片：图片块与图片数据一起删
queueState = { steering: [], followUp: [savedCall.args[0]] };
thread.queue = { ...queueState };
heldBlock.queueText = savedCall.args[0];
calls.length = 0;
const removed = await workbench.editQueued(
  { mode: "followUp", text: heldBlock.queueText! },
  { message: "看这张图", keepPaths: [secondImage, docPath] },
);
assert.equal(removed, true, "删附件后仍能保存");
const removedCall = calls.filter((call) => call.method === "followUp" && String(call.args[0]).endsWith("看这张图"))[0]!;
assert.ok(removedCall, "删附件后那条要重新入队");
const removedPrompt = String(removedCall.args[0]);
assert.equal((removedPrompt.match(/<file name=/g) ?? []).length, 2, `应剩两个附件块：${removedPrompt}`);
assert.equal(removedPrompt.includes("a.png"), false, "删掉的图片不能还留在提示词里");
assert.deepEqual(
  (removedCall.args[1] ?? []).map((item: any) => item.data),
  ["BASE64:b.png"],
  "删掉的图片也不能再带给模型",
);

// 4) 取消编辑：原样放回原位置
queueState = { steering: [], followUp: [otherPrompt] };
thread.queue = { ...queueState };
// 取消发生在保存之前：气泡仍是原来那条提示词
block.queueText = firstPrompt;
block.text = "看这两张图";
block.held = true;
calls.length = 0;
const cancelled = await workbench.cancelQueuedEdit({ mode: "followUp", text: firstPrompt }, 0);
assert.equal(cancelled, true, "取消应成功");
assert.deepEqual(thread.queue.followUp, [firstPrompt, otherPrompt], "取消后按原位置放回");
assert.equal(block.held, false, "取消后 held 标记要清掉");
const cancelCalls = calls.filter((call) => call.method === "followUp").map((call) => call.args[0]);
assert.deepEqual(cancelCalls, [firstPrompt, otherPrompt], "取消时按原顺序重新入队");

// 5) 单条撤回：文字 + 附件一起返回
queueState = { steering: [], followUp: [firstPrompt, otherPrompt] };
thread.queue = { ...queueState };
const withdrawn = await workbench.withdrawQueued({ mode: "followUp", text: firstPrompt });
assert.equal(withdrawn.ok, true, "撤回应成功");
assert.equal(withdrawn.draft, "看这两张图", "只回用户写的文字");
assert.deepEqual(
  withdrawn.attachments.map((item) => item.path),
  [firstImage, secondImage, docPath],
  "撤回要把附件路径一起带回来（图片才不会丢）",
);

// 6) 全部撤回：包含正在编辑的那条，附件去重
queueState = { steering: [], followUp: [otherPrompt] };
thread.queue = { ...queueState };
thread.transcript.pushUser("看这两张图", 2, { queueText: firstPrompt, imageItems: images });
const editingBlock = thread.blocks.find((item) => item.kind === "user" && item.queueText === firstPrompt)!;
editingBlock.held = true;
const recalled = await workbench.recallQueued();
assert.equal(recalled.draft, "顺便跑个测试\n看这两张图", "编辑中的那条也要跟着撤回");
assert.deepEqual(
  recalled.attachments.map((item) => item.path),
  [firstImage, secondImage, docPath],
  "全部撤回同样带回附件（重复路径只留一份）",
);
assert.equal(
  thread.blocks.some((item) => item.held),
  false,
  "撤回后不能留下还标记着 held 的气泡",
);
