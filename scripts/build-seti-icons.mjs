import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从 Seti UI（https://github.com/jesseweed/seti-ui，MIT）生成
 * `packages/ui/src/shared/seti-icons.ts`。
 *
 * 只内联用到的图标：Seti 一共 169 个，直接打包会让仓库多出 200KB 无用资源；
 * 这里按 `MAP` 里实际引用到的名字抽取，每个图标保留「路径 + 原色」。
 *
 * 用法（需要一份 seti-ui 源码）：
 *   node scripts/build-seti-icons.mjs <seti-ui 目录>
 *
 * 生成物是提交进仓库的：离线构建、不需要联网，也不需要运行时依赖。
 * 图标里写死的品牌色替换成 `currentColor`，颜色由主题决定（见 shared/file-icons.ts）。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "packages", "ui", "src", "shared", "seti-icons.ts");
const source = process.argv[2];

/**
 * 我们要用的 Seti 图标名（文件名去掉 .svg）。
 *
 * 名字沿用 Seti 自己的命名，方便日后对照上游更新；缺的类型在 `file-icons.ts`
 * 里回退到 `default`，所以这个列表只列「确实存在」的图标。
 */
const NAMES = [
  // 语言
  "typescript", "javascript", "vue", "svelte", "react", "html", "css", "sass", "less", "stylus",
  "python", "notebook", "java", "kotlin", "c-sharp", "c", "cpp", "go", "rust", "ruby",
  "php", "swift", "scala", "lua", "dart", "zig", "elixir", "haskell", "clojure", "julia",
  "R", "perl", "asm", "cu", "nim", "crystal", "elm", "haxe", "vala", "powershell", "shell",
  // 配置 / 数据
  "json", "yml", "xml", "config", "settings", "editorconfig", "eslint", "stylelint",
  "tsconfig", "graphql", "prisma", "terraform", "docker", "makefile", "gradle", "maven",
  "vite", "webpack", "rollup", "babel", "grunt", "gulp", "karma", "firebase", "bower",
  "npm", "yarn", "lock", "git", "git_ignore", "git_folder",
  // 文档 / 媒体 / 容器
  "markdown", "license", "tex", "csv", "xls", "word", "pdf", "db",
  "image", "photoshop", "illustrator", "svg", "favicon", "video", "audio", "font",
  "zip", "wasm", "windows", "folder", "default",
];

if (!source || !existsSync(source)) {
  console.error("用法: node scripts/build-seti-icons.mjs <seti-ui 目录>");
  process.exit(1);
}

const iconsDir = path.join(source, "icons");

/**
 * 品牌色归一化：#fff → #ffffff；纯白/近白（Seti 里少数图标是白字版）退回中性灰，
 * 否则在浅色主题的文件树上一片看不见。
 */
function normalizeColor(raw) {
  const hex = String(raw ?? "").replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#8b929e";
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16));
  return luminance > 0.82 ? "#8b929e" : `#${full.toLowerCase()}`;
}
const entries = [];
const missing = [];

for (const name of NAMES) {
  const file = path.join(iconsDir, `${name}.svg`);
  if (!existsSync(file)) {
    missing.push(name);
    continue;
  }
  const svg = readFileSync(file, "utf8");
  const color = normalizeColor(/fill="(#[0-9a-fA-F]{3,8})"/.exec(svg)?.[1]);
  // 去掉写死的品牌色（改由主题注入），整组套一层 fill="currentColor"：
  // 有些 Seti 图标自己就没有 fill 属性，只改属性会漏掉它们，渲染成默认黑。
  const body = `<g fill="currentColor">${svg
    .slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
    .replace(/\sfill="#[0-9a-fA-F]{3,8}"/g, "")
    .replace(/\s+/g, " ")
    .trim()}</g>`;
  if (!body.includes("<path") && !body.includes("<circle")) {
    missing.push(`${name}（无路径）`);
    continue;
  }
  entries.push({ name, color: color.toLowerCase(), body });
}

if (missing.length) {
  console.error(`这些图标在 ${iconsDir} 里没有：${missing.join(", ")}`);
  process.exit(1);
}

const lines = entries.map(({ name, color, body }) => `  ${JSON.stringify(name)}: { color: "${color}", body: ${JSON.stringify(body)} },`);
const out = `/**
 * Seti UI 文件图标（内联，MIT）。
 *
 * 来源：https://github.com/jesseweed/seti-ui（commit 2d6c5e6），
 * 由 \`scripts/build-seti-icons.mjs\` 生成 —— 不要手改，改脚本再跑。
 *
 * - 只包含真正用到的 ${entries.length} 个图标；
 * - \`color\` 是 Seti 原始品牌色（用于「Seti」主题和填充主题的底色）；
 * - \`body\` 里的 fill 已改成 \`currentColor\`，颜色由主题注入。
 */
export interface SetiIcon {
  color: string;
  body: string;
}

export const setiIcons: Record<string, SetiIcon> = {
${lines.join("\n")}
};
`;

writeFileSync(target, out);
console.log(`seti-icons: ${entries.length} 个 → ${path.relative(root, target)}`);
