// 对 scripts/checks 下所有 .mjs / .cjs 做语法检查，并禁止写死本机路径。
// 这些文件不经过 tsc，也不一定被 npm run check 执行；语法错误只会在 CI 的 Electron 冒烟中暴露。
//
// 两种用法：
//   node scripts/checks/syntax.mjs            # 单独跑（并行，几十个文件几百毫秒）
//   import { runSyntaxCheck } from "./syntax.mjs"   # 由 run-checks.mjs 当静态分析调
import { readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

function checkSyntax(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--check", file], { encoding: "utf8" }, (error, _stdout, stderr) => {
      resolve(error ? { file, text: stderr || error.message } : null);
    });
  });
}

/** 返回错误列表（空数组 = 通过）；`quiet` 为 false 时自己打印结果 */
export async function runSyntaxCheck({ quiet = false } = {}) {
  const files = readdirSync(dir).filter((name) => /\.(mjs|cjs)$/.test(name)).sort();
  const errors = [];
  // 并行跑 `node --check`：串行时 110 个文件要 2 秒多，纯属浪费
  const limit = Math.max(2, Math.min(availableParallelism() - 1, 12));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, files.length) }, async () => {
    while (cursor < files.length) {
      const name = files[cursor];
      cursor += 1;
      const failure = await checkSyntax(path.join(dir, name));
      if (failure) errors.push({ ...failure, name });
    }
  });
  await Promise.all(workers);

  for (const failure of errors) {
    if (!quiet) console.error(`[syntax] ${failure.name}\n${failure.text}`);
  }

  // 检查产物必须走 os.tmpdir()：写死本机绝对路径在本机能跑，CI 运行器上目录不存在，
  // 会在冒烟阶段才报 ENOENT（v0.2.2 的 Windows 构建就这样挂过一次）。
  const absoluteHome = /["'`](?:[A-Za-z]:[\\/]{1,2}Users[\\/]|(?:[\\/](?:home|Users)[\\/]))/;
  const leaks = files
    .map((name) => {
      const source = readFileSync(path.join(dir, name), "utf8");
      const line = source.split(/\r?\n/).findIndex((text) => absoluteHome.test(text));
      return line < 0 ? null : `${name}:${line + 1}`;
    })
    .filter(Boolean);
  if (leaks.length && !quiet) {
    console.error(`[syntax] 检查脚本里出现了写死的本机路径，请改用 os.tmpdir() 或 mkdtemp()：\n${leaks.join("\n")}`);
  }
  if (!errors.length && !leaks.length && !quiet) console.log(`syntax OK（${files.length} 个文件）`);
  return [...errors.map((failure) => `语法错误 ${failure.name}`), ...leaks.map((leak) => `写死本机路径 ${leak}`)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = await runSyntaxCheck();
  if (problems.length) {
    console.error(`[syntax] ${problems.length} 个问题`);
    process.exit(1);
  }
}
