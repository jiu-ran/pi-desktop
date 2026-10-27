import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FILE_ICON_SAMPLES,
  FILE_ICON_THEMES,
  contrastInk,
  fileExtension,
  fileIconName,
  resolveFileIcon,
} from "../../packages/ui/src/shared/file-icons.ts";
import {
  DEFAULT_ICON,
  EXT,
  FOLDER,
  NAME,
  materialFileIcons,
} from "../../packages/ui/src/shared/material-file-icons.ts";

/**
 * 文件类型图标（Material Icon Theme 版）。
 *
 * 三个容易坏的地方：
 * 1. **类型认错**：特殊文件名要压过扩展名、点开头的文件没有扩展名、多级扩展名取最后一段；
 * 2. **图标名掉空**：映射表里写了 materialFileIcons 里没有的名字（生成脚本没内联到），
 *    界面上就是一个洞；
 * 3. **主题算错**：填充主题的黑白字要按对比度选；单色 / 填充必须用 `mono` 那份路径，
 *    否则多色图标在单色主题下还是花的。
 */

// ---- 1. 扩展名与文件名 ----
assert.equal(fileExtension("src/app.ts"), "ts");
assert.equal(fileExtension("C:\\proj\\a.TSX"), "tsx", "扩展名统一小写");
assert.equal(fileExtension("a.d.ts"), "ts", "取最后一段扩展名");
assert.equal(fileExtension("README"), "", "没有扩展名");
assert.equal(fileExtension(".gitignore"), "", "点开头的不是扩展名");
assert.equal(fileExtension("a."), "");
assert.equal(fileExtension(""), "");

// ---- 2. 认类型（Material 图标名） ----
const iconOf = (name: string, options?: { isFolder?: boolean }) => fileIconName(name, options);
assert.equal(iconOf("main.ts"), "typescript");
assert.equal(iconOf("App.vue"), "vue");
assert.equal(iconOf("styles.css"), "css");
assert.equal(iconOf("styles.scss"), "sass");
assert.equal(iconOf("run.sh"), "console");
assert.equal(iconOf("data.json"), "json");
assert.equal(iconOf("vite.config.ts"), "vite", "已知工具的配置文件名优先");
assert.equal(iconOf("jest.config.ts"), "typescript", "没登记过的 .config.ts 仍按扩展名认");
assert.equal(iconOf("tsconfig.json"), "tsconfig", "特殊文件名优先于扩展名");
assert.equal(iconOf("package.json"), "nodejs");
assert.equal(iconOf("yarn.lock"), "yarn");
assert.equal(iconOf("README.md"), "readme", "README 有专属图标");
assert.equal(iconOf("LICENSE"), "license");
assert.equal(iconOf("logo.png"), "image");
assert.equal(iconOf("clip.mp4"), "video");
assert.equal(iconOf("song.flac"), "audio");
assert.equal(iconOf("bundle.tar.gz"), "zip");
assert.equal(iconOf("paper.pdf"), "pdf");
assert.equal(iconOf("report.xlsx"), "table", "xlsx 用表格图标");
assert.equal(iconOf("font.woff2"), "font");
assert.equal(iconOf("app.exe"), "exe");
assert.equal(iconOf("tool.dll"), "dll");
assert.equal(iconOf("app.wasm"), "webassembly");
assert.equal(iconOf("mystery.zzz"), null, "认不出来的交给默认样式");
assert.equal(iconOf("no-extension"), null);
assert.equal(iconOf(""), null, "空名字不能崩");

// ---- 3. 特殊文件名 / 点开头 / 大小写 ----
assert.equal(iconOf("Dockerfile"), "docker");
assert.equal(iconOf(".gitignore"), "git");
assert.equal(iconOf(".env"), "settings");
assert.equal(iconOf(".env.local"), "tune", "`.env.local` 在 Material 里有自己的图标");
assert.equal(iconOf("Makefile"), "makefile");
assert.equal(iconOf("uv.lock"), "uv", "uv 有自己的锁文件图标");
assert.equal(iconOf("AGENTS.md"), "agent", "AGENTS.md 用 agent 图标");
assert.equal(iconOf("Cargo.toml"), "rust", "大小写不敏感");
assert.equal(iconOf("/abs/path/src/index.ts"), "typescript", "带目录的完整路径也能认");

// ---- 4. 映射表与图标必须自洽 ----
// 表里出现、但没内联的图标 = 界面上的空洞
const tables = { EXT, NAME, FOLDER };
for (const [label, table] of Object.entries(tables)) {
  const missing = Object.values(table).filter((icon) => !materialFileIcons[icon]);
  assert.deepEqual(missing, [], `${label} 里这些图标没有内联进来：${missing.join(", ")}`);
  assert.ok(Object.keys(table).length > 20, `${label} 映射表太小（${Object.keys(table).length}），生成脚本可能没生效`);
}
assert.ok(materialFileIcons[DEFAULT_ICON], "兜底图标必须存在");
for (const [name, icon] of Object.entries(materialFileIcons)) {
  assert.match(icon.color, /^#[0-9a-f]{6}$/, `${name} 的主色格式异常：${icon.color}`);
  // 上游网格不统一（16 / 24 / 32 / 256…），viewBox 必须逐图标记录，否则 16px 下会裁切或缩成一角
  assert.match(icon.viewBox, /^-?[0-9.]+ -?[0-9.]+ [0-9.]+ [0-9.]+$/, `${name} 的 viewBox 异常：${icon.viewBox}`);
  assert.ok(icon.body.length > 20, `${name} 没有图形`);
  assert.ok(icon.mono.includes('fill="currentColor"') || !icon.mono.includes("fill="), `${name} 的 mono 版本没换成 currentColor`);
  assert.equal(/fill="#/.test(icon.mono), false, `${name} 的 mono 版本还留着写死的颜色`);
}

// ---- 5. 三套主题 ----
assert.deepEqual(FILE_ICON_THEMES.map((item) => item.id), ["material", "mono", "block"]);
for (const theme of FILE_ICON_THEMES.map((item) => item.id)) {
  for (const sample of FILE_ICON_SAMPLES) {
    const view = resolveFileIcon(sample, { theme });
    assert.equal(view.theme, theme);
    assert.ok(view.body.length > 20, `${theme} / ${sample} 没有图形`);
    assert.match(view.color, /^#[0-9a-f]{6}$/, `${theme} / ${sample} 主色异常：${view.color}`);
    assert.match(view.inkColor, /^(#[0-9a-f]{6}|var\(--fg-2\))$/, `${theme} / ${sample} 墨色异常：${view.inkColor}`);
    assert.ok(view.label.length > 0);
  }
}
// Material 主题保留原色（可能多色），单色/填充用 mono 版本
const tsMaterial = resolveFileIcon("a.ts", { theme: "material" });
const tsMono = resolveFileIcon("a.ts", { theme: "mono" });
const tsBlock = resolveFileIcon("a.ts", { theme: "block" });
assert.equal(tsMaterial.body, materialFileIcons.typescript!.body);
assert.equal(tsMono.body, materialFileIcons.typescript!.mono, "单色主题必须用 mono 版本");
assert.equal(tsBlock.body, materialFileIcons.typescript!.mono, "填充主题必须用 mono 版本");
assert.equal(tsMono.inkColor, "var(--fg-2)");
assert.equal(tsBlock.inkColor, contrastInk(tsBlock.color));
assert.equal(contrastInk("#000000"), "#ffffff");
assert.equal(contrastInk("#ffffff"), "#12141a");
assert.equal(contrastInk("#fff"), "#12141a", "三位简写也要能算");
assert.equal(contrastInk("bad-color"), "#ffffff", "非法颜色退回白字");

// ---- 6. 文件夹：按名字换图标 ----
assert.equal(iconOf("src", { isFolder: true }), "folder-src");
assert.equal(iconOf("tests", { isFolder: true }), "folder-test");
assert.equal(iconOf("dist", { isFolder: true }), "folder-dist");
assert.equal(iconOf("node_modules", { isFolder: true }), "folder-node");
assert.equal(iconOf(".git", { isFolder: true }), "folder-git");
assert.equal(iconOf("whatever-folder", { isFolder: true }), "folder", "普通文件夹用默认文件夹图标");
const folderView = resolveFileIcon("src", { isFolder: true });
assert.equal(folderView.isFolder, true);
assert.ok(folderView.body.length > 20, "文件夹要有图形");

// ---- 7. 没有专属图标 → 默认样式（不造徽标） ----
for (const name of ["a.org", "a.haxe", "a.avro", "Procfile", "mystery.zzz", "", "no-extension"]) {
  const view = resolveFileIcon(name);
  assert.equal(view.icon, "document", `${name} 应退回默认文件图标`);
  assert.equal(view.label, "文件", `${name} 的默认类型名是「文件」`);
  assert.equal(view.isFolder, false);
  assert.ok(view.body.length > 20, `${name} 的默认图标要有图形`);
}
// 认不出来的文件夹也用默认文件夹图标
const unknownFolder = resolveFileIcon("whatever-folder", { isFolder: true });
assert.equal(unknownFolder.icon, "folder");

// ---- 8. 常用语言都有专属图标（不要全退化成 document） ----
for (const [ext, icon] of Object.entries({
  ts: "typescript",
  js: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  cpp: "cpp",
  md: "markdown",
  json: "json",
  yml: "yaml",
  css: "css",
  html: "html",
  sh: "console",
  vue: "vue",
  kt: "kotlin",
  swift: "swift",
})) {
  assert.equal(iconOf(`file.${ext}`), icon, `${ext} 应该用 ${icon} 图标`);
}

// ---- 9. 生成物与脚本对得上（脚本被改过但没重跑时提醒） ----
const generated = readFileSync(
  path.resolve(import.meta.dirname, "../../packages/ui/src/shared/material-file-icons.ts"),
  "utf8",
);
assert.ok(generated.includes("scripts/build-material-file-icons.mjs"), "生成物要写明来源脚本");

console.log(
  `file-icons OK Material ${Object.keys(materialFileIcons).length} 个图标 / ${Object.keys(EXT).length} 扩展名 / ` +
    `${Object.keys(NAME).length} 文件名 / ${Object.keys(FOLDER).length} 文件夹 / 三主题 / 默认样式兜底`,
);
