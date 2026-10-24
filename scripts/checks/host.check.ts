import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

  // 子代理会话放在 <agentDir>/sessions 下的嵌套目录里，且可能属于别的项目目录：
  // 读取历史要放行整个会话根目录，删除 / 切换会话仍然只认本项目。
  const agentSessions = path.join(root, "agent", "sessions");
  const otherProject = path.join(agentSessions, "--other-project--", "run-0");
  await mkdir(otherProject, { recursive: true });
  const childSession = path.join(otherProject, "session.jsonl");
  await writeFile(childSession, [
    JSON.stringify({ type: "session", version: 1, timestamp: new Date().toISOString(), cwd: "/other" }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "子代理任务" }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "做完了" }] } }),
  ].join("\n") + "\n");
  const childPage = await host.messagePage(authorizedCwd, childSession, 0, 10);
  if (childPage.messages.length !== 2) throw new Error("子代理会话应可读取");
  const childText = JSON.stringify(childPage.messages);
  if (!childText.includes("子代理任务") || !childText.includes("做完了")) throw new Error("子代理会话内容不完整");
  console.log("child session messages", childPage.messages.length, "OK");

  let rejected = "";
  try {
    await host.messagePage(authorizedCwd, path.join(root, "outside", "x.jsonl"), 0, 10);
  } catch (error) {
    rejected = String(error);
  }
  if (!rejected) throw new Error("会话目录之外的文件必须拒绝读取");
  console.log("outside session rejected OK");

  // 启动卡死必须能失败、能重试：以前 open() 会一直等着卡住的 worker，
  // 界面永远停在「启动中」。这里把 spawnWorker 换成永不 resolve 的函数，
  // 用很小的上限验证超时 + 重试。
  const stuckCwd = path.join(root, "project-stuck");
  await mkdir(stuckCwd);
  const stuckAuthorized = await host.authorizeWorkspace(stuckCwd);
  const realSpawn = (host as any).spawnWorker.bind(host);
  let stuckRejected = "";
  (host as any).spawnWorker = () => new Promise(() => {});
  try {
    await host.open(stuckAuthorized, 400);
  } catch (error) {
    stuckRejected = String(error);
  } finally {
    (host as any).spawnWorker = realSpawn;
  }
  if (!/启动 Pi 超时/.test(stuckRejected)) throw new Error(`启动卡死应超时报错，实际：${stuckRejected}`);
  console.log("stuck start timed out OK");

  // 超时之后状态必须清干净：同一个工作区能重新启动成功。
  const retried = await host.open(stuckAuthorized, 60_000);
  if (!retried?.state?.sessionFile) throw new Error("超时后重试应能正常启动");
  console.log("retry after timeout OK");
} finally {
  await host.stopAll();
  await rm(root, { recursive: true, force: true });
}
