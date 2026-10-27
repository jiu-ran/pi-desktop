import assert from "node:assert/strict";

/**
 * 「更新了 Pi 之后，现有会话还在跑旧版本」的回归。
 *
 * 工作区里的 `pi` 进程是打开项目时拉起的。升级 Pi（或换了手动指定的 pi 路径）后
 * 只刷新版本号、不重启进程的话，提示里写着「已更新到 x」，实际会话行为一点没变。
 * 这里用假宿主验证：
 * 1. 升级成功后只重启**空闲**的工作区，正在输出的不打断；
 * 2. 有被跳过的就在提示里说清楚「结束后生效」；
 * 3. 升级失败时不许重启任何东西（避免把正常会话打断）。
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
const { setupSettings } = await import("../../packages/ui/src/services/settings.ts");

const idleCwd = "/tmp/pi-update-idle";
const busyCwd = "/tmp/pi-update-busy";

const snapshot = (cwd: string, streaming: boolean) => ({
  state: {
    sessionFile: `${cwd}/session.jsonl`,
    sessionName: "",
    model: "test/model",
    thinkingLevel: "off",
    isStreaming: streaming,
    isCompacting: false,
  },
  models: [],
  sessions: [{ id: `${cwd}/session.jsonl`, path: `${cwd}/session.jsonl`, title: "会话", empty: false, timestamp: 1 }],
  commands: [],
  branch: "main",
  levels: [],
  messages: [],
});

const restarted: string[] = [];
let updateResult: { ok: boolean; from: string; to: string; log: string } = { ok: true, from: "0.9.0", to: "0.9.1", log: "更新完成" };

const host = {
  onEvent: () => () => {},
  locate: async () => ({ found: true, version: "0.9.1", path: "/usr/local/bin/pi" }),
  recent: async () => [],
  open: async (cwd: string) => snapshot(cwd, cwd === busyCwd),
  snapshot: async (cwd: string) => snapshot(cwd, cwd === busyCwd),
  messagePage: async () => ({ messages: [], total: 0, start: 0 }),
  sessions: async () => [],
  authorizeWorkspace: async (cwd: string) => cwd,
  prepareAttachments: async () => ({ text: "", images: [], items: [] }),
  restart: async (cwd: string) => {
    restarted.push(cwd);
    return snapshot(cwd, false);
  },
  updatePi: async () => updateResult,
  checkPiUpdate: async () => ({ current: "0.9.0", latest: "0.9.1", updateAvailable: true }),
  call: async () => null,
};

const notices: Array<{ level: string; text: string }> = [];
const bus = {
  on: (_name: string, handler: (payload: any) => void) => {
    // setupSettings 会订阅 workspace:opened / pi:located 等，这里不触发即可
    void handler;
    return () => {};
  },
  onAny: () => () => {},
  emit: (name: string, payload: any) => {
    if (name === "notify") notices.push(payload);
  },
} as any;

const workbench = createWorkbench({ host: host as any, bus });
setupSettings(workbench as any, bus);

// 一个空闲工作区 + 一个正在输出的工作区
await workbench.open(idleCwd);
await workbench.open(busyCwd);
const idle = workbench.workspaces.get(idleCwd)!;
const busy = workbench.workspaces.get(busyCwd)!;
assert.equal(idle.status, "ready");
assert.equal(busy.status, "ready");
// 正在输出：stub 直接打标记（真实场景由流式事件置位）
busy.activeThread.streaming = true;

notices.length = 0;
restarted.length = 0;
const updated = await workbench.updatePi();
assert.equal(updated, true, "更新应成功");
assert.deepEqual(restarted, [idleCwd], `只重启空闲工作区，实际 ${JSON.stringify(restarted)}`);
assert.equal(
  notices.some((notice) => notice.text.includes("更新到 0.9.1")),
  true,
  `提示里要有新版本号，实际 ${JSON.stringify(notices.map((n) => n.text))}`,
);
assert.equal(
  notices.some((notice) => /正在输出|结束后/.test(notice.text)),
  true,
  `有被跳过的工作区时提示要说清楚，实际 ${JSON.stringify(notices.map((n) => n.text))}`,
);
assert.equal(workbench.state.pi.updateAvailable, false, "更新后不该再显示「有更新」");

// 更新失败：不能重启，也不能谎报版本
notices.length = 0;
restarted.length = 0;
updateResult = { ok: false, from: "0.9.1", to: "0.9.1", log: "npm ERR! 网络不通" };
const failed = await workbench.updatePi();
assert.equal(failed, false, "更新失败要返回 false");
assert.deepEqual(restarted, [], "失败时不能重启工作区");
assert.equal(
  notices.filter((notice) => notice.level === "error").length,
  1,
  "失败要给一条错误提示",
);

console.log("pi-update-restart OK 只重启空闲工作区 / 跳过时说明生效时机 / 失败不重启");
