// 对 scripts/checks 下所有 .mjs / .cjs 做语法检查。
// 这些文件不经过 tsc，也不一定被 npm run check 执行；语法错误只会在 CI 的 Electron 冒烟中暴露。
import { readdirSync } from "node:fs";
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
console.log(`syntax OK（${files.length} 个文件）`);
