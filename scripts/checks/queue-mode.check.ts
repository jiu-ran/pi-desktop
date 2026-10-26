import assert from "node:assert/strict";

/**
 * 排队消息的「换投递方式」与「撤回回填」（内核侧）。
 *
 * Pi 的队列只能整体 clearQueue，所以两种操作都是「清空 → 按新分组重新入队」。
 * 这里用假宿主验证三件容易出错的事：
 * 1. 换成引导要进 steering 列、换成排队要进 followUp 列，且不丢消息；
 * 2. 重新入队时每个提示词要带上自己的图片（clearQueue 只回文本）；
 * 3. 撤回要把人写的文字交回输入框（附件标记不能进去），失败则队列还原。
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};

const { createWorkbench } = await import("../../packages/ui/src/kernel/workbench.ts");

const cwd = "/tmp/pi-queue-mode";
const sessionFile = `${cwd}/session.jsonl`;
const imagePath = "C:\\Temp\\pi-desktop-paste\\image-1.png";
const steerPrompt = `<file name="${imagePath}"></file>\n插一句`;
const followOne = "排队一";
const followTwo = "排队二";

let queueState: { steering: string[]; followUp: string[] } = {
  steering: [steerPrompt],
  followUp: [followOne, followTwo],
};
let failNext = false;
const calls: Array<{ method: string; args: any[] }> = [];

const snapshot = () => ({
  state: {
    sessionFile,
    sessionName: "",
    model: "test/model",
    thinkingLevel: "off",
    isStreaming: true,
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
  prepareAttachments: async () => ({ text: "", images: [], items: [] }),
  call: async (_cwd: string, method: string, args: any[] = []) => {
    calls.push({ method, args });
    if (method === "clearQueue") return { steering: [...queueState.steering], followUp: [...queueState.followUp] };
    if (failNext && (method === "steer" || method === "followUp")) throw new Error("队列写入失败");
    return null;
  },
};

const notices: Array<{ level: string; text: string }> = [];
const bus = { on: () => () => {}, onAny: () => () => {}, emit: (name: string, payload: any) => { if (name === "notify") notices.push(payload); } } as any;
const workbench = createWorkbench({ host: host as any, bus });
const ws = await workbench.open(cwd);
const thread = ws.activeThread;
thread.transcript.pushUser("插一句", 1, {
  queueText: steerPrompt,
  imageItems: [{ mimeType: "image/png", data: "BASE64:image-1.png" }],
});
thread.transcript.pushUser(followOne, 1, { queueText: followOne });
thread.transcript.pushUser(followTwo, 1, { queueText: followTwo });
thread.queue = { steering: [...queueState.steering], followUp: [...queueState.followUp] };

const reset = () => {
  calls.length = 0;
  notices.length = 0;
  failNext = false;
};

// ---- 1) 排队 → 引导 ----
reset();
const moved = await workbench.changeQueuedMode({ mode: "followUp", text: followTwo }, "steer");
assert.equal(moved, true, "排队改引导应成功");
assert.equal(thread.queue.steering.at(-1), followTwo, "改引导后要落到 steering 列末尾");
assert.deepEqual(thread.queue.followUp, [followOne], "原来的排队列少一条，其余保持顺序");
const steerCalls = calls.filter((call) => call.method === "steer");
const followCalls = calls.filter((call) => call.method === "followUp");
assert.deepEqual(
  steerCalls.map((call) => call.args[0]),
  [steerPrompt, followTwo],
  `引导列要按原顺序重新入队，实际 ${JSON.stringify(steerCalls.map((call) => call.args[0]))}`,
);
assert.deepEqual(followCalls.map((call) => call.args[0]), [followOne], "排队列只留剩下那条");
// 图片按提示词各自带回去：插话那条有图，别的没有
assert.equal(steerCalls[0]!.args[1]?.[0]?.data, "BASE64:image-1.png", "重新入队时图片要带上");
assert.equal(Boolean(steerCalls[1]!.args[1]), false, "没有图片的那条不能塞别人的图");

// ---- 2) 引导 → 排队 ----
reset();
queueState = { steering: [steerPrompt, followTwo], followUp: [followOne] };
const backToQueue = await workbench.changeQueuedMode({ mode: "steer", text: steerPrompt }, "followUp");
assert.equal(backToQueue, true, "引导改排队应成功");
// 插话是用户最先写的（块在最前），改成排队后要排在「排队一」前面，而不是一律追加到末尾
assert.deepEqual(thread.queue.followUp, [steerPrompt, followOne], "改排队要按书写顺序插回，不能排到后写的话后面");
assert.deepEqual(thread.queue.steering, [followTwo], "引导列里其余那条顺序不变");
assert.ok(
  calls.some((call) => call.method === "followUp" && call.args[0] === steerPrompt),
  "引导那条要按 followUp 重新入队（等这一轮结束再发）",
);

// ---- 3) 类型没变 / 队列里已经没有：不重新入队 ----
reset();
const same = await workbench.changeQueuedMode({ mode: "followUp", text: followOne }, "followUp");
assert.equal(same, false, "类型没变时不做事");
assert.equal(calls.filter((call) => call.method !== "clearQueue").length, 0, "类型没变就不能重新入队");

// ---- 4) 撤回：文字回填输入框，附件标记不进去 ----
reset();
queueState = { steering: [steerPrompt], followUp: [followOne] };
thread.queue = { steering: [steerPrompt], followUp: [followOne] };
const withdrawn = await workbench.withdrawQueued({ mode: "steer", text: steerPrompt });
assert.equal(withdrawn.ok, true, "撤回应成功");
assert.equal(withdrawn.draft, "插一句", `回填的只有人写的文字，实际「${withdrawn.draft}」`);
assert.equal(withdrawn.draft.includes("[文件"), false, "回填文本里不能有展示用的附件标签");
assert.equal(thread.queue.steering.length, 0, "撤回后队列里没有它了");
assert.equal(
  thread.blocks.some((block: any) => String(block.queueText ?? "") === steerPrompt),
  false,
  "撤回后乐观气泡也要删掉",
);

// ---- 5) 重新入队失败：队列还原并提示，内容不丢 ----
reset();
failNext = true;
queueState = { steering: [], followUp: [followOne, followTwo] };
thread.queue = { steering: [], followUp: [followOne, followTwo] };
const failed = await workbench.changeQueuedMode({ mode: "followUp", text: followOne }, "steer");
assert.equal(failed, false, "写入失败要返回 false");
assert.deepEqual(thread.queue.followUp, [followOne, followTwo], "失败时队列要还原，不能丢消息");
assert.ok(notices.some((notice) => notice.level === "error"), "失败要给出错误提示");

// ---- 6) 拖拽排序：按新顺序重新入队，跨组时投递方式也跟着变 ----
// 前面的撤回已经把带图的那条气泡删了，这里补回来，验证排序时图片仍然跟着走
thread.transcript.pushUser("插一句", 1, {
  queueText: steerPrompt,
  imageItems: [{ mimeType: "image/png", data: "BASE64:image-1.png" }],
});
reset();
queueState = { steering: [steerPrompt], followUp: [followOne, followTwo] };
thread.queue = { steering: [steerPrompt], followUp: [followOne, followTwo] };
const reordered = await workbench.reorderQueued([
  { mode: "followUp", text: followTwo },
  { mode: "followUp", text: followOne },
  { mode: "steer", text: steerPrompt },
]);
assert.equal(reordered, true, "调整顺序应成功");
assert.deepEqual(thread.queue.followUp, [followTwo, followOne], "排队列按新顺序重新入队");
assert.deepEqual(thread.queue.steering, [steerPrompt], "引导列不受影响");
assert.deepEqual(
  calls.filter((call) => call.method === "followUp").map((call) => call.args[0]),
  [followTwo, followOne],
  "入队顺序要和界面顺序一致（否则拖了等于没拖）",
);
assert.equal(
  calls.find((call) => call.method === "steer")?.args[1]?.[0]?.data,
  "BASE64:image-1.png",
  "重新入队时每条仍要带自己的图片",
);

// 跨组拖拽：排队那条变成引导，按顺序进 steering
reset();
queueState = { steering: [], followUp: [followOne, followTwo] };
thread.queue = { steering: [], followUp: [followOne, followTwo] };
await workbench.reorderQueued([
  { mode: "steer", text: followTwo },
  { mode: "followUp", text: followOne },
]);
assert.deepEqual(thread.queue.steering, [followTwo], "换成引导的条目进 steering 列");
assert.deepEqual(thread.queue.followUp, [followOne], "剩下的排队列保持顺序");
assert.equal(
  calls.some((call) => call.method === "steer" && call.args[0] === followTwo),
  true,
  "跨组时要按 steer 重新入队（立刻插入当前回合）",
);

// 顺序没变：不要动 Pi 的队列
reset();
queueState = { steering: [steerPrompt], followUp: [followOne] };
thread.queue = { steering: [steerPrompt], followUp: [followOne] };
const noop = await workbench.reorderQueued([
  { mode: "steer", text: steerPrompt },
  { mode: "followUp", text: followOne },
]);
assert.equal(noop, false, "顺序没变时不做事");
assert.equal(calls.length, 0, "顺序没变就一个 RPC 都不该发（不惊动 Pi 的队列）");

// 界面里已经没有的那条（刚被取走）：不能又被塞回去
reset();
queueState = { steering: [], followUp: [followOne] };
thread.queue = { steering: [], followUp: [followOne] };
await workbench.reorderQueued([
  { mode: "followUp", text: followTwo },
  { mode: "followUp", text: followOne },
]);
assert.deepEqual(thread.queue.followUp, [followOne], "已取走的条目不能重新入队");
assert.equal(
  calls.some((call) => call.method === "followUp" && call.args[0] === followTwo),
  false,
  "也不能发给 Pi：它已经不在队列里了",
);

// 写入失败：队列还原 + 提示
reset();
failNext = true;
queueState = { steering: [], followUp: [followOne, followTwo] };
thread.queue = { steering: [], followUp: [followOne, followTwo] };
const reorderFailed = await workbench.reorderQueued([
  { mode: "followUp", text: followTwo },
  { mode: "followUp", text: followOne },
]);
assert.equal(reorderFailed, false, "写入失败要返回 false");
assert.deepEqual(thread.queue.followUp, [followOne, followTwo], "失败时队列顺序还原，不能丢消息");
assert.ok(notices.some((notice) => notice.level === "error"), "失败要给出错误提示");

console.log("queue-mode OK 排队↔引导 / 拖拽排序 / 重新入队顺序与图片 / 撤回回填 / 失败还原");
