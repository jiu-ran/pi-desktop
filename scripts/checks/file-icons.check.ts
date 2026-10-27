import assert from "node:assert/strict";
import {
  FILE_ICON_SAMPLES,
  FILE_ICON_THEMES,
  contrastInk,
  fileExtension,
  fileIconStyle,
  resolveFileIcon,
} from "../../packages/ui/src/shared/file-icons.ts";
import { fileGlyphs } from "../../packages/ui/src/shared/file-glyphs.ts";

/**
 * 文件类型图标：文件名 → 类型 → 三种主题画法。
 *
 * 最容易出问题的是「认错类型」和「主题缺料」：
 * 特殊文件名要压过扩展名、点开头的文件没有扩展名、多级扩展名取最后一段；
 * 每种类型在每种主题下都必须有字母或图形（缺了就是界面上的一个透明洞，很难发现），
 * 填充主题的黑白字必须按对比度选，否则浅色品牌色上一片糊。
 */

// ---- 1. 扩展名与文件名 ----
assert.equal(fileExtension("src/app.ts"), "ts");
assert.equal(fileExtension("C:\\proj\\a.TSX"), "tsx", "扩展名统一小写");
assert.equal(fileExtension("a.d.ts"), "ts", "取最后一段扩展名");
assert.equal(fileExtension("README"), "", "没有扩展名");
assert.equal(fileExtension(".gitignore"), "", "点开头的不是扩展名");
assert.equal(fileExtension("a."), "");
assert.equal(fileExtension(""), "");

// ---- 2. 常见类型归属 ----
const kindOf = (name: string, options?: { isFolder?: boolean; open?: boolean }) =>
  fileIconStyle(name, options).kind;
assert.equal(kindOf("x", { isFolder: true }), "folder");
assert.equal(kindOf("x", { isFolder: true, open: true }), "folderOpen");
assert.equal(kindOf("main.ts"), "source");
assert.equal(kindOf("App.vue"), "web");
assert.equal(kindOf("styles.css"), "web");
assert.equal(kindOf("run.sh"), "shell");
assert.equal(kindOf("data.json"), "json");
assert.equal(kindOf("vite.config.ts"), "source", "`.config.ts` 仍然是 TS");
assert.equal(kindOf("tsconfig.json"), "config", "特殊文件名优先于扩展名");
assert.equal(kindOf("package-lock.json"), "lock");
assert.equal(kindOf("README.md"), "markdown");
assert.equal(kindOf("LICENSE"), "text");
assert.equal(kindOf("logo.png"), "image");
assert.equal(kindOf("clip.mp4"), "video");
assert.equal(kindOf("song.flac"), "audio");
assert.equal(kindOf("bundle.tar.gz"), "archive");
assert.equal(kindOf("paper.pdf"), "pdf");
assert.equal(kindOf("report.xlsx"), "sheet");
assert.equal(kindOf("font.woff2"), "font");
assert.equal(kindOf("app.exe"), "binary");
assert.equal(kindOf("mystery.zzz"), "file", "认不出来的扩展名要退回普通文件");
assert.equal(kindOf("no-extension"), "file");
assert.equal(kindOf(""), "file", "空名字不能崩");

// ---- 3. 特殊文件名 / 点开头 / 大小写 ----
assert.equal(kindOf("Dockerfile"), "config");
assert.equal(kindOf(".gitignore"), "config");
assert.equal(kindOf(".env"), "config");
assert.equal(kindOf(".env.local"), "config", "`.env.local` 要沿前缀回退到 `.env`");
assert.equal(kindOf("Makefile"), "shell");
assert.equal(kindOf("uv.lock"), "lock");
assert.equal(kindOf("AGENTS.md"), "markdown");
assert.equal(kindOf("app.IPYNB"), "source", "扩展名大小写不敏感");
assert.equal(kindOf("/abs/path/src/index.ts"), "source", "带目录的完整路径也能认");

// ---- 4. 三套主题：都有画法，颜色规则正确 ----
for (const theme of FILE_ICON_THEMES.map((item) => item.id)) {
  for (const sample of FILE_ICON_SAMPLES) {
    const view = resolveFileIcon(sample, { theme });
    assert.equal(view.theme, theme);
    assert.ok(view.glyph.includes("<svg"), `${theme} / ${sample} 要有可用字形`);
    assert.ok(view.ink === "letters" ? view.letters.length >= 1 : view.glyph.length > 0);
    assert.match(view.color, /^#[0-9a-f]{6}$/, `${theme} / ${sample} 品牌色格式异常：${view.color}`);
    assert.match(view.inkColor, /^(#[0-9a-f]{6}|var\(--fg-2\))$/, `${theme} / ${sample} 墨色异常：${view.inkColor}`);
  }
  // 文件夹也要能画
  const folder = resolveFileIcon("src", { theme, isFolder: true });
  assert.ok(folder.glyph.includes("<svg"), `${theme} 文件夹要有字形`);
}

// 填充主题：墨色随品牌色深浅变；描边/裸字形：墨色=品牌色
assert.equal(resolveFileIcon("a.ts", { theme: "solid" }).inkColor, "#ffffff", "深蓝品牌色上用白字");
assert.equal(resolveFileIcon("a.js", { theme: "solid" }).inkColor, "#12141a", "亮黄品牌色上用黑字");
assert.equal(contrastInk("#000000"), "#ffffff");
assert.equal(contrastInk("#ffffff"), "#12141a");
assert.equal(contrastInk("bad-color"), "#ffffff", "非法颜色退回白字");
for (const name of ["a.ts", "a.png", "package.json"]) {
  const brand = resolveFileIcon(name, { theme: "outline" });
  assert.equal(brand.inkColor, brand.color, `描边主题墨色应是品牌色：${name}`);
  assert.equal(resolveFileIcon(name, { theme: "tint" }).inkColor, brand.color);
}

// ---- 5. 字母 vs 图形：代码类给字母，媒体/文档类给图形 ----
const inkOf = (name: string) => resolveFileIcon(name).ink;
assert.equal(inkOf("a.ts"), "letters");
assert.equal(inkOf("a.py"), "letters");
assert.equal(inkOf("a.css"), "letters", "CSS 用 # 号，和 VS Code 一致");
assert.equal(inkOf("a.html"), "letters", "HTML 用尖括号");
assert.equal(inkOf("a.json"), "letters", "JSON 用 {}");
assert.equal(inkOf("a.sh"), "letters", "Shell 用 >_");
assert.equal(inkOf("a.md"), "letters", "Markdown 用 M↓");
assert.equal(inkOf("a.png"), "glyph", "图片给图形而不是 IMG 字母");
assert.equal(inkOf("Main.java"), "glyph", "Java 用咖啡杯图形（四个字母在 16px 下糊）");
assert.ok(fileGlyphs.cup, "要有一个杯子字形给 Java 用");
assert.equal(inkOf("a.tar.gz"), "glyph");
assert.equal(inkOf("a.mp4"), "glyph");
assert.equal(inkOf("LICENSE"), "glyph");

// ---- 6. 图形都在字形表里（拼错键名会退化成空白） ----
for (const key of Object.keys(fileGlyphs)) {
  assert.ok(fileGlyphs[key]!.includes("<svg"), `字形 ${key} 不是合法 SVG`);
  assert.ok(fileGlyphs[key]!.includes("currentColor"), `字形 ${key} 必须用 currentColor，否则主题换不了色`);
  if (key !== "folder" && key !== "folderOpen") {
    assert.equal(fileGlyphs[key]!.includes("fx-fill"), false, `字形 ${key} 的 fx-fill 只该给文件夹`);
  }
}
assert.ok(Object.keys(fileGlyphs).length >= 15, "字形数量太少，说明有键名退化了");

// ---- 7. 常见语言都有专属字母（别都退回 SRC） ----
for (const [ext, letters] of Object.entries({
  ts: "TS",
  js: "JS",
  py: "PY",
  go: "GO",
  rs: "RS",
  rb: "RB",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  md: "M↓",
  json: "{}",
  yml: "YML",
  css: "#",
  html: "<>",
  sh: ">_",
  vue: "VUE",
})) {
  assert.equal(resolveFileIcon(`file.${ext}`).letters, letters, `${ext} 的字母应为 ${letters}`);
}

// ---- 8. 文件夹开合只差字形，颜色一致 ----
const closed = resolveFileIcon("src", { isFolder: true });
const opened = resolveFileIcon("src", { isFolder: true, open: true });
assert.equal(closed.kind, "folder");
assert.equal(opened.kind, "folderOpen");
assert.equal(closed.color, opened.color, "开合同一颜色，只换字形");
assert.notEqual(closed.glyph, opened.glyph, "开合要用不同字形");

// ---- 9. 预览样例必须覆盖多种类型（设置页的示例行不能全是同一种） ----
const sampleKinds = new Set(FILE_ICON_SAMPLES.map((sample) => resolveFileIcon(sample).kind));
assert.ok(sampleKinds.size >= 5, `预览样例的类型要有区分度，实际 ${[...sampleKinds].join(", ")}`);

// 文件夹的实心面靠 fx-fill 类切主题，标记丢了就变成「描边主题里也有实心块」
assert.ok(fileGlyphs.folder!.includes('class="fx-fill"'), "文件夹要有 fx-fill 实心面");
assert.ok(fileGlyphs.folderOpen!.includes('class="fx-fill"'), "打开的文件夹也要有 fx-fill");

console.log("file-icons OK 类型识别 / 特殊文件名 / 三主题墨色 / 字母与图形 / 文件夹开合 / 语言缩写");
