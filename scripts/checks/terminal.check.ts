import { fileURLToPath } from "node:url";
import { listTerminalProfiles, resolveTerminalProfile, systemShellCandidate } from "../../electron/terminal-profiles.ts";
import { TerminalHost, resolveInteractiveShell, resolvePtyShell, resolveTerminalShell, stripTerminalAnsi } from "../../electron/terminal-host.ts";
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

const interactiveWin = resolveInteractiveShell("win32");
assert(interactiveWin.label === "PowerShell", "Windows 交互式 shell 应使用 PowerShell");
assert(interactiveWin.args.join(" ").includes("chcp 65001"), "Windows 交互式 shell 应先切换到 UTF-8");
assert(interactiveWin.args.at(-1)?.endsWith("-Command -"), "Windows 交互式 shell 应从 stdin 读取命令");
const interactiveUnix = resolveInteractiveShell("linux");
assert(interactiveUnix.args.join(" ") === "-l", "Unix 交互式 shell 应使用登录 shell");
const ptyWin = resolvePtyShell("win32");
assert(ptyWin.label === "CMD" && !ptyWin.args.includes("-NonInteractive"), "Windows 系统默认应来自 ComSpec");
assert(systemShellCandidate({ platform: "win32", env: { ComSpec: "C:\\custom\\cmd.exe" } }).file === "C:\\custom\\cmd.exe", "系统默认终端忽略了 ComSpec");
assert(systemShellCandidate({ platform: "darwin", env: {}, loginShell: "/bin/zsh" }).file === "/bin/zsh", "macOS 默认应使用登录 shell");
assert(systemShellCandidate({ platform: "linux", env: { SHELL: "/bin/fish" }, loginShell: "/bin/bash" }).file === "/bin/fish", "Unix 系统默认应优先遵循 SHELL");
assert(resolvePtyShell("linux").args.join(" ") === "-l", "Unix PTY 应使用登录 shell");

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

  const command = `"${process.execPath}" -e "process.stdout.write(String.fromCharCode(27)+'[31mterminal-color'+String.fromCharCode(27)+'[0m terminal-ok 中文'); process.stderr.write('terminal-err'); process.exit(0)"`;
  const task = host.start(process.cwd(), command);
  assert(task.status === "running" && Boolean(task.pid), "任务未启动");
  await waitFor(() => host.list().find((item) => item.id === task.id && item.status !== "running"));
  const done = host.list().find((item) => item.id === task.id);
  assert(done?.status === "exited", `任务状态错误：${done?.status}`);
  assert(done?.exitCode === 0, `退出码错误：${done?.exitCode}`);
  assert(done?.output.includes("\u001B[31mterminal-color"), `ANSI 颜色被意外移除：${JSON.stringify(done?.output)}`);
  assert(stripTerminalAnsi(done?.output ?? "").includes("terminal-color") && done?.output.includes("terminal-err"), `输出缺失：${JSON.stringify(done?.output)}`);
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
    await limitedHost.dispose();
  }

  const shell = host.startShell(process.cwd());
  assert(shell.interactive, "交互式会话应标记 interactive");
  const shellMarker = `shell-${Date.now()}`;
  const shellLines =
    process.platform === "win32"
      ? [`$piDesktopProbe = "ok"`, `Write-Output "${shellMarker}-$piDesktopProbe"`]
      : [`PI_DESKTOP_PROBE=ok`, `printf "${shellMarker}-%s\\n" "$PI_DESKTOP_PROBE"`];
  for (const line of shellLines) host.write(shell.id, line);
  host.write(shell.id, process.platform === "win32" ? `Write-Output "中文，标点"` : `printf "中文，标点\\n"`);
  await waitFor(() => host.list().find((item) => item.id === shell.id && item.output.includes(`${shellMarker}-ok`)));
  assert(host.list().find((item) => item.id === shell.id)?.output.includes("中文，标点"), "交互式会话应正确传递 UTF-8 输入");
  const shellRunning = host.list().find((item) => item.id === shell.id);
  assert(shellRunning?.status === "running" && shellRunning.interactive, "交互式会话应保持运行");
  assert(!shellRunning?.output.includes("PS C:") && !shellRunning?.output.includes("> $piDesktopProbe"), "交互式会话不应回显提示符或命令");
  host.write(shell.id, "exit");
  await waitFor(() => host.list().find((item) => item.id === shell.id && item.status !== "running"));
  assert(host.list().find((item) => item.id === shell.id)?.status === "exited", "交互式会话退出状态错误");

  // 真实 PTY：全屏/光标序列、原始按键、尺寸变更、Ctrl+C 都交给终端程序。
  const pty = await host.startPty(process.cwd(), 80, 24);
  assert(pty.pty && pty.interactive && Boolean(pty.pid), "PTY 会话未启动");
  assert(pty.cols === 80 && pty.rows === 24, "PTY 初始尺寸错误");
  const fixture = fileURLToPath(new URL("./terminal-pty.fixture.cjs", import.meta.url));
  const ptyCommand = `"${process.execPath}" "${fixture}"`;
  host.writePty(pty.id, `${ptyCommand}\r`);
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.output.includes("PTY-PROBE-READY")));
  const probe = host.list().find((item) => item.id === pty.id);
  assert(probe?.output.includes("TTY: input=true output=true"), "PTY 子进程必须拿到真实 TTY");
  assert(probe?.output.includes("TERM:xterm-256color"), "PTY 应声明 xterm 能力");
  assert(probe?.output.includes("\u001B[?1049h"), "全屏备用屏幕控制序列被丢弃");
  host.writePty(pty.id, "\u001B[A");
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.output.includes("PTY-HEX:1b5b41")));
  host.writePty(pty.id, "中文\r");
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.output.includes("e4b8ade69687")));
  assert(host.resizePty(pty.id, 110, 34), "PTY resize 失败");
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.output.includes("PTY-SIZE:110x34")));
  const resized = host.list().find((item) => item.id === pty.id);
  assert(resized?.cols === 110 && resized?.rows === 34, "PTY 尺寸快照未同步");
  host.writePty(pty.id, String.fromCharCode(3));
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.output.includes("PTY-CTRL-C")));
  assert(host.list().find((item) => item.id === pty.id)?.status === "running", "Ctrl+C 不应杀掉外层 shell");
  host.writePty(pty.id, "exit\r");
  await waitFor(() => host.list().find((item) => item.id === pty.id && item.status !== "running"));
  assert(host.list().find((item) => item.id === pty.id)?.pty, "PTY 结束后的快照应保留终端类型");

  // 启动时可临时选择另一 shell；配置改变不会影响已有任务。
  const profiles = await listTerminalProfiles();
  assert(profiles.some((profile) => profile.id === "system"), "缺少系统默认终端");
  for (const id of process.platform === "win32" ? ["pwsh", "powershell", "git-bash"] : ["bash", "zsh"]) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) continue;
    const selected = await host.startPty(process.cwd(), 100, 24, { profileId: id });
    assert(selected.profileId === id && selected.shellPath === profile.file, "选中的 shell 配置未传给宿主");
    const marker = `profile-${id}-${Date.now()}`;
    const command = id === "pwsh" || id === "powershell"
      ? `Write-Output ("${marker}" + "-done")` : `printf "%s-done\\n" "${marker}"`;
    host.writePty(selected.id, `${command}\r`);
    await waitFor(() => host.list().find((item) => item.id === selected.id && item.output.includes(`${marker}-done`)));
    assert(host.stop(selected.id), "可选 shell 无法停止");
    await waitFor(() => host.list().find((item) => item.id === selected.id && item.status === "stopped"));
    const background = await host.startWithProfile(process.cwd(), command, { profileId: id });
    await waitFor(() => host.list().find((item) => item.id === background.id && item.status !== "running"));
    const backgroundDone = host.list().find((item) => item.id === background.id);
    assert(backgroundDone?.status === "exited" && backgroundDone.output.includes(`${marker}-done`), `一次性命令未使用选定 shell：${id}/${backgroundDone?.output}`);
  }
  const defaultTask = await host.startWithProfile(process.cwd(), `"${process.execPath}" -e "process.stdout.write('default-shell-ok 中文')"`);
  await waitFor(() => host.list().find((item) => item.id === defaultTask.id && item.status !== "running"));
  const defaultDone = host.list().find((item) => item.id === defaultTask.id);
  assert(defaultDone?.status === "exited" && defaultDone.output.includes("default-shell-ok 中文"), `系统默认 shell 带引号路径/UTF-8 输出错误：${defaultDone?.output}`);
  const custom = await resolveTerminalProfile({ profileId: "custom", customPath: process.execPath, customArgs: ["--version"] });
  assert(custom.args[0] === "--version", "自定义 shell 参数不应进行命令行拆分");
  const customTask = await host.startPty(process.cwd(), 80, 24, { profileId: "custom", customPath: process.execPath, customArgs: ["--version"] });
  await waitFor(() => host.list().find((item) => item.id === customTask.id && item.status === "exited"));
  assert(host.list().find((item) => item.id === customTask.id)?.output.includes(process.version), "自定义可执行文件未按独立参数运行");
  for (const options of [{ profileId: "missing-shell" }, { profileId: "custom", customPath: "relative.exe" }, { profileId: "custom", customPath: process.execPath, customArgs: [3] as any }]) {
    const result = await Promise.allSettled([resolveTerminalProfile(options)]);
    assert(result[0].status === "rejected", "非法 shell 配置应被拒绝");
  }

  // 异步加载期间也计入并发限制；退出时不允许迟到的创建留下子进程。
  const singleHost = new TerminalHost({ emit: () => {}, maxTasks: 1 });
  try {
    const first = singleHost.startPty(process.cwd(), 80, 24);
    const second = singleHost.startPty(process.cwd(), 80, 24);
    const results = await Promise.allSettled([first, second]);
    assert(results.filter((result) => result.status === "fulfilled").length === 1, "并发 PTY 创建绕过了任务上限");
    const runningPty = singleHost.list().find((item) => item.status === "running");
    assert(runningPty && singleHost.stop(runningPty.id), "结束 PTY 会话失败");
    await waitFor(() => singleHost.list().find((item) => item.id === runningPty.id && item.status === "stopped"));
  } finally {
    await singleHost.dispose();
  }
  const closingHost = new TerminalHost({ emit: () => {} });
  const pendingStart = closingHost.startPty(process.cwd());
  const closedHost = closingHost.dispose();
  const lateStart = await Promise.allSettled([pendingStart]);
  await closedHost;
  assert(lateStart[0].status === "rejected" && closingHost.list().length === 0, "关闭宿主后不应继续启动 PTY");

  const long = host.start(process.cwd(), `"${process.execPath}" -e "setTimeout(() => {}, 30000)"`);
  await wait(250);
  assert(host.stop(long.id), "停止任务失败");
  await waitFor(() => host.list().find((item) => item.id === long.id && item.status !== "running" && item.status !== "stopping"));
  const stopped = host.list().find((item) => item.id === long.id);
  assert(stopped?.status === "stopped", `停止状态错误：${stopped?.status}`);
  assert(events.some((event) => event.type === "status" && event.task?.id === long.id), "缺少 stopping 状态事件");
  assert(events.some((event) => event.type === "exit" && event.id === long.id), "缺少退出事件");
} finally {
  await host.dispose();
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

// 交互式会话：send 走 writeTerminal，密码输入不进入内存历史。
const shellListeners = new Set<(event: any) => void>();
let shellSeq = 0;
const shellWrites: string[] = [];
const shellHost = {
  startTerminal: async (cwd: string, command: string) => ({
    id: `plain-${++shellSeq}`,
    command,
    cwd,
    shell: "sh",
    startedAt: Date.now(),
    status: "running",
  }),
  startTerminalShell: async (cwd: string) => {
    const info = {
      id: `shell-${++shellSeq}`,
      command: "交互式 sh",
      cwd,
      shell: "sh",
      startedAt: Date.now(),
      status: "running",
      interactive: true,
    };
    for (const listener of shellListeners) listener({ type: "start", task: info });
    return info;
  },
  writeTerminal: async (id: string, input: string) => {
    shellWrites.push(`${id}:${input}`);
    return true;
  },
  stopTerminal: async () => true,
  terminalTasks: async () => [],
  onTerminalEvent: (listener: (event: any) => void) => {
    shellListeners.add(listener);
    return () => shellListeners.delete(listener);
  },
};
const shellService = createTerminalService({ host: shellHost, getCwd: () => "C:/mock" });
try {
  assert(shellService.supportsShell, "支持交互式会话时应暴露 supportsShell");
  await shellService.startShell();
  const shellTask = shellService.activeTask.value;
  assert(shellTask?.interactive && shellTask.status === "running", "startShell 未创建交互式会话");
  shellService.state.input = "SELECT 1;";
  await shellService.send();
  assert(shellWrites.at(-1)?.endsWith(":SELECT 1;"), `交互式发送失败：${shellWrites.at(-1)}`);
  assert(shellService.state.input === "", "发送后应清空输入");
  assert(shellTask.inputs[0] === "SELECT 1;", "交互式历史未记录");
  assert(shellTask.output.includes("❯ SELECT 1;"), "交互式会话应回显命令");
  shellService.historyUp();
  assert(shellService.state.input === "SELECT 1;", "交互式历史回溯失败");
  shellService.state.input = "hunter2";
  await shellService.send(undefined, { secret: true });
  assert(shellTask.inputs[0] === "SELECT 1;" && !shellTask.inputs.includes("hunter2"), "密码不应进入历史");
  assert(!shellTask.output.includes("hunter2"), "密码不应回显到输出");
} finally {
  shellService.dispose();
}

// PTY 服务：输出按会话订阅，按键按序且不记历史；尺寸失败可重试，迟到快照不回退。
const ptyListeners = new Set<(event: any) => void>();
const ptyWrites: Array<{ id: string; data: string; binary: boolean }> = [];
const ptySizes: Array<{ id: string; cols: number; rows: number }> = [];
let failResize = true;
let ptySeq = 0;
const ptyHost = {
  ...mockHost,
  startTerminalPty: async (cwd: string, cols: number, rows: number) => {
    const info = {
      id: `pty-${++ptySeq}`, command: "sh", cwd, shell: "sh", startedAt: Date.now(),
      status: "running", interactive: true, pty: true, cols, rows,
    };
    for (const listener of ptyListeners) listener({ type: "start", task: info });
    return info;
  },
  writeTerminalPty: async (id: string, data: string, binary: boolean) => {
    await wait(data === "first" ? 20 : 0);
    ptyWrites.push({ id, data, binary });
    return true;
  },
  resizeTerminalPty: async (id: string, cols: number, rows: number) => {
    ptySizes.push({ id, cols, rows });
    if (failResize) { failResize = false; return false; }
    return true;
  },
  onTerminalEvent: (listener: (event: any) => void) => {
    ptyListeners.add(listener);
    return () => ptyListeners.delete(listener);
  },
};
const ptyService = createTerminalService({ host: ptyHost, getCwd: () => "C:/mock" });
try {
  assert(ptyService.supportsPty, "PTY 桥存在时应暴露 supportsPty");
  await ptyService.startPty(80, 24);
  const ptyTask = ptyService.activeTask.value;
  assert(ptyTask?.pty && ptyTask.interactive, "PTY 类型未同步到渲染层");
  const chunks: string[] = [];
  const offData = ptyService.onData(ptyTask.id, (text) => chunks.push(text));
  const terminalOutput = `${String.fromCharCode(27)}[?1049h${"x".repeat(510_000)}`;
  for (const listener of ptyListeners) listener({ type: "data", id: ptyTask.id, stream: "stdout", text: terminalOutput });
  assert(chunks[0] === terminalOutput, "PTY 输出订阅不能被尾部日志裁剪影响");
  assert(ptyTask.output.length <= 500_000 && ptyTask.truncated, "PTY 日志缓存应仍限长");
  offData();
  for (const listener of ptyListeners) listener({ type: "data", id: ptyTask.id, stream: "stdout", text: "more" });
  assert(chunks.length === 1, "PTY 输出订阅未正确注销");

  await Promise.all([ptyService.writePty(ptyTask.id, "first"), ptyService.writePty(ptyTask.id, "second")]);
  assert(ptyWrites[0]?.data === "first" && ptyWrites[1]?.data === "second", "异步 IPC 改变了按键顺序");
  await ptyService.writePty(ptyTask.id, String.fromCharCode(0, 3, 255), true);
  assert(ptyWrites.at(-1)?.binary && ptyWrites.at(-1)?.data === String.fromCharCode(0, 3, 255), "原始按键/二进制鼠标输入被改写");
  const outputBeforeInput = ptyTask.output;
  ptyService.state.input = "hunter2";
  await ptyService.send(undefined, { secret: true });
  assert(ptyWrites.at(-1)?.data === "hunter2\r" && ptyTask.inputs.length === 0, "PTY 输入不能做人工回显或存历史");
  assert(ptyTask.output === outputBeforeInput && !ptyService.state.history.includes("hunter2"), "密码进入了日志/命令历史");
  ptyService.clearOutput(ptyTask.id);
  assert(ptyTask.output === outputBeforeInput, "PTY 不应通过清空日志破坏备用屏幕");

  await ptyService.resizePty(ptyTask.id, 110, 34);
  assert(ptyTask.cols === 80 && ptyTask.rows === 24, "失败的 resize 不应标记为已同步");
  await ptyService.resizePty(ptyTask.id, 110, 34);
  assert(ptyTask.cols === 110 && ptyTask.rows === 34 && ptySizes.length === 2, "resize 失败后无法重试");
  for (const listener of ptyListeners) listener({ type: "status", task: { ...ptyTask, cols: 80, rows: 24 } });
  assert(ptyTask.cols === 110 && ptyTask.rows === 34, "迟到状态快照覆盖了 xterm 尺寸");

  await ptyService.startPty(90, 26);
  await ptyService.writePty(ptyTask.id, "old-task");
  assert(ptyWrites.at(-1)?.id === ptyTask.id, "切换任务后按键被发给了新会话");
  const received: string[] = [];
  ptyService.onData(ptyTask.id, (text) => received.push(text));
  ptyService.dispose();
  for (const listener of ptyListeners) listener({ type: "data", id: ptyTask.id, stream: "stdout", text: "after-dispose" });
  assert(received.length === 0, "销毁终端服务后不应继续推送输出");
} finally {
  ptyService.dispose();
}

// 关闭插件时不做宿主订阅 / 快照请求，不启动后台任务；用户开启后才连接。
let disabledSubscriptions = 0;
let disabledStarts = 0;
const disabledService = createTerminalService({
  host: {
    ...ptyHost,
    onTerminalEvent: () => { disabledSubscriptions += 1; return () => {}; },
    startTerminalPty: async (...args: any[]) => { disabledStarts += 1; return ptyHost.startTerminalPty(args[0], args[1], args[2]); },
  },
  getCwd: () => "C:/mock",
  enabled: false,
  getProfileOptions: () => ({ profileId: "pwsh" }),
});
try {
  await disabledService.startPty();
  disabledService.toggle();
  assert(!disabledService.state.open && disabledSubscriptions === 0 && disabledStarts === 0, "停用插件仍在启动或订阅终端");
  disabledService.setEnabled(true);
  await disabledService.startPty();
  assert(disabledSubscriptions === 1 && disabledStarts === 1, "首次启用终端插件后没有连接宿主");
  disabledService.setEnabled(false);
  assert(disabledService.activeTask.value?.status === "running" && !disabledService.state.open, "停用终端插件强制杀掉了已有会话");
} finally {
  disabledService.dispose();
}

console.log("terminal service OK");
