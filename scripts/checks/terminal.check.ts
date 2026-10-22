import { TerminalHost, resolveTerminalShell, stripTerminalAnsi } from "../../electron/terminal-host.ts";
import { formatTerminalDuration, createTerminalService } from "../../packages/ui/src/services/terminal.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | undefined, timeout = 12_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await wait(80);
  }
  throw new Error("等待终端任务超时");
}

const stripped = stripTerminalAnsi("\u001B[31m红色\u001B[0m \u001B]0;标题\u0007正常");
assert(stripped === "红色 正常", `ANSI 清理失败：${JSON.stringify(stripped)}`);

const windowsShell = resolveTerminalShell("echo ok", "win32");
assert(windowsShell.label === "PowerShell", "Windows 应使用 PowerShell");
assert(windowsShell.args.includes("-NoProfile") && windowsShell.args.at(-1)?.includes("echo ok"), "PowerShell 参数不正确");
const unixShell = resolveTerminalShell("echo ok", "linux");
assert(unixShell.args.join(" ").includes("-lc echo ok"), "Unix shell 参数不正确");

assert(formatTerminalDuration(0) === "0s", "0 秒格式错误");
assert(formatTerminalDuration(59_000) === "59s", "秒格式错误");
assert(formatTerminalDuration(61_000) === "1m 1s", "分钟格式错误");
assert(formatTerminalDuration(3_600_000) === "1h", "小时格式错误");

const events: Array<{ type: string; [key: string]: any }> = [];
const host = new TerminalHost({
  emit: (event) => {
    events.push(event as any);
  },
});

try {
  let rejected = false;
  try {
    host.start(process.cwd(), "   ");
  } catch {
    rejected = true;
  }
  assert(rejected, "空命令应被拒绝");

  const command = `"${process.execPath}" -e "process.stdout.write('terminal-ok 中文'); process.stderr.write('terminal-err'); process.exit(0)"`;
  const task = host.start(process.cwd(), command);
  assert(task.status === "running" && Boolean(task.pid), "任务未启动");
  await waitFor(() => host.list().find((item) => item.id === task.id && item.status !== "running"));
  const done = host.list().find((item) => item.id === task.id);
  assert(done?.status === "exited", `任务状态错误：${done?.status}`);
  assert(done?.exitCode === 0, `退出码错误：${done?.exitCode}`);
  assert(done?.output.includes("terminal-ok 中文") && done?.output.includes("terminal-err"), `输出缺失：${JSON.stringify(done?.output)}`);
  const stdoutText = events.filter((event) => event.type === "data" && event.stream === "stdout").map((event) => event.text).join("");
  const stderrText = events.filter((event) => event.type === "data" && event.stream === "stderr").map((event) => event.text).join("");
  assert(stdoutText.includes("terminal-ok 中文"), `stdout 事件缺失：${JSON.stringify(stdoutText)}`);
  assert(stderrText.includes("terminal-err"), `stderr 事件缺失：${JSON.stringify(stderrText)}`);

  const fail = host.start(process.cwd(), `"${process.execPath}" -e "process.exit(3)"`);
  await waitFor(() => host.list().find((item) => item.id === fail.id && item.status !== "running"));
  const failed = host.list().find((item) => item.id === fail.id);
  assert(failed?.status === "failed" && failed?.exitCode === 3, `失败退出码错误：${failed?.status}/${failed?.exitCode}`);

  const limitedHost = new TerminalHost({ emit: () => {}, maxOutput: 120 });
  try {
    const limited = limitedHost.start(process.cwd(), `"${process.execPath}" -e "process.stdout.write('x'.repeat(300))"`);
    await waitFor(() => limitedHost.list().find((item) => item.id === limited.id && item.status === "exited"));
    const snapshot = limitedHost.list().find((item) => item.id === limited.id);
    assert(snapshot?.output.length === 120 && snapshot?.truncated, `输出截尾错误：${snapshot?.output.length}/${snapshot?.truncated}`);
  } finally {
    limitedHost.dispose();
  }

  const long = host.start(process.cwd(), `"${process.execPath}" -e "setTimeout(() => {}, 30000)"`);
  await wait(250);
  assert(host.stop(long.id), "停止任务失败");
  await waitFor(() => host.list().find((item) => item.id === long.id && item.status !== "running" && item.status !== "stopping"));
  const stopped = host.list().find((item) => item.id === long.id);
  assert(stopped?.status === "stopped", `停止状态错误：${stopped?.status}`);
  assert(events.some((event) => event.type === "status" && event.task?.id === long.id), "缺少 stopping 状态事件");
  assert(events.some((event) => event.type === "exit" && event.id === long.id), "缺少退出事件");
} finally {
  host.dispose();
}

console.log("terminal OK");

// 极短命令可能在 startTerminal 的响应返回前就发出 exit 事件，运行中快照不能覆盖终态。
const listeners = new Set<(event: any) => void>();
let seq = 0;
const mockHost = {
  startTerminal: async (cwd: string, command: string) => {
    const info = {
      id: `mock-${++seq}`,
      command,
      cwd,
      shell: "sh",
      startedAt: Date.now(),
      status: "running",
    };
    for (const listener of listeners) listener({ type: "start", task: info });
    for (const listener of listeners) {
      listener({ type: "exit", id: info.id, status: "exited", exitCode: 0, endedAt: Date.now() });
    }
    return info;
  },
  stopTerminal: async () => true,
  terminalTasks: async () => [],
  onTerminalEvent: (listener: (event: any) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const service = createTerminalService({ host: mockHost, getCwd: () => "C:/mock" });
try {
  service.setHeight(9_999);
  assert(service.state.height <= 640, `终端高度上限错误：${service.state.height}`);
  service.setHeight(1);
  assert(service.state.height === 160, `终端高度下限错误：${service.state.height}`);
  await service.run("echo mock");
  assert(service.state.tasks.length === 1, "服务应记录一条任务");
  assert(service.state.tasks[0]?.status === "exited", `终态被迟到快照覆盖：${service.state.tasks[0]?.status}`);
  assert(service.state.activeId === "mock-1", "新任务应成为活动任务");
  assert(service.state.open && service.state.input === "", "运行后应清空输入并展开面板");
  assert(service.state.history[0] === "echo mock", "命令历史未记录");
  service.historyUp();
  assert(service.state.input === "echo mock", "历史回溯失败");
  service.historyDown();
  assert(service.state.input === "", "历史前进失败");
} finally {
  service.dispose();
}

console.log("terminal service OK");
