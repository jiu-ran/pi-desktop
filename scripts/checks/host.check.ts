import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// CI 与本机均使用隔离工作区 / Agent 数据，不依赖开发者目录，也不污染真实会话。
const root = await mkdtemp(path.join(tmpdir(), "pi-desktop-host-"));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
const cwd = path.join(root, "project");
await mkdir(cwd);
const { PiHost } = await import("../../electron/pi-host.ts");
const host = new PiHost({ emit: () => {} });
try {
  const authorizedCwd = await host.authorizeWorkspace(cwd);
  const [a, b] = await Promise.all([host.open(authorizedCwd), host.open(authorizedCwd)]);
  console.log("processes", host.clients.size, "a.messages", a.messages.length, "b.messages", b.messages.length);
  console.log("same session", a.state.sessionFile === b.state.sessionFile, a.state.sessionFile?.split("\\").at(-1));
  if (host.clients.size !== 1) throw new Error("concurrent open broken");

  // 验证同一目录下当会话 1 正在运行（streaming）时，新建会话会自动分配独立 Worker 并行执行
  const pool = host.clients.get(authorizedCwd)!;
  const firstSession = pool.activeSessionFile;
  const firstSlot = host.resolveSlot(authorizedCwd, firstSession);
  firstSlot.streaming = true;

  const created = await host.call(authorizedCwd, "newSession", []);
  const secondSnap = await host.snapshot(authorizedCwd, created?.sessionFile);
  const secondSession = secondSnap.state.sessionFile;
  if (!secondSession || secondSession === firstSession) throw new Error("parallel newSession should create distinct session");
  if (pool.workers.size < 2) throw new Error("parallel newSession while streaming should spawn second worker");

  // 切回仍在运行中的第一个会话不应中断其状态
  await host.call(authorizedCwd, "switchSession", [firstSession]);
  if (pool.activeSessionFile !== firstSession || !firstSlot.streaming) {
    throw new Error("switching back to running session should preserve streaming slot");
  }
  firstSlot.streaming = false;
  console.log("parallel workers", pool.workers.size, "OK");
} finally {
  await host.stopAll();
  await rm(root, { recursive: true, force: true });
}
