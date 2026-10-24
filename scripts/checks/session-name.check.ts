import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { sessionTimestamp } from "../../electron/pi-host.ts";

const root = await mkdtemp(path.join(tmpdir(), "pi-session-name-"));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
const { listSessions } = await import("../../electron/pi-host.ts");
const { readSessionName } = await import("../../electron/session-name.ts");
const cwd = path.join(root, "project");
const encoded = `--${[...path.resolve(cwd)].map(ch => "\\/:".includes(ch) ? "-" : ch).join("").replace(/^-/, "")}--`;
const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encoded);
const file = path.join(dir, "session.jsonl");
const line = (value: unknown) => JSON.stringify(value);
const header = line({ type: "session", version: 3, timestamp: new Date().toISOString(), name: "旧文件头名称", cwd });
const first = line({ type: "message", message: { role: "user", content: [{ type: "text", text: "首条用户消息" }] } });
const info = (name: unknown) => line({ type: "session_info", name });
const read = async () => readSessionName(file, (await stat(file)).size, "旧文件头名称");

try {
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${header}\n${first}\n`);
  assert.equal((await listSessions(cwd))[0]?.title, "旧文件头名称", "旧格式名称应兼容");
  // 名称在 128 KB 文件头之外，缓存也必须随文件变更失效。
  await appendFile(file, line({ type: "message", message: { role: "assistant", content: "x".repeat(300000) } }) + "\n");
  await appendFile(file, info("  新名称\n换行  ") + "\n");
  assert.equal(await read(), "新名称 换行");
  assert.equal((await listSessions(cwd))[0]?.title, "新名称 换行", "桌面列表应读取追加的名称，而不是旧文件头 / 首条消息");
  await appendFile(file, info("再次重命名") + "\n");
  assert.equal((await listSessions(cwd))[0]?.title, "再次重命名", "同一会话重命名应使元数据缓存失效");
  // 名称不一定在固定长度文件尾中，后续巨型消息也不能隐藏它。
  await appendFile(file, line({ type: "message", message: { role: "assistant", content: "文".repeat(300000) } }) + "\n");
  assert.equal(await read(), "再次重命名", "跨越巨型 JSON 行仍应找到最后的名称");
  await appendFile(file, '{"type":"session_info","name":"未写完');
  assert.equal(await read(), "再次重命名", "忽略尾部不完整记录");
  await appendFile(file, "\n" + info("") + "\n");
  assert.equal(await read(), "", "最新空名称显式清除，不能复活文件头名称");
  assert.equal((await listSessions(cwd))[0]?.title, "首条用户消息", "清除名称后回退首条消息");
  await writeFile(file, `${header}\r\n${info("仅命名的空会话")}\r\n`);
  assert.equal((await listSessions(cwd))[0]?.empty, false, "有自定义名称的无消息会话不能被当作空会话隐藏");
  // 让名称记录跨越读取块的边界，覆盖中文多字节拼接以及无末尾换行。
  for (const suffix of [65510, 65536, 65560]) {
    await writeFile(file, `${header}\n${info("中文跨块名称")}\n${line({ type: "message", data: "x".repeat(suffix) })}`);
    assert.equal(await read(), "中文跨块名称", `名称跨块解析 ${suffix}`);
  }
  console.log("session-name OK");
} finally { await rm(root, { recursive: true, force: true }); }

// 侧栏时间：显示「最近活动」而不是建会话那天。一直在这个会话里聊，时间必须是刚刚。
const justNow = Date.now();
const fourDaysAgo = new Date(justNow - 4 * 24 * 60 * 60 * 1000).toISOString();
assert.equal(sessionTimestamp(fourDaysAgo, justNow), justNow, "文件刚追加过时要取 mtime");
assert.equal(sessionTimestamp(new Date(justNow - 60_000).toISOString(), justNow - 120_000), justNow - 60_000, "文件头更新时取文件头");
assert.equal(sessionTimestamp(undefined, justNow), justNow, "没有文件头时间时退回 mtime");
assert.equal(sessionTimestamp("not-a-date", justNow), justNow, "坏时间戳不能把时间算成 0");
console.log("session timestamp OK 最近活动优先");
