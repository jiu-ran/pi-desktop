import assert from "node:assert/strict";
import { resolveFileIcon } from "../../packages/ui/src/shared/file-icons.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 文件 / 文件夹图标：只有一套默认图形。
 *
 * 之前挂过整包 Material Icon Theme（162 图标 / 218 扩展名 / 三主题），
 * 结果文件树里彩色图形太多，反而出现「普通文件夹显示成一张纸」的 bug
 * （生成脚本漏了通用兜底名 `folder`）。现在统一成两种图形，这里钉住：
 * - 文件夹一定用文件夹图形，文件一定用文件图形，两者不能共用一个 body；
 * - 不再有「按扩展名 / 文件名 / 文件夹名」的映射表，也没有主题切换。
 */

const FOLDER = resolveFileIcon("whatever", { isFolder: true });
const DOC = resolveFileIcon("whatever.txt");

// 1) 两种图形必须真的不一样（同 body = 文件夹又变回了文件图标）
assert.notEqual(FOLDER.body, DOC.body, "文件夹与文件不能共用同一个图形");
assert.ok(FOLDER.body.length > 20 && DOC.body.length > 20, "两种图形都要有内容");
assert.equal(FOLDER.icon, "folder");
assert.equal(DOC.icon, "document");

// 2) 类型名给读屏 / title 用
assert.equal(FOLDER.label, "文件夹");
assert.equal(DOC.label, "文件");
assert.equal(FOLDER.isFolder, true);
assert.equal(DOC.isFolder, false);

// 3) 不区分类型：任何文件名 / 扩展名 / 文件夹名，结果都只有 `folder` 或 `document`
const names = [
  "src",
  "node_modules",
  ".git",
  "dist",
  "win-unpacked",
  "locales",
  "resources",
  "app.ts",
  "App.vue",
  "base.css",
  "package.json",
  "README.md",
  "logo.png",
  "chrome_100_percent.pak",
  "mystery.zzz",
  "没有扩展名",
];
for (const name of names) {
  assert.equal(resolveFileIcon(name).icon, "document", `${name} 应使用默认文件图标`);
  assert.equal(resolveFileIcon(name, { isFolder: true }).icon, "folder", `${name}（文件夹）应使用默认文件夹图标`);
}

// 4) 旧的主题参数不能改变结果（老代码 / 老设置里还传着 theme）
for (const theme of ["material", "mono", "block", "seti", "outline", undefined]) {
  const view = resolveFileIcon("app.ts", { theme });
  assert.deepEqual(view, DOC, `主题参数 ${theme} 不该再影响图标`);
}

// 5) 图形必须能被主题染色：写死颜色的图形在深色主题下会看不清
for (const view of [FOLDER, DOC]) {
  assert.ok(view.body.includes('fill="currentColor"'), `${view.icon} 的图形要用 currentColor，不能写死颜色`);
  assert.match(view.viewBox, /^0 0 24 24$/, `${view.icon} 的 viewBox 应是 24 网格，实际 ${view.viewBox}`);
}

// 6) Material 那套东西必须真的删干净（别再被 import 回来）
const root = path.resolve(import.meta.dirname, "../..");
const removed = ["packages/ui/src/shared/material-file-icons.ts", "scripts/build-material-file-icons.mjs"];
for (const file of removed) {
  const exists = await readFile(path.join(root, file), "utf8").then(
    () => true,
    () => false,
  );
  assert.equal(exists, false, `${file} 应该已经删除（现在只用默认图标）`);
}
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert.equal("icons:file" in pkg.scripts, false, "package.json 里不该再有 icons:file 脚本");

console.log("file-icons OK 只有默认图形（文件夹 / 文件）/ 不区分类型 / 主题参数无效 / Material 已删净");
