import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从 Material Icon Theme（https://github.com/PKief/vscode-material-icon-theme，MIT）
 * 生成 `packages/ui/src/shared/material-file-icons.ts`。
 *
 * 为什么从上游生成、而不是手写映射：这个项目自带一张两千多条的
 * 「扩展名 / 文件名 / 文件夹名 → 图标」表（`src/core/icons/*.ts`），手抄必然漏项，
 * 上游一更新也跟不上。这里直接读它的表，只挑我们用到的键，再把用到的图标内联 ——
 * 运行时零依赖、离线可用。
 *
 * 用法：
 *   node scripts/build-material-file-icons.mjs <material-icon-theme 目录>
 *
 * 每个图标存两份路径：
 * - `body`：保留 Material 自己的配色（默认主题直接用）；
 * - `mono`：把 fill 换成 currentColor（单色 / 填充主题用）。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "packages", "ui", "src", "shared", "material-file-icons.ts");
const repo = process.argv[2];

if (!repo || !existsSync(repo)) {
  console.error("用法: node scripts/build-material-file-icons.mjs <material-icon-theme 目录>");
  process.exit(1);
}

/** 我们要支持的扩展名（小写）。上游没有的会自动跳过并列出来。 */
const EXTENSIONS = `ts tsx mts cts js jsx mjs cjs vue svelte astro html htm xhtml css scss sass less styl
py pyi pyw ipynb java kt kts cs c h cpp cxx cc hpp hxx go rs rb php swift m mm scala sc lua dart zig
ex exs erl hs clj cljs r jl nim cr elm haxe vala cu pl pm asm s sol proto groovy ml mli fs fsx vb
sh bash zsh fish ksh ps1 psm1 bat cmd
yml yaml toml ini cfg conf env properties xml json jsonc json5 jsonl ndjson graphql gql prisma tf tfvars hcl nix
md mdx markdown rst org bib adoc asciidoc tex txt log diff patch
csv tsv xls xlsx xlsm ods numbers parquet avro orc db sqlite sqlite3 sql mdb dbf plist
doc docx dot dotx rtf odt pages key ppt pptx odp pps ppsx epub mobi azw3 pdf
png jpg jpeg gif webp avif bmp ico tiff heic heif eps raw dng cr2 nef psd ai sketch fig svg
mp4 mov webm mkv avi m4v wmv flv mpg mpeg ogv
mp3 wav flac ogg m4a aac opus wma mid midi
woff woff2 ttf otf eot
zip tar gz tgz bz2 xz zst 7z rar jar war ear lz lz4 z cab iso dmg pkg deb rpm apk ipa
exe dll so dylib bin wasm o a obj class pyc pyo node
lock sum`
  .split(/\s+/)
  .filter(Boolean);

/** 我们要支持的特殊文件名（小写）。 */
const FILE_NAMES = `package.json package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml bun.lockb
cargo.toml cargo.lock go.mod go.sum pyproject.toml requirements.txt setup.py poetry.lock uv.lock
tsconfig.json jsconfig.json .babelrc babel.config.js vite.config.ts vite.config.js webpack.config.js
webpack.config.ts rollup.config.js rollup.config.ts gruntfile.js gulpfile.js karma.conf.js
dockerfile docker-compose.yml docker-compose.yaml .dockerignore makefile build.gradle build.gradle.kts
settings.gradle pom.xml package.swift .gitignore .gitattributes .gitmodules .gitkeep .gitconfig
.editorconfig .eslintrc .eslintrc.js .eslintrc.json .eslintrc.cjs eslint.config.js .stylelintrc
.npmrc .bowerrc bower.json firebase.json .firebaserc .env .env.local .env.example
license license.md license.txt changelog.md agents.md readme readme.md`
  .split(/\s+/)
  .filter(Boolean);

/** 我们要支持的文件夹名（小写）。 */
const FOLDERS = `src source app packages lib test tests __tests__ spec specs e2e docs doc documentation
assets static images img media build dist out output target coverage config configs scripts tools bin
vendor migrations utils helpers api core public mock mocks .git github .github .vscode .idea .config
__pycache__ node_modules`
  .split(/\s+/)
  .filter(Boolean);

/**
 * 兜底图标。
 *
 * 上游写的是 `defaultIcon: { name: 'file' }`，但仓库里没有 `icons/file.svg`
 * （VS Code 那边由构建脚本补），这里用同语义的 `document`。
 */
const DEFAULT_ICON = "document";

/**
 * 上游用正则 pattern 定义、或者只按扩展名登记的常见配置文件名，这里直接补齐。
 * 键是文件名（小写），值是上游已有的图标名 —— 不新增图形，只修正「哪个文件算哪种」。
 */
const NAME_OVERRIDES = {
  "cargo.toml": "rust",
  "cargo.lock": "lock",
  "setup.py": "python",
  "npm-shrinkwrap.json": "npm",
  "bun.lockb": "lock",
  ".env": "settings",
  ".env.local": "settings",
  ".env.example": "settings",
  "vite.config.ts": "vite",
  "vite.config.js": "vite",
  "vitest.config.ts": "vite",
  "webpack.config.js": "webpack",
  "webpack.config.ts": "webpack",
  "rollup.config.js": "rollup",
  "rollup.config.ts": "rollup",
  "babel.config.js": "babel",
  ".babelrc": "babel",
  ".eslintrc": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.json": "eslint",
  ".eslintrc.cjs": "eslint",
  "eslint.config.js": "eslint",
  ".stylelintrc": "stylelint",
  ".editorconfig": "editorconfig",
  ".dockerignore": "docker",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "settings.gradle": "gradle",
  "package.swift": "swift",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
};

const iconsDir = path.join(repo, "icons");

/**
 * 解析上游的映射表。
 *
 * 上游那是手写 TypeScript：同一项可能单行、也可能多行，数组里既有字符串也有变量。
 * 用「按 name 切段 + 方括号配对」解析，比整块正则稳（正则会被单行对象和跨行数组坑到）。
 */
function parseIconTable(file, keys) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const src = lines.filter((line) => !line.includes("defaultIcon:")).join("\n");
  const result = new Map();
  const positions = [...src.matchAll(/name:\s*'([^']+)'/g)];
  for (let i = 0; i < positions.length; i += 1) {
    const name = positions[i][1];
    const from = positions[i].index;
    const to = i + 1 < positions.length ? positions[i + 1].index : src.length;
    const segment = src.slice(from, to);
    for (const key of keys) {
      const at = segment.indexOf(`${key}:`);
      if (at < 0) continue;
      const open = segment.indexOf("[", at);
      if (open < 0) continue;
      let depth = 0;
      let close = open;
      for (; close < segment.length; close += 1) {
        if (segment[close] === "[") depth += 1;
        else if (segment[close] === "]") {
          depth -= 1;
          if (!depth) break;
        }
      }
      for (const match of segment.slice(open, close).matchAll(/'([^']+)'/g)) {
        if (!result.has(match[1])) result.set(match[1], name);
      }
    }
  }
  return result;
}

const files = parseIconTable(path.join(repo, "src", "core", "icons", "fileIcons.ts"), [
  "fileExtensions",
  "fileNames",
]);
const folders = parseIconTable(path.join(repo, "src", "core", "icons", "folderIcons.ts"), ["folderNames"]);

/** #fff → #ffffff；近白（上游少数浅色专用图标）退回中性灰，否则浅色主题下看不见 */
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

/** 读一个图标 → { color, body, mono } */
function readIcon(name) {
  const file = path.join(iconsDir, `${name}.svg`);
  if (!existsSync(file)) return null;
  const svg = readFileSync(file, "utf8");
  // 上游图标的网格并不统一（16/24/32/256…），必须按各自的 viewBox 渲染，不能写死 24
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 24 24";
  const inner = svg
    .slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
    .replace(/\s+/g, " ")
    .trim();
  // 主色：优先普通 fill，其次渐变的第一段 stop-color，最后描边色
  const color =
    /fill="(#[0-9a-fA-F]{3,8})"/.exec(inner)?.[1] ??
    /stop-color="(#[0-9a-fA-F]{3,8})"/.exec(inner)?.[1] ??
    /stroke="(#[0-9a-fA-F]{3,8})"/.exec(inner)?.[1] ??
    "#8b929e";
  // mono：把写死的颜色（含渐变引用）全换成 currentColor，并去掉只给渐变用的 defs
  const mono = inner
    .replace(/fill="(#[0-9a-fA-F]{3,8}|url\([^)]*\))"/g, 'fill="currentColor"')
    .replace(/stroke="(#[0-9a-fA-F]{3,8}|url\([^)]*\))"/g, 'stroke="currentColor"')
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .trim();
  return { color: normalizeColor(color), viewBox, body: inner, mono };
}

const extMap = {};
const nameMap = {};
const folderMap = {};
const used = new Set([DEFAULT_ICON]);
const skipped = [];

for (const ext of EXTENSIONS) {
  const icon = files.get(ext);
  if (!icon) skipped.push(`.${ext}`);
  else {
    extMap[ext] = icon;
    used.add(icon);
  }
}
for (const name of FILE_NAMES) {
  const icon = files.get(name) ?? NAME_OVERRIDES[name];
  if (!icon) skipped.push(name);
  else {
    nameMap[name] = icon;
    used.add(icon);
  }
}
for (const name of FOLDERS) {
  const icon = folders.get(name) ?? folders.get(`.${name}`) ?? folders.get(name.replace(/^\./, ""));
  if (!icon) skipped.push(`${name}/`);
  else {
    folderMap[name] = icon;
    used.add(icon);
  }
}

const icons = {};
const missingIcons = [];
for (const name of [...used].sort()) {
  const icon = readIcon(name);
  if (!icon) missingIcons.push(name);
  else icons[name] = icon;
}
if (missingIcons.length) {
  console.error(`图标文件缺失：${missingIcons.join(", ")}`);
  process.exit(1);
}

const json = (value) => JSON.stringify(value);
const entries = (map) =>
  Object.entries(map)
    .map(([key, value]) => `  ${json(key)}: ${json(value)},`)
    .join("\n");

const out = `/**
 * Material Icon Theme 的文件图标（内联，MIT）。
 *
 * 来源：https://github.com/PKief/vscode-material-icon-theme（commit 045291f），
 * 由 \`scripts/build-material-file-icons.mjs\` 生成 —— 不要手改，改脚本再跑。
 *
 * - \`EXT\` / \`NAME\` / \`FOLDER\` 是从上游那张「扩展名 / 文件名 / 文件夹名 → 图标」表里
 *   挑出来的子集，键名与上游一致；
 * - \`materialFileIcons\` 只包含真正用到的 ${Object.keys(icons).length} 个图标：
 *   \`body\` 保留 Material 原色，\`mono\` 是全 currentColor 版本（单色 / 填充主题用），
 *   \`color\` 是图标主色。
 */
export interface MaterialFileIcon {
  color: string;
  viewBox: string;
  body: string;
  mono: string;
}

/** 扩展名 → 图标名 */
export const EXT: Record<string, string> = {
${entries(extMap)}
};

/** 文件名（小写）→ 图标名 */
export const NAME: Record<string, string> = {
${entries(nameMap)}
};

/** 文件夹名（小写）→ 图标名 */
export const FOLDER: Record<string, string> = {
${entries(folderMap)}
};

/** 兜底图标名 */
export const DEFAULT_ICON = ${json(DEFAULT_ICON)};

export const materialFileIcons: Record<string, MaterialFileIcon> = {
${Object.entries(icons)
  .map(
    ([name, icon]) =>
      `  ${json(name)}: { color: ${json(icon.color)}, viewBox: ${json(icon.viewBox)}, body: ${json(icon.body)}, mono: ${json(icon.mono)} },`,
  )
  .join("\n")}
};
`;

writeFileSync(target, out);
console.log(
  `material-file-icons: ${Object.keys(icons).length} 个图标 / ${Object.keys(extMap).length} 扩展名 / ` +
    `${Object.keys(nameMap).length} 文件名 / ${Object.keys(folderMap).length} 文件夹 → ${path.relative(root, target)}`,
);
if (skipped.length) console.log(`上游没有的键（已跳过）：${skipped.join(" ")}`);
