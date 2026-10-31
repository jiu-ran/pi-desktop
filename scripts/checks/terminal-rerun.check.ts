import assert from "node:assert/strict";
import { createTerminalService } from "../../packages/ui/src/services/terminal.ts";

/**
 * 后台命令的「重新执行」。
 *
 * 语义要求：**在原标签里重跑**，不新增标签 —— 以前是把命令填回输入框，
 * 回车又开一个同名标签，跑几次就堆一排。
 */

interface FakeTask {
  id: string;
  command: string;
  cwd: string;
  status: string;
}

function createHarness(initial: FakeTask[] = []) {
  const calls: string[] = [];
  let seq = 0;
  const tasks = new Map(initial.map((task) => [task.id, { ...task }]));
  let listener: ((event: any) => void) | null = null;
  // 真机上「进程退出」是主进程推事件过来的：假宿主也得推，否则状态会一直停在 stopping
  const emitExit = (id: string) =>
    listener?.({ type: "exit", id, status: "stopped", exitCode: 0, signal: null, endedAt: Date.now() });
  const host = {
    startTerminal: async (cwd: string, command: string) => {
      const id = `t${++seq}`;
      calls.push(`start:${id}:${command}`);
      const info = { id, command, cwd, pid: 100 + seq, shell: "bash", startedAt: Date.now(), status: "running" };
      tasks.set(id, { id, command, cwd, status: "running" });
      // 真主进程会先推 start 事件；这里同步推，用来抓「同一 id 进列表两次」的回归
      listener?.({ type: "start", task: info });
      return info;
    },
    stopTerminal: async (id: string) => {
      calls.push(`stop:${id}`);
      const task = tasks.get(id);
      if (task) task.status = "stopped";
      emitExit(id);
      return true;
    },
    onTerminalEvent: (fn: (event: any) => void) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  const service = createTerminalService({ host, getCwd: () => "/repo/app" });
  service.setEnabled(true);

  // 把一条「已结束」的命令塞进状态里：模拟历史上跑过、现在停着的标签
  const seed = (task: FakeTask) => {
    service.state.tasks.push({
      id: task.id,
      command: task.command,
      cwd: task.cwd,
      shell: "bash",
      startedAt: 1,
      endedAt: 2,
      status: "exited",
      exitCode: 0,
      interactive: false,
      pty: false,
      cols: 0,
      rows: 0,
      inputs: ["旧输入"],
      inputIndex: -1,
      output: "旧输出",
      truncated: false,
    } as any);
    service.state.activeId = task.id;
  };

  return { service, calls, seed, tasks, dispose: () => service.dispose() };
}

// 1. 已结束的后台命令：原地重跑，标签数量不变、位置不变、输出清空
{
  const { service, calls, seed, dispose } = createHarness();
  seed({ id: "a", command: "npm test", cwd: "/repo/app", status: "exited" });
  seed({ id: "b", command: "npm run build", cwd: "/repo/app", status: "exited" });
  const ok = await service.rerun("a");
  assert.equal(ok, true, "已结束的任务要能重跑");
  assert.deepEqual(
    service.state.tasks.map((task) => task.command),
    ["npm test", "npm run build"],
    "重跑不能新增标签，也不能改动别的标签顺序",
  );
  const rerun = service.state.tasks.find((task) => task.command === "npm test")!;
  assert.notEqual(rerun.id, "a", "重跑的是新进程，id 会变");
  assert.equal(rerun.status, "running");
  assert.equal(rerun.output, "", "新一次执行的输出从空白开始");
  assert.equal(service.state.activeId, rerun.id, "重跑后焦点留在这个标签上");
  assert.deepEqual(calls, ["start:t1:npm test"], "只启动一次，不碰停止");
  dispose();
}

// 2. 运行中的任务：先结束再来一次（脚本里 stop 会同步把状态置为 stopped）
{
  const { service, calls, seed, dispose } = createHarness();
  seed({ id: "a", command: "npm run dev", cwd: "/repo/app", status: "running" });
  (service.state.tasks[0] as any).status = "running";
  const ok = await service.rerun("a");
  assert.equal(ok, true);
  assert.deepEqual(calls, ["stop:a", "start:t1:npm run dev"], "先停旧的，再在同一个标签里起新的");
  assert.equal(service.state.tasks.length, 1, "仍然只有一个标签");
  dispose();
}

// 2b. start 事件先到的情况：列表里不能出现同一个 id 两遍
{
  const { service, seed, dispose } = createHarness();
  seed({ id: "a", command: "npm test", cwd: "/repo/app", status: "exited" });
  const ok = await service.rerun("a");
  assert.equal(ok, true);
  assert.equal(service.state.tasks.length, 1, "start 事件先插进来时，重跑也只留一条");
  const ids = new Set(service.state.tasks.map((task) => task.id));
  assert.equal(ids.size, service.state.tasks.length, `不能出现重复 id：${JSON.stringify([...ids])}`);
  dispose();
}

// 3. 交互终端 / PTY 不能这样重跑（要重跑就在终端里按 ↑ 回车）
{
  const { service, calls, seed, dispose } = createHarness();
  seed({ id: "p", command: "bash", cwd: "/repo/app", status: "exited" });
  (service.state.tasks[0] as any).pty = true;
  assert.equal(await service.rerun("p"), false, "PTY 会话不走这条路径");
  assert.deepEqual(calls, [], "不该启动任何进程");
  dispose();
}

// 4. 找不到的任务 / 空命令：安全返回 false
{
  const { service, calls, dispose } = createHarness();
  assert.equal(await service.rerun("nope"), false);
  assert.deepEqual(calls, []);
  dispose();
}

// 5. 停止：调用主进程的 stopTerminal，状态先进 stopping
{
  const { service, calls, seed, dispose } = createHarness();
  seed({ id: "a", command: "npm test", cwd: "/repo/app", status: "running" });
  (service.state.tasks[0] as any).status = "running";
  await service.stop("a");
  assert.deepEqual(calls, ["stop:a"]);
  assert.notEqual(service.state.tasks[0].status, "running", "停止后不再显示运行中");
  dispose();
}

console.log("terminal-rerun OK 原地重跑 / 先停再跑 / PTY 拒绝 / 未知任务 / 停止");
