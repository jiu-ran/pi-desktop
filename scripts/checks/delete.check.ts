import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-check-"));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
const cwd = path.join(root, "project");
await mkdir(cwd);

const { PiHost, listSessions } = await import("../../electron/pi-host.ts");
const encoded = `--${[...path.resolve(cwd)].map((ch) => ("\\/:".includes(ch) ? "-" : ch)).join("").replace(/^-/, "")}--`;
const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encoded);
await mkdir(dir, { recursive: true });

async function fake(name: string, text: string, minutesAgo: number): Promise<string> {
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const lines = [
    { type: "session", version: 3, id: name, timestamp: ts, cwd },
    { type: "message", id: `${name}-1`, parentId: null, timestamp: ts, message: { role: "user", content: [{ type: "text", text }], timestamp: Date.parse(ts) } },
  ];
  const file = path.join(dir, `${name}.jsonl`);
  await writeFile(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return file;
}

const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };

try {
  const a = await fake("a", "任务 A", 3);
  await fake("b", "任务 B", 2);
  await fake("c", "任务 C", 1);
  const trashed: string[] = [];
  const host = new PiHost({ emit() {}, trash: async (file: string) => { trashed.push(file); await rm(file); } });

  assert((await listSessions(cwd)).length === 3, "应有 3 个会话");

  const outside = path.join(root, "outside.jsonl");
  await writeFile(outside, "{}\n");
  for (const bad of [outside, path.join(dir, "..", "x.jsonl"), path.join(dir, "a.txt"), path.join(cwd, "a.jsonl")]) {
    let rejected = false;
    try { await host.deleteSession(cwd, bad); } catch { rejected = true; }
    assert(rejected, `应拒绝删除：${bad}`);
  }
  assert(trashed.length === 0, "被拒绝的路径不应触发删除");

  const left = await host.deleteSession(cwd, a);
  assert(left.length === 2 && !left.some((s) => s.path === a), "删除单个后应剩 2 个");

  const result = await host.deleteAllSessions(cwd);
  assert(result.deleted === 2 && result.failed === 0, "应删除剩余 2 个");
  assert((await readdir(dir)).length === 0, "会话目录应为空");
  assert((await readdir(cwd)).length === 0, "项目目录不应被改动");
  console.log("deleted", trashed.length, "guarded 4");
  console.log("OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
