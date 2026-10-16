import { PiHost } from "../../electron/pi-host.ts";

const host = new PiHost({ emit: () => {} });
const cwd = "C:\\Users\\jiuran\\Desktop\\chat";
try {
  const authorizedCwd = await host.authorizeWorkspace(cwd);
  const [a, b] = await Promise.all([host.open(authorizedCwd), host.open(authorizedCwd)]);
  console.log("processes", host.clients.size, "a.messages", a.messages.length, "b.messages", b.messages.length);
  console.log("same session", a.state.sessionFile === b.state.sessionFile, a.state.sessionFile?.split("\\").at(-1));
  if (host.clients.size !== 1 || a.messages.length === 0) throw new Error("concurrent open broken");

  // 验证同一目录下当会话 1 正在运行（streaming）时，新建会话会自动分配独立 Worker 并行执行
  const pool = host.clients.get(authorizedCwd)!;
  const firstSession = pool.activeSessionFile;
  const firstSlot = host.resolveSlot(authorizedCwd, firstSession);
  firstSlot.streaming = true;

  const created = await host.call(authorizedCwd, "newSession", []);
  const secondSnap = await host.snapshot(cwd, created?.sessionFile);
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
}
