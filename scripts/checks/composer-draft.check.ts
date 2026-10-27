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

const text = (draft: { text: string }) => draft.text;
const paths = (draft: { attachments: Array<{ path: string }> }) => draft.attachments.map((item) => item.path);

// 1. 写入后可读回：模拟应用重启后继续使用上次输入
writeComposerDraft("C:\\Proj", "a.jsonl", { text: "未发送的草稿", attachments: [] });
assert.equal(text(readComposerDraft("C:\\Proj", "a.jsonl")), "未发送的草稿", "重启后应能恢复草稿");

// 2. 附件也要持久化：图片 / 文件 / 文件夹都只存路径与名称，恢复时再校验
writeComposerDraft("C:\\Proj", "a.jsonl", {
  text: "带附件的草稿",
  attachments: [
    { path: "C:\\Proj\\shot.png", name: "shot.png", kind: "file" },
    { path: "C:\\Proj\\src", name: "src", kind: "folder" },
  ],
});
const restored = readComposerDraft("C:\\Proj", "a.jsonl");
assert.equal(text(restored), "带附件的草稿");
assert.deepEqual(paths(restored), ["C:\\Proj\\shot.png", "C:\\Proj\\src"], "附件路径应随草稿保存");
assert.equal(restored.attachments[1].kind, "folder", "文件夹类型要保留");

// 3. 只有附件、没有正文时也要保留（用户先拖了文件还没写字）
writeComposerDraft("C:\\Proj", "attachments-only.jsonl", {
  text: "",
  attachments: [{ path: "C:\\Proj\\a.txt", name: "a.txt", kind: "file" }],
});
assert.deepEqual(paths(readComposerDraft("C:\\Proj", "attachments-only.jsonl")), ["C:\\Proj\\a.txt"]);

// 4. 会话隔离：同一项目不同会话互不影响
writeComposerDraft("C:\\Proj", "b.jsonl", { text: "另一个会话", attachments: [] });
assert.equal(text(readComposerDraft("C:\\Proj", "a.jsonl")), "带附件的草稿");
assert.equal(text(readComposerDraft("C:\\Proj", "b.jsonl")), "另一个会话");

// 5. 项目隔离
writeComposerDraft("C:\\Other", "a.jsonl", { text: "别的项目", attachments: [] });
assert.equal(text(readComposerDraft("C:\\Proj", "a.jsonl")), "带附件的草稿", "不同项目不能串草稿");

// 6. 空内容（正文与附件都没有）即删除，不留下空键
writeComposerDraft("C:\\Proj", "a.jsonl", { text: "", attachments: [] });
assert.equal(text(readComposerDraft("C:\\Proj", "a.jsonl")), "");
assert.ok(!store.has(composerDraftKey("C:\\Proj", "a.jsonl")), "发送后应删除草稿键");

// 7. 显式清理（删除会话）
writeComposerDraft("C:\\Proj", "c.jsonl", { text: "将被删除", attachments: [] });
clearComposerDraft("C:\\Proj", "c.jsonl");
assert.equal(text(readComposerDraft("C:\\Proj", "c.jsonl")), "");

// 8. 没有 cwd 时不写入，避免出现无主键
writeComposerDraft("", "x.jsonl", { text: "无项目", attachments: [] });
assert.equal([...store.keys()].filter(key => key.includes("x.jsonl")).length, 0, "缺少项目路径时不应落盘");

// 9. 旧格式（纯文本）仍能读出来，升级后不丢草稿
store.set(composerDraftKey("C:\\Proj", "legacy.jsonl"), "旧格式草稿");
assert.equal(text(readComposerDraft("C:\\Proj", "legacy.jsonl")), "旧格式草稿", "旧格式草稿要兼容");
assert.deepEqual(paths(readComposerDraft("C:\\Proj", "legacy.jsonl")), []);

// 10. 坏数据不能把界面带崩
store.set(composerDraftKey("C:\\Proj", "broken.jsonl"), "{not json");
assert.equal(text(readComposerDraft("C:\\Proj", "broken.jsonl")), "", "坏数据应安全降级");

// 11. 超过上限时裁剪旧草稿，避免 localStorage 无限增长
for (let i = 0; i < 60; i += 1) {
  writeComposerDraft("C:\\Proj", `s${i}.jsonl`, { text: `草稿 ${i}`, attachments: [] });
}
const draftKeys = [...store.keys()].filter(key => key.startsWith("pi-desktop.composer-draft:"));
assert.ok(draftKeys.length <= 40, `草稿条数应受上限约束，实际 ${draftKeys.length}`);
assert.ok(text(readComposerDraft("C:\\Proj", "s59.jsonl")), "最近写入的草稿必须保留");

// 12. 裁剪要看「最近写入」而不是 localStorage 的插入顺序
// 改写已有键不会改变插入顺序：只看顺序的话，刚编辑过的老草稿会被当成最旧的丢掉。
store.clear();
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
for (let i = 0; i < 40; i += 1) {
  writeComposerDraft("C:\\Proj", `k${i}.jsonl`, { text: `草稿 ${i}`, attachments: [] });
  await tick();
}
assert.equal([...store.keys()].length, 40, "先摆满 40 条");
// 改最老的那个：写完它仍是最先插入的，但内容是刚写下的
writeComposerDraft("C:\\Proj", "k0.jsonl", { text: "刚改过的旧草稿", attachments: [] });
await tick();
assert.ok(store.has(composerDraftKey("C:\\Proj", "k0.jsonl")), "改写不能被当成删除");
// 再写一条新的触发裁剪：该淘汰的是时间最早的 k1，而不是刚写过的 k0
writeComposerDraft("C:\\Proj", "k40.jsonl", { text: "新草稿", attachments: [] });
assert.equal(
  text(readComposerDraft("C:\\Proj", "k0.jsonl")),
  "刚改过的旧草稿",
  "刚写过的草稿（哪怕是旧键）不能被当成最旧的删掉",
);
assert.equal(store.has(composerDraftKey("C:\\Proj", "k1.jsonl")), false, "真正最旧的那条应该被淘汰");
assert.ok(store.has(composerDraftKey("C:\\Proj", "k40.jsonl")), "最新的草稿要保留");
const kept = [...store.keys()].length;
assert.equal(kept, 40, `裁剪后仍应正好是上限条数，实际 ${kept}`);

console.log("composer-draft OK 正文 / 附件 / 隔离 / 空清理 / 旧格式 / 上限");
