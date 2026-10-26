import assert from "node:assert/strict";

/**
 * 编辑排队消息（内核侧）：改文字不能把附件标记改多，也不能把图片弄丢。
 *
 * 真实 bug：编辑框预填的是展示文本（附件块被换成 `[文件: C:\…\png]`），保存时整段
 * 当成新提示词写回，于是队列里变成
 *   <file name="…png"></file>
 *   [文件: C:\…png]
 *   用户的话
 * 气泡上就看到两条一模一样的图片路径。这里直接调内核，验证重建后的提示词只有一个标记。
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

const cwd = "/tmp/pi-queue-edit";
const sessionFile = `${cwd}/session.jsonl`;
const imagePath = "C:\\Temp\\pi-desktop-paste\\image-1.png";
const pastedPath = "C:\\Temp\\pi-desktop-paste\\pasted-2.png";
const prompt = `<file name="${imagePath}"></file>\n顺便看下日志`;
// 假宿主里的「当前队列」：editQueued 会先 clearQueue 再按它重新入队
let queueState: { steering: string[]; followUp: string[] } = { steering: [], followUp: [prompt] };
const calls: Array<{ method: string; args: any[]; sessionFile?: string }> = [];
const preparedPaths: string[] = [];

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
  prepareAttachments: async (_cwd: string, paths: string[]) => {
    preparedPaths.push(...paths);
    return {
      text: paths.map((item) => `<file name="${item}"></file>`).join("\n"),
      images: [],
      items: paths.map((item) => ({
        path: item,
        name: item.split(/[\\/]/).pop(),
        kind: "file",
        image: true,
        mimeType: "image/png",
        data: `BASE64:${item.split(/[\\/]/).pop()}`,
      })),
    };
  },
  call: async (_cwd: string, method: string, args: any[] = [], file?: string) => {
    calls.push({ method, args, sessionFile: file });
    if (method === "clearQueue") return { steering: [...queueState.steering], followUp: [...queueState.followUp] };
    return null;
  },
};

const bus = { on: () => () => {}, emit: () => {}, onAny: () => () => {} } as any;
const workbench = createWorkbench({ host: host as any, bus });
const ws = await workbench.open(cwd);
const thread = ws.activeThread;
thread.transcript.pushUser("顺便看下日志", 1, {
  queueText: prompt,
  imageItems: [{ mimeType: "image/png", data: "BASE64:image-1.png" }],
});
thread.queue = { ...queueState };

// 1) 只改文字：提示词里的附件标记必须还是恰好一个
preparedPaths.length = 0;
calls.length = 0;
const ok = await workbench.editQueued({ mode: "followUp", text: prompt }, { message: "顺便看下日志，改成这句" });
assert.equal(ok, true, "编辑应成功");
assert.equal(preparedPaths.length, 0, "没粘贴新附件时不该再 prepare 一遍");
const requeued = calls.filter((call) => call.method === "followUp");
assert.equal(requeued.length, 1, "应重新入队一条");
assert.equal(
  requeued[0]!.args[0],
  `<file name="${imagePath}"></file>\n顺便看下日志，改成这句`,
  `重建后的提示词应只保留一份附件标记，实际「${requeued[0]!.args[0]}」`,
);
assert.equal((requeued[0]!.args[0].match(/image-1\.png/g) ?? []).length, 1, "图片路径只能出现一次");
assert.equal(
  String(requeued[0]!.args[0]).includes("[文件"),
  false,
  "提示词里不能混进展示用的 [文件: …] 标签",
);
assert.deepEqual(
  requeued[0]!.args[1],
  [{ mimeType: "image/png", data: "BASE64:image-1.png" }],
  "原有图片要跟着新提示词一起入队（否则图片丢）",
);
const block = thread.blocks.find((item) => item.kind === "user")!;
assert.equal(block.queueText, requeued[0]!.args[0], "气泡上的 queueText 要跟着更新");
assert.equal(block.text, "顺便看下日志，改成这句", "气泡显示的文字也要更新");
assert.equal(block.imageItems?.length, 1, "图片数量不变");
queueState = { steering: [], followUp: [block.queueText!] };

// 2) 粘贴新图片：追加一个新标记，原有图片不会被重复添加
preparedPaths.length = 0;
calls.length = 0;
const nowPrompt = block.queueText!;
const added = await workbench.editQueued(
  { mode: "followUp", text: nowPrompt },
  { message: "再看这张", addPaths: [pastedPath] },
);
assert.equal(added, true, "带新附件的编辑应成功");
assert.deepEqual(preparedPaths, [pastedPath], "只 prepare 新粘贴的那个附件");
const second = calls.filter((call) => call.method === "followUp");
assert.equal(second.length, 1);
assert.equal(second[0]!.args[0].match(/<file name=/g)?.length, 2, `应有两个附件标记：${second[0]!.args[0]}`);
assert.equal((second[0]!.args[0].match(/image-1\.png/g) ?? []).length, 1, "原有图片不能重复");
assert.ok(second[0]!.args[0].endsWith("再看这张"), "用户文字在最后");
queueState = { steering: [], followUp: [second[0]!.args[0]] };
assert.deepEqual(
  (second[0]!.args[1] ?? []).map((item: any) => item.data),
  ["BASE64:image-1.png", `BASE64:${pastedPath.split(/[\\/]/).pop()}`],
  "新旧图片都要带给模型",
);
assert.equal(
  thread.blocks.find((item) => item.kind === "user")!.imageItems?.length,
  2,
  "气泡上的图片数量要跟着增加",
);

// 3) 「引导」也走同一条路径（用户不确定的那种情况）
calls.length = 0;
queueState = { steering: [`<file name="${imagePath}"></file>\n插一句`], followUp: [] };
thread.queue = { ...queueState };
thread.transcript.pushUser("插一句", 1, {
  queueText: `<file name="${imagePath}"></file>\n插一句`,
  imageItems: [{ mimeType: "image/png", data: "BASE64:image-1.png" }],
});
const steerOk = await workbench.editQueued(
  { mode: "steer", text: `<file name="${imagePath}"></file>\n插一句` },
  { message: "插一句（改）" },
);
assert.equal(steerOk, true, "引导消息同样能编辑");
const steerCall = calls.find((call) => call.method === "steer");
assert.ok(steerCall, "应通过 steer 重新入队");
assert.equal((String(steerCall!.args[0]).match(/image-1\.png/g) ?? []).length, 1, "引导消息的图片路径也只出现一次");

// 4) 空文字 + 没有新附件：拒绝，不要把上下文改成空
const rejected = await workbench.editQueued({ mode: "followUp", text: nowPrompt }, { message: "   " });
assert.equal(rejected, false, "空内容不应把消息清空");

console.log("queue-edit OK 编辑不重复附件 / 新附件追加 / 引导同样适用 / 图片跟着走");
