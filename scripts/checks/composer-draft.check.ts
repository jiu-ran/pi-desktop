import assert from "node:assert/strict";

// 用最小 localStorage 替身验证草稿持久化（界面侧只依赖 getItem/setItem/removeItem/key/length）。
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return store.size; },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => store.clear(),
};

const { clearComposerDraft, composerDraftKey, readComposerDraft, writeComposerDraft } = await import(
  "../../packages/ui/src/shared/composer-draft.ts"
);

// 1. 写入后可读回：模拟应用重启后继续使用上次输入
writeComposerDraft("C:\\Proj", "a.jsonl", "未发送的草稿");
assert.equal(readComposerDraft("C:\\Proj", "a.jsonl"), "未发送的草稿", "重启后应能恢复草稿");

// 2. 会话隔离：同一项目不同会话互不影响
writeComposerDraft("C:\\Proj", "b.jsonl", "另一个会话");
assert.equal(readComposerDraft("C:\\Proj", "a.jsonl"), "未发送的草稿");
assert.equal(readComposerDraft("C:\\Proj", "b.jsonl"), "另一个会话");

// 3. 项目隔离
writeComposerDraft("C:\\Other", "a.jsonl", "别的项目");
assert.equal(readComposerDraft("C:\\Proj", "a.jsonl"), "未发送的草稿", "不同项目不能串草稿");

// 4. 空内容即删除，不留下空键
writeComposerDraft("C:\\Proj", "a.jsonl", "");
assert.equal(readComposerDraft("C:\\Proj", "a.jsonl"), "");
assert.ok(!store.has(composerDraftKey("C:\\Proj", "a.jsonl")), "发送后应删除草稿键");

// 5. 显式清理（删除会话）
writeComposerDraft("C:\\Proj", "c.jsonl", "将被删除");
clearComposerDraft("C:\\Proj", "c.jsonl");
assert.equal(readComposerDraft("C:\\Proj", "c.jsonl"), "");

// 6. 没有 cwd 时不写入，避免出现无主键
writeComposerDraft("", "x.jsonl", "无项目");
assert.equal([...store.keys()].filter(key => key.includes("x.jsonl")).length, 0, "缺少项目路径时不应落盘");

// 7. 超过上限时裁剪旧草稿，避免 localStorage 无限增长
for (let i = 0; i < 60; i += 1) writeComposerDraft("C:\\Proj", `s${i}.jsonl`, `草稿 ${i}`);
const draftKeys = [...store.keys()].filter(key => key.startsWith("pi-desktop.composer-draft:"));
assert.ok(draftKeys.length <= 40, `草稿条数应受上限约束，实际 ${draftKeys.length}`);
assert.ok(readComposerDraft("C:\\Proj", "s59.jsonl"), "最近写入的草稿必须保留");

console.log("composer-draft OK");
