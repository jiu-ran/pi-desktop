import assert from "node:assert/strict";
import {
  FILE_ICON_SAMPLES,
  FILE_ICON_THEMES,
  badgeFamily,
  badgeText,
  contrastInk,
  fileExtension,
  fileIconEntry,
  folderStyle,
  resolveFileIcon,
} from "../../packages/ui/src/shared/file-icons.ts";
import { setiIcons } from "../../packages/ui/src/shared/seti-icons.ts";

/**
 * 文件类型图标（Seti UI 版本）。
 *
 * 这里有三个容易坏的地方：
 * 1. **类型认错**：特殊文件名要压过扩展名、点开头的文件没有扩展名、多级扩展名取最后一段；
 * 2. **图标名拼错**：引用一个 seti-icons 里不存在的名字，界面上就是一个空洞；
 * 3. **主题算错**：填充主题的黑白字要按对比度选，浅色品牌色上配白字会糊。
 */

// ---- 1. 扩展名与文件名 ----
assert.equal(fileExtension("src/app.ts"), "ts");
assert.equal(fileExtension("C:\\proj\\a.TSX"), "tsx", "扩展名统一小写");
assert.equal(fileExtension("a.d.ts"), "ts", "取最后一段扩展名");
assert.equal(fileExtension("README"), "", "没有扩展名");
assert.equal(fileExtension(".gitignore"), "", "点开头的不是扩展名");
assert.equal(fileExtension("a."), "");
assert.equal(fileExtension(""), "");

// ---- 2. 常见类型归属（Seti 图标名） ----
const setiOf = (name: string, options?: { isFolder?: boolean }) => fileIconEntry(name, options)[0];
assert.equal(setiOf("x", { isFolder: true }), "folder");
assert.equal(setiOf("main.ts"), "typescript");
assert.equal(setiOf("App.vue"), "vue");
assert.equal(setiOf("styles.css"), "css");
assert.equal(setiOf("styles.scss"), "sass");
assert.equal(setiOf("run.sh"), "shell");
assert.equal(setiOf("data.json"), "json");
assert.equal(setiOf("vite.config.ts"), "vite", "已知工具的配置文件名优先");
assert.equal(setiOf("jest.config.ts"), "typescript", "没登记过的 `.config.ts` 仍按扩展名认");
assert.equal(setiOf("tsconfig.json"), "tsconfig", "特殊文件名优先于扩展名");
assert.equal(setiOf("package.json"), "npm");
assert.equal(setiOf("package-lock.json"), "npm");
assert.equal(setiOf("yarn.lock"), "yarn");
assert.equal(setiOf("README.md"), "markdown");
assert.equal(setiOf("LICENSE"), "license");
assert.equal(setiOf("logo.png"), "image");
assert.equal(setiOf("clip.mp4"), "video");
assert.equal(setiOf("song.flac"), "audio");
assert.equal(setiOf("bundle.tar.gz"), "zip");
assert.equal(setiOf("paper.pdf"), "pdf");
assert.equal(setiOf("report.xlsx"), "xls");
assert.equal(setiOf("font.woff2"), "font");
assert.equal(setiOf("app.exe"), "windows");
assert.equal(setiOf("tool.dll"), "windows");
assert.equal(setiOf("mystery.zzz"), "unknown", "认不出来的扩展名走徽标兜底（不是空白纸页）");
assert.equal(setiOf("no-extension"), "unknown");
assert.equal(setiOf(""), "unknown", "空名字不能崩");

// ---- 3. 特殊文件名 / 点开头 / 大小写 ----
assert.equal(setiOf("Dockerfile"), "docker");
assert.equal(setiOf(".gitignore"), "git_ignore");
assert.equal(setiOf(".env"), "config");
assert.equal(setiOf(".env.local"), "config", "`.env.local` 要沿前缀回退到 `.env`");
assert.equal(setiOf("Makefile"), "makefile");
assert.equal(setiOf("uv.lock"), "lock");
assert.equal(setiOf("AGENTS.md"), "markdown");
assert.equal(setiOf("Cargo.toml"), "rust", "大小写不敏感");
assert.equal(setiOf("/abs/path/src/index.ts"), "typescript", "带目录的完整路径也能认");

// ---- 3b. Seti 缺失的类型用徽标兜底，永远有东西可看 ----
// 常见但 Seti 没有的扩展名，全部走徽标
for (const [name, badge] of [
  ["a.txt", "TXT"],
  ["a.log", "LOG"],
  ["a.bib", "BIB"],
  ["a.rst", "RST"],
  ["a.org", "ORG"],
  ["a.xyz", "XYZ"],
  ["Procfile", "PRO"],
  ["mystery.zzz", "ZZZ"],
] as const) {
  const view = resolveFileIcon(name);
  assert.equal(view.ink, "badge", `${name} 应该走徽标兜底`);
  assert.equal(view.badge, badge, `${name} 的徽标文字应为 ${badge}`);
  assert.ok(view.badge.length >= 2 && view.badge.length <= 4, `${name} 徽标长度异常：${view.badge}`);
  assert.match(view.color, /^#[0-9a-f]{6}$/, `${name} 徽标要有配色`);
}
// 有 Seti 图形的仍然画图形
for (const name of ["a.ts", "a.png", "README.md", "package.json", "a.avro", "a.apk", "deck.pptx"]) {
  assert.equal(resolveFileIcon(name).ink, "glyph", `${name} 应该画 Seti 图形`);
}
// 徽标配色按大类走
assert.equal(badgeFamily("a.txt"), "doc");
assert.equal(badgeFamily("a.png"), "media");
assert.equal(badgeFamily("a.mp4"), "video");
assert.equal(badgeFamily("a.zzz"), "default");
assert.equal(badgeText("a.HEIC"), "HEIC");

// ---- 3c. 文件夹：按名字区分形状与配色 ----
assert.equal(folderStyle("src").color, "#4f8fb3", "src 用源码色");
assert.equal(folderStyle("tests").color, "#3f9070", "test 用测试色");
assert.equal(folderStyle("dist").color, "#b98a4d", "dist 用产物色");
assert.equal(folderStyle(".git").seti, "git_folder", ".git 换成 Git 文件夹图形");
assert.equal(folderStyle("node_modules").seti, "npm", "node_modules 用 npm 图形");
assert.equal(folderStyle("random-folder").seti, "folder", "普通文件夹保持 Seti 文件夹形状");
assert.equal(folderStyle("random-folder").color, "#7f8ca6");
const srcFolder = resolveFileIcon("src", { isFolder: true });
assert.equal(srcFolder.isFolder, true);
assert.equal(srcFolder.color, "#4f8fb3", "文件夹的最终颜色来自用途配色");
assert.equal(srcFolder.ink, "glyph");

// ---- 4. 引用的图标名必须都在 seti-icons 里 ----
// 直接从源码里扫一遍：以后加类型写了不存在的名字，这里立刻报
import { readFileSync } from "node:fs";
import path from "node:path";
const tableSource = readFileSync(
  path.resolve(import.meta.dirname, "../../packages/ui/src/shared/file-icons.ts"),
  "utf8",
);
const referenced = new Set<string>();
for (const match of tableSource.matchAll(/\[\s*"([a-z0-9_-]+)",\s*"[^"]*"\s*\]/gi)) referenced.add(match[1]!);
referenced.add("default");
assert.ok(referenced.size > 50, `扫到的图标名太少（${referenced.size}），说明匹配规则失效了`);
// `unknown` 是「走徽标兜底」的哨兵值，必须**不存在**于 seti-icons 里（否则又变回空白纸页）
assert.equal(setiIcons.unknown, undefined, "unknown 不能被真的定义成图标");
const unknown = [...referenced].filter((name) => name !== "unknown" && !setiIcons[name]);
assert.deepEqual(unknown, [], `这些图标名在 seti-icons.ts 里不存在：${unknown.join(", ")}`);

// ---- 5. 每个 Seti 图标都要有颜色和路径 ----
for (const [name, icon] of Object.entries(setiIcons)) {
  assert.match(icon.color, /^#[0-9a-f]{6}$/, `${name} 的颜色格式异常：${icon.color}`);
  assert.ok(icon.body.includes("<path") || icon.body.includes("<circle"), `${name} 没有图形`);
  assert.equal(/fill="#/.test(icon.body), false, `${name} 里还有写死的 fill，主题改不了色`);
  assert.ok(icon.body.includes('fill="currentColor"'), `${name} 应该用 currentColor 上色`);
}

// ---- 6. 三套主题 ----
const themes = FILE_ICON_THEMES.map((item) => item.id);
assert.deepEqual(themes, ["seti", "mono", "block"], "主题顺序：Seti / 单色 / 填充");
for (const theme of themes) {
  for (const sample of FILE_ICON_SAMPLES) {
    const view = resolveFileIcon(sample, { theme });
    assert.equal(view.theme, theme);
    assert.ok(view.body.length > 20, `${theme} / ${sample} 没有图形`);
    assert.match(view.color, /^#[0-9a-f]{6}$/, `${theme} / ${sample} 品牌色异常：${view.color}`);
    assert.match(view.inkColor, /^(#[0-9a-f]{6}|var\(--fg-2\))$/, `${theme} / ${sample} 墨色异常：${view.inkColor}`);
    assert.ok(view.label.length > 0, `${theme} / ${sample} 缺少类型名`);
  }
}
// Seti 主题：图标用品牌原色；单色：跟随正文；填充：按对比度取黑/白
assert.equal(resolveFileIcon("a.ts", { theme: "seti" }).inkColor, resolveFileIcon("a.ts", { theme: "seti" }).color);
assert.equal(resolveFileIcon("a.ts", { theme: "mono" }).inkColor, "var(--fg-2)");
const tsBlock = resolveFileIcon("a.ts", { theme: "block" });
assert.equal(tsBlock.inkColor, contrastInk(tsBlock.color));
assert.equal(contrastInk("#000000"), "#ffffff");
assert.equal(contrastInk("#ffffff"), "#12141a");
assert.equal(contrastInk("#fff"), "#12141a", "三位简写也要能算");
assert.equal(contrastInk("bad-color"), "#ffffff", "非法颜色退回白字");

// ---- 7. 文件夹 ----
const folder = resolveFileIcon("src", { isFolder: true });
assert.equal(folder.seti, "folder");
assert.equal(folder.isFolder, true);
assert.equal(folder.label, "源码", "src 文件夹带用途名称");
assert.ok(folder.body.includes("currentColor"));
const plainFolder = resolveFileIcon("whatever", { isFolder: true });
assert.equal(plainFolder.label, "文件夹");
assert.equal(plainFolder.ink, "glyph");

// ---- 8. 预览样例要覆盖多种类型 ----
const sampleSeti = new Set(FILE_ICON_SAMPLES.map((sample) => resolveFileIcon(sample).seti));
assert.ok(sampleSeti.size >= 5, `预览样例的类型要有区分度，实际 ${[...sampleSeti].join(", ")}`);

// ---- 9. 常用语言都有各自的图标（不要全退化成 default） ----
for (const [ext, seti] of Object.entries({
  ts: "typescript",
  js: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  cs: "c-sharp",
  cpp: "cpp",
  md: "markdown",
  json: "json",
  yml: "yml",
  css: "css",
  html: "html",
  sh: "shell",
  vue: "vue",
  kt: "kotlin",
  swift: "swift",
})) {
  assert.equal(setiOf(`file.${ext}`), seti, `${ext} 应该用 ${seti} 图标`);
}

console.log(
  `file-icons OK Seti ${Object.keys(setiIcons).length} 个图标 / 类型识别 / 三主题配色 / 文件夹 / 预览样例`,
);
