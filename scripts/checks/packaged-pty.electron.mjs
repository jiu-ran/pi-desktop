import { app } from "electron";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 从打包后的 app.asar 加载真实宿主，避免只测试源码里的 node-pty。 */
const asar = process.argv.find(arg => arg.endsWith("app.asar"));
if (!asar) throw new Error("请传入打包后的 resources/app.asar 路径");
let host;
const timeout = setTimeout(() => { console.error("[packaged-pty] FAIL 超时"); app.exit(1); }, 20000);
const poll = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error("等待打包终端超时");
};

app.whenReady().then(async () => {
  try {
    const module = pathToFileURL(path.resolve(asar) + "/dist-electron/terminal-host.js").href;
    const { TerminalHost } = await import(module);
    host = new TerminalHost({ emit() {} });
    const task = await host.startPty(tmpdir(), 80, 24);
    if (!task.pty || task.status !== "running") throw new Error("打包版未创建运行中的 PTY");
    host.writePty(task.id, "echo PI-PACKAGED-PTY-OK\r");
    await poll(() => host.list().find(item => item.id === task.id)?.output.includes("PI-PACKAGED-PTY-OK"));
    host.writePty(task.id, "exit\r");
    await poll(() => host.list().find(item => item.id === task.id)?.status === "exited");
    await host.dispose();
    clearTimeout(timeout);
    console.log("[packaged-pty] PASS app.asar 宿主 / 原生 PTY / 输出 / 自然退出 / 进程回收");
    app.exit(0);
  } catch (error) {
    console.error("[packaged-pty] FAIL", error);
    await host?.dispose();
    app.exit(1);
  }
});
