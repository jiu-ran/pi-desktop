// 对 scripts/checks 下所有 .mjs / .cjs 做语法检查，并禁止写死本机路径。
// 这些文件不经过 tsc，也不一定被 npm run check 执行；语法错误只会在 CI 的 Electron 冒烟中暴露。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)));
const files = readdirSync(dir).filter((name) => /\.(mjs|cjs)$/.test(name)).sort();
let failed = 0;
for (const name of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(dir, name)], { stdio: "pipe" });
  } catch (error) {
    failed += 1;
    console.error(`[syntax] ${name}\n${error.stderr?.toString() ?? error.message}`);
  }
}
if (failed) {
  console.error(`[syntax] ${failed} 个文件语法错误`);
  process.exit(1);
}

// 检查产物必须走 os.tmpdir()：写死本机绝对路径在本机能跑，CI 运行器上目录不存在，
// 会在冒烟阶段才报 ENOENT（v0.2.2 的 Windows 构建就这样挂过一次）。
const absoluteHome = /["'`](?:[A-Za-z]:[\\/]{1,2}Users[\\/]|(?:[\\/](?:home|Users)[\\/]))/;
const leaks = files
  .map((name) => ({ name, file: path.join(dir, name) }))
  .map((entry) => {
    const source = readFileSync(entry.file, "utf8");
    const line = source.split(/\r?\n/).findIndex((text) => absoluteHome.test(text));
    return line < 0 ? null : `${entry.name}:${line + 1}`;
  })
  .filter(Boolean);
if (leaks.length) {
  console.error(`[syntax] 检查脚本里出现了写死的本机路径，请改用 os.tmpdir() 或 mkdtemp()：\n${leaks.join("\n")}`);
  process.exit(1);
}

console.log(`syntax OK（${files.length} 个文件）`);
