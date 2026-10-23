import type { IPty } from "node-pty";
import type { Worker } from "node:worker_threads";

/**
 * node-pty 1.1.0 的 Windows ConPTY 兼容清理。
 *
 * 稳定 IPty 接口没有 dispose；该版本自然退出只关闭输出 socket，仍保留
 * conout Worker 和输入 pipe。kill() 又会 fork console-list agent；在 Electron
 * 中 fork 使用 electron.exe，而且 shell 已被 taskkill 后 AttachConsole 会失败。
 *
 * 宿主已负责结束进程树，这里只关闭已知的 ConPTY 资源。依赖固定为 1.1.0，
 * 使用前检查结构；升级 node-pty 时必须复跑 PTY 自检和 Electron 冒烟。
 */
interface WindowsPtyAgent {
  _useConpty: boolean;
  _useConptyDll: boolean;
  _pty: number;
  _ptyNative: { kill: (id: number, useDll: boolean) => void };
  _conoutSocketWorker: { dispose: () => void; _worker: Worker };
  _inSocket: { destroy: () => void };
  _outSocket: { destroy: () => void };
}

const closed = new WeakSet<IPty>();

export function closeWindowsPty(pty: IPty): boolean {
  if (process.platform !== "win32") return false;
  if (closed.has(pty)) return true;
  const agent = (pty as IPty & { _agent?: WindowsPtyAgent })._agent;
  if (!agent?._useConpty || typeof agent._ptyNative?.kill !== "function"
    || typeof agent._conoutSocketWorker?.dispose !== "function"
    || typeof agent._conoutSocketWorker?._worker?.once !== "function"
    || typeof agent._inSocket?.destroy !== "function"
    || typeof agent._outSocket?.destroy !== "function") return false;
  closed.add(pty);
  const worker = agent._conoutSocketWorker._worker;
  // shell 退出后继续排空输出时可能撞到 EPIPE；退出中的 worker 错误不能
  // 变成 Electron 的 uncaughtException。活跃终端的错误仍由宿主上报。
  worker.once("error", () => {});
  const closeOutput = () => {
    try { agent._outSocket.destroy(); } catch { /* 输出管道已关闭 */ }
  };
  worker.once("exit", closeOutput);
  // ConPTY close 会等待输出被另一个线程排空，必须先保留 draining worker。
  try { agent._ptyNative.kill(agent._pty, agent._useConptyDll); } catch { /* 已关闭 */ }
  try { agent._conoutSocketWorker.dispose(); } catch { /* Worker 已退出 */ }
  try { agent._inSocket.destroy(); } catch { /* 输入管道已关闭 */ }
  if (worker.threadId === -1) closeOutput();
  return true;
}
