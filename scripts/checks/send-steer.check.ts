import assert from "node:assert/strict";

/**
 * 引导（steering）消息必须立即出现在对话里。
 *
 * 背景：send() 以前只在「非流式」时做乐观渲染，流式中发送的引导 / 追加消息
 * 要等重开会话从文件读回才显示。这里用假 host 复现：不发任何模型请求。
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
};

const { createWorkbench } = await import("../../packages/ui/src/kernel/workbench.ts");

const cwd = "/tmp/pi-send-steer";
const sessionFile = `${cwd}/session.jsonl`;
const calls: Array<{ method: string; args: any[]; sessionFile?: string }> = [];

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
  call: async (cwdArg: string, method: string, args: any[] = [], file?: string) => {
    calls.push({ method, args, sessionFile: file });
    return method === "prompt" ? "queued" : null;
  },
};

const bus = { on: () => () => {}, emit: () => {}, onAny: () => () => {} } as any;
const workbench = createWorkbench({ host, bus });
const ws = await workbench.open(cwd);
assert.equal(ws.status, "ready", "假 host 应让工作区就绪");

// 模拟正在流式输出时发送引导消息（必须是当前会话线程）
ws.activeThread.streaming = true;
const thread = ws.activeThread;
const before = thread.blocks.length;

const sent = await workbench.send("引导：顺便看一下样式", { mode: "steer" });
assert.equal(sent, true, "引导消息应被接受");

const promptCall = calls.find((call) => call.method === "prompt");
assert.ok(promptCall, "应以 prompt 方式投递");
assert.equal(promptCall!.args[2], "steer", "应把 steer 行为传给 Pi");
assert.equal(promptCall!.sessionFile, sessionFile, "应绑定当前会话");

const userBlocks = thread.blocks.filter((block) => block.kind === "user");
assert.equal(userBlocks.length, 1, `流式期间发送后应立即出现 1 条用户消息，实际 ${userBlocks.length} 条`);
assert.equal(userBlocks[0].text, "引导：顺便看一下样式", "用户消息内容应与输入一致");
assert.ok(thread.blocks.length > before, "对话块数量应增加");

// 失败时撤回乐观消息，避免界面留下一条并未送达的消息
const failing = createWorkbench({
  host: { ...host, call: async () => { throw new Error("worker 未就绪"); } },
  bus,
});
const failWs = await failing.open(cwd);
failWs.activeThread.streaming = true;
const failThread = failWs.activeThread;
const failed = await failing.send("这条会失败", { mode: "steer" });
assert.equal(failed, false, "投递失败应返回 false");
assert.equal(failThread.blocks.filter((block) => block.kind === "user").length, 0, "投递失败应撤回乐观消息");

console.log("send-steer OK");
