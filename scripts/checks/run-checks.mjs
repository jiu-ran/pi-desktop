// 回归检查的统一入口：把所有 `*.check.ts` 并行跑完，再汇总失败。
//
// 以前 `package.json` 的 `check` 是一条 80 多段的 `&&` 长链：只能串行、一个挂了
// 后面的全不跑、加一个检查就得手工往长链里塞。现在这里自动发现文件并按 CPU
// 并行调度，最快的那批（80+ 个纯函数检查，单个 <300ms）几乎同时跑完。
//
// 用法：
//   npm run check                                     # 全量（发布前 / CI）
//   npm run check:changed                             # 只跑被改动文件影响的检查（日常提交）
//   npm run check:full                                # 单并发 + 逐个打印（排查性能／时序）
//   node scripts/checks/run-checks.mjs --only=git     # 按名字子串挑几个
//   node scripts/checks/run-checks.mjs --list         # 列出所有检查（带 [全局] 标记）
//   node scripts/checks/run-checks.mjs --verbose      # 每个检查都打一行
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const checksDir = here;

/** 永远跟着跑的「全局守门」：整体扫描仓库，单个都只有几百毫秒 */
const ALWAYS = new Set([
  "capability-boundary",
  "css-tokens",
  "palette-css",
  "settings-tabs",
  "icons",
  "file-icons",
]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};

const wanted = value("only");
const only = new Set(wanted ? wanted.split(",").map((item) => item.trim()).filter(Boolean) : []);
const nameOf = (file) => path.basename(file).replace(/\.check\.ts$/, "");
const jobs = Number(value("jobs")) || Math.max(2, Math.min(availableParallelism() - 1, 12));
const timeoutMs = Number(value("timeout")) || 240_000;

const allChecks = readdirSync(checksDir)
  .filter((name) => name.endsWith(".check.ts"))
  .sort()
  .map((name) => path.join(checksDir, name));

if (flag("list")) {
  for (const file of allChecks) console.log(`${nameOf(file)}${ALWAYS.has(nameOf(file)) ? "  [全局]" : ""}`);
  console.log(`共 ${allChecks.length} 个检查`);
  process.exit(0);
}

/** 扫出这个检查直接 import 的本地文件（相对路径与 import("...") 两种写法） */
function localImports(file) {
  const source = readFileSync(file, "utf8");
  const found = new Set();
  const add = (spec) => {
    if (!spec.startsWith(".")) return;
    const resolved = path.resolve(path.dirname(file), spec);
    for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.mjs`]) {
      if (existsSync(candidate) && !found.has(candidate)) found.add(candidate);
    }
  };
  for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) add(match[1]);
  return [...found];
}

/** 每个检查「负责」哪些源文件（含传递依赖），用来把改动映射到检查 */
const coverage = new Map();
for (const file of allChecks) {
  const seen = new Set();
  const queue = [file];
  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...localImports(current));
  }
  coverage.set(file, seen);
}

/** 改动文件 = 未提交的（含未跟踪）+ 相对上游分支已提交但没推的 */
function changedFiles() {
  const run = (commandArgs) => {
    try {
      return execFileSync("git", commandArgs, { cwd: repoRoot, encoding: "utf8" });
    } catch {
      return "";
    }
  };
  const listed = [
    run(["diff", "--name-only", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ];
  const upstream = run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).trim();
  if (upstream) listed.push(run(["diff", "--name-only", `${upstream}...HEAD`]));
  const files = listed
    .flatMap((text) => text.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => path.resolve(repoRoot, line));
  return [...new Set(files)];
}

function pickChecks() {
  if (only.size) {
    return allChecks.filter((file) => [...only].some((needle) => nameOf(file).includes(needle)));
  }
  if (!flag("changed")) return allChecks;

  const changed = changedFiles();
  if (!changed.length) {
    console.log("[check] 没有检测到改动（相对 HEAD 与上游），改为全量回归");
    return allChecks;
  }
  const hit = allChecks.filter((file) => [...coverage.get(file)].some((source) => changed.includes(source)));
  const global = allChecks.filter((file) => ALWAYS.has(nameOf(file)) && !hit.includes(file));
  const chosen = [...hit, ...global];
  const touched = changed.map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"));
  console.log(`[check] 改动 ${touched.length} 个文件 → 命中 ${hit.length} 个相关检查 + ${global.length} 个全局守门`);
  for (const file of touched.slice(0, 12)) console.log(`[check]   · ${file}`);
  if (touched.length > 12) console.log(`[check]   · …另有 ${touched.length - 12} 个文件`);
  if (!hit.length) {
    // 只改了 UI 组件 / 样式 / DOM 层：没有单元检查覆盖，这里不假装测过了
    console.log("[check] 这些改动没有对应的单元检查（多在 .vue / 样式 / DOM 层），只跑了全局守门；");
    console.log("[check] 要完整回归用 `npm run check`，要看真实窗口冒烟用 `PI_DESKTOP_SMOKE=1 npx mygo dev`。");
  }
  return chosen;
}

/** 静态分析步骤：类型检查与脚本语法，和单元检查一起排进同一个池子 */
function staticTasks() {
  const tasks = [];
  const tsc = path.join(repoRoot, "node_modules/typescript/bin/tsc");
  if (existsSync(tsc)) {
    tasks.push({ label: "tsc（界面 .ts / 检查脚本）", command: process.execPath, args: [tsc, "--noEmit"] });
  }
  const vueTsc = path.join(repoRoot, "packages/ui/node_modules/vue-tsc/bin/vue-tsc.js");
  if (existsSync(vueTsc)) {
    tasks.push({
      label: "vue-tsc（界面）",
      command: process.execPath,
      args: [vueTsc, "--noEmit", "-p", "tsconfig.json"],
      cwd: path.join(repoRoot, "packages/ui"),
    });
  }
  tasks.push({ label: "syntax（检查脚本自身）", command: process.execPath, args: [path.join(checksDir, "syntax.mjs")] });
  return tasks;
}

function runTask(task) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(task.command, task.args, {
      cwd: task.cwd ?? repoRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ...task, code, output, ms: Math.round(performance.now() - started) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ...task, code: -1, output: String(error), ms: Math.round(performance.now() - started) });
    });
  });
}

async function pool(tasks, limit) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      const result = await runTask(task);
      results.push(result);
      if (flag("verbose") || result.code !== 0) {
        const mark = result.code === 0 ? "ok  " : "FAIL";
        console.log(`${mark} ${result.label} (${result.ms}ms)`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const checks = pickChecks();
if (!checks.length) {
  console.error("[check] 没选中任何检查（--only 是否写错？用 --list 看一眼）");
  process.exit(1);
}

const tasks = [
  ...staticTasks(),
  ...checks.map((file) => ({
    label: nameOf(file),
    command: process.execPath,
    args: [file],
    cwd: repoRoot,
  })),
];

const started = performance.now();
console.log(`[check] 共 ${tasks.length} 个任务（${checks.length} 个检查 + ${tasks.length - checks.length} 个静态分析），并发 ${jobs}`);
const results = await pool(tasks, jobs);
const total = Math.round(performance.now() - started);
const failed = results.filter((result) => result.code !== 0);

const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
if (failed.length) {
  for (const result of failed) {
    console.error(`\n===== ${result.label} 失败（${result.ms}ms）=====`);
    const lines = result.output.trim().split(/\r?\n/);
    // 失败的断言通常在最后：留 30 行，别把 CI 日志刷爆
    console.error(lines.slice(-30).join("\n"));
  }
  console.error(`\n[check] FAIL ${failed.length}/${results.length} 失败，耗时 ${total}ms`);
  process.exit(1);
}

console.log(`[check] PASS ${results.length}/${results.length}，耗时 ${total}ms`);
console.log(`[check] 最慢：${slowest.map((item) => `${item.label} ${item.ms}ms`).join(" / ")}`);
if (!flag("changed") && total > 30_000) {
  console.log("[check] 提示：日常提交用 `npm run check:changed` 只跑受影响的部分，比全量快一个量级。");
}
