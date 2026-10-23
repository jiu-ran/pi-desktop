import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** CI 和手工发布共用中文说明，不回退到 GitHub 自动生成的英文提交清单。 */
const [version, output] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || "") || !output) {
  throw new Error("用法：node scripts/release-notes.mjs <版本号> <输出路径>");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let notes;
try {
  notes = await readFile(path.join(root, "docs", "releases", `v${version}.md`), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const log = (await readFile(path.join(root, "CHANGELOG.md"), "utf8")).replace(/\r\n/g, "\n");
  const start = log.indexOf(`## [${version}]`);
  if (start < 0) throw new Error(`CHANGELOG.md 缺少 ${version} 的发布记录`);
  const end = log.indexOf("\n## [", start + 1);
  notes = log.slice(start, end < 0 ? undefined : end).trim() + "\n";
}
await writeFile(output, notes);
console.log(`已生成 ${version} 中文发布说明：${output}`);
