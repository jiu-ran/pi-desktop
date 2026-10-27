import { setiIcons } from "./seti-icons.ts";

/**
 * 文件类型图标：文件名 → Seti UI 图标（+ 主题）。
 *
 * 图标本身来自 Seti UI（https://github.com/jesseweed/seti-ui，MIT），由
 * `scripts/build-seti-icons.mjs` 内联成 `seti-icons.ts`；这个文件只负责
 * 「认类型」和「决定用什么颜色画」。
 *
 * 三种主题共用同一套形状，只换着色方式：
 * - `seti`（默认）：Seti 原始品牌色，和 VS Code 的 Seti 主题一致；
 * - `mono`：跟随正文颜色，适合喜欢极简的人；
 * - `block`：品牌色方块 + 反白图标（VS Code 图标主题里常见的画法）。
 *
 * 为什么颜色写死在图标数据里：同一个文件在深色/浅色主题下必须是同一种颜色，
 * 否则「靠颜色认类型」就不成立了。
 */
export type FileIconThemeId = "seti" | "mono" | "block";

export const FILE_ICON_THEMES: Array<{ id: FileIconThemeId; label: string; hint: string }> = [
  { id: "seti", label: "Seti", hint: "Seti UI 原色（默认）" },
  { id: "mono", label: "单色", hint: "只有形状，跟随正文颜色" },
  { id: "block", label: "填充", hint: "品牌色方块 + 反白图标" },
];

/** `[Seti 图标名, 类型名]` */
type Entry = readonly [seti: string, label: string];

/** 扩展名（小写）→ 图标 */
const BY_EXTENSION: Record<string, Entry> = {
  // ---- 前端 ----
  ts: ["typescript", "TypeScript"],
  tsx: ["typescript", "TypeScript"],
  mts: ["typescript", "TypeScript"],
  cts: ["typescript", "TypeScript"],
  js: ["javascript", "JavaScript"],
  jsx: ["javascript", "JavaScript"],
  mjs: ["javascript", "JavaScript"],
  cjs: ["javascript", "JavaScript"],
  vue: ["vue", "Vue"],
  svelte: ["svelte", "Svelte"],
  astro: ["default", "Astro"],
  html: ["html", "HTML"],
  htm: ["html", "HTML"],
  css: ["css", "CSS"],
  scss: ["sass", "SCSS"],
  sass: ["sass", "Sass"],
  less: ["less", "Less"],
  styl: ["stylus", "Stylus"],
  // ---- 后端 / 系统 ----
  py: ["python", "Python"],
  pyi: ["python", "Python"],
  ipynb: ["notebook", "Notebook"],
  java: ["java", "Java"],
  kt: ["kotlin", "Kotlin"],
  kts: ["kotlin", "Kotlin"],
  cs: ["c-sharp", "C#"],
  c: ["c", "C"],
  h: ["c", "C 头文件"],
  cpp: ["cpp", "C++"],
  cxx: ["cpp", "C++"],
  cc: ["cpp", "C++"],
  hpp: ["cpp", "C++ 头文件"],
  go: ["go", "Go"],
  rs: ["rust", "Rust"],
  rb: ["ruby", "Ruby"],
  php: ["php", "PHP"],
  swift: ["swift", "Swift"],
  m: ["default", "Objective-C"],
  mm: ["default", "Objective-C++"],
  scala: ["scala", "Scala"],
  sc: ["scala", "Scala"],
  lua: ["lua", "Lua"],
  dart: ["dart", "Dart"],
  zig: ["zig", "Zig"],
  ex: ["elixir", "Elixir"],
  exs: ["elixir", "Elixir"],
  erl: ["default", "Erlang"],
  hs: ["haskell", "Haskell"],
  clj: ["clojure", "Clojure"],
  cljs: ["clojure", "ClojureScript"],
  r: ["R", "R"],
  jl: ["julia", "Julia"],
  nim: ["nim", "Nim"],
  cr: ["crystal", "Crystal"],
  elm: ["elm", "Elm"],
  haxe: ["haxe", "Haxe"],
  vala: ["vala", "Vala"],
  cu: ["cu", "CUDA"],
  pl: ["perl", "Perl"],
  asm: ["asm", "汇编"],
  s: ["asm", "汇编"],
  sol: ["default", "Solidity"],
  proto: ["default", "Protobuf"],
  groovy: ["default", "Groovy"],
  // ---- 脚本 / 配置 ----
  sh: ["shell", "Shell"],
  bash: ["shell", "Bash"],
  zsh: ["shell", "Zsh"],
  fish: ["shell", "Fish"],
  ps1: ["powershell", "PowerShell"],
  psm1: ["powershell", "PowerShell"],
  bat: ["windows", "批处理"],
  cmd: ["windows", "批处理"],
  yml: ["yml", "YAML"],
  yaml: ["yml", "YAML"],
  toml: ["config", "TOML"],
  ini: ["config", "INI"],
  cfg: ["config", "配置"],
  conf: ["config", "配置"],
  env: ["config", "环境变量"],
  properties: ["config", "Properties"],
  xml: ["xml", "XML"],
  json: ["json", "JSON"],
  jsonc: ["json", "JSON"],
  json5: ["json", "JSON"],
  jsonl: ["json", "JSON Lines"],
  ndjson: ["json", "JSON Lines"],
  graphql: ["graphql", "GraphQL"],
  gql: ["graphql", "GraphQL"],
  prisma: ["prisma", "Prisma"],
  tf: ["terraform", "Terraform"],
  tfvars: ["terraform", "Terraform"],
  // ---- 文档 / 数据 ----
  md: ["markdown", "Markdown"],
  mdx: ["markdown", "MDX"],
  markdown: ["markdown", "Markdown"],
  txt: ["default", "文本"],
  log: ["default", "日志"],
  tex: ["tex", "TeX"],
  csv: ["csv", "CSV"],
  tsv: ["csv", "TSV"],
  xls: ["xls", "Excel"],
  xlsx: ["xls", "Excel"],
  ods: ["xls", "表格"],
  db: ["db", "数据库"],
  sqlite: ["db", "SQLite"],
  sqlite3: ["db", "SQLite"],
  sql: ["db", "SQL"],
  parquet: ["default", "Parquet"],
  doc: ["word", "Word"],
  docx: ["word", "Word"],
  rtf: ["word", "RTF"],
  odt: ["word", "文档"],
  ppt: ["default", "演示文稿"],
  pptx: ["default", "演示文稿"],
  pdf: ["pdf", "PDF"],
  diff: ["default", "补丁"],
  patch: ["default", "补丁"],
  // ---- 媒体 ----
  png: ["image", "PNG"],
  jpg: ["image", "JPEG"],
  jpeg: ["image", "JPEG"],
  gif: ["image", "GIF"],
  webp: ["image", "WebP"],
  avif: ["image", "AVIF"],
  bmp: ["image", "BMP"],
  ico: ["favicon", "图标"],
  tiff: ["image", "TIFF"],
  psd: ["photoshop", "Photoshop"],
  ai: ["illustrator", "Illustrator"],
  sketch: ["image", "Sketch"],
  fig: ["image", "Figma"],
  svg: ["svg", "SVG"],
  mp4: ["video", "视频"],
  mov: ["video", "视频"],
  webm: ["video", "视频"],
  mkv: ["video", "视频"],
  avi: ["video", "视频"],
  mp3: ["audio", "音频"],
  wav: ["audio", "音频"],
  flac: ["audio", "音频"],
  ogg: ["audio", "音频"],
  m4a: ["audio", "音频"],
  aac: ["audio", "音频"],
  woff: ["font", "字体"],
  woff2: ["font", "字体"],
  ttf: ["font", "字体"],
  otf: ["font", "字体"],
  eot: ["font", "字体"],
  // ---- 打包 / 二进制 ----
  zip: ["zip", "压缩包"],
  tar: ["zip", "压缩包"],
  gz: ["zip", "压缩包"],
  tgz: ["zip", "压缩包"],
  bz2: ["zip", "压缩包"],
  xz: ["zip", "压缩包"],
  zst: ["zip", "压缩包"],
  "7z": ["zip", "压缩包"],
  rar: ["zip", "压缩包"],
  jar: ["zip", "JAR"],
  war: ["zip", "WAR"],
  exe: ["windows", "可执行文件"],
  dll: ["windows", "动态库"],
  so: ["default", "动态库"],
  dylib: ["default", "动态库"],
  bin: ["default", "二进制"],
  wasm: ["wasm", "WebAssembly"],
  wat: ["wasm", "WebAssembly 文本"],
  o: ["default", "目标文件"],
  class: ["default", "Java 类"],
  lock: ["lock", "锁文件"],
  sum: ["lock", "校验文件"],
};

/** 特殊文件名（小写）→ 图标 */
const BY_FILENAME: Record<string, Entry> = {
  "package.json": ["npm", "npm 清单"],
  "package-lock.json": ["npm", "npm 锁文件"],
  "npm-shrinkwrap.json": ["npm", "npm 锁文件"],
  "yarn.lock": ["yarn", "yarn 锁文件"],
  "pnpm-lock.yaml": ["lock", "pnpm 锁文件"],
  "bun.lockb": ["lock", "bun 锁文件"],
  "cargo.lock": ["lock", "Cargo 锁文件"],
  "cargo.toml": ["rust", "Cargo 清单"],
  "poetry.lock": ["lock", "Poetry 锁文件"],
  "uv.lock": ["lock", "uv 锁文件"],
  "go.sum": ["go", "Go 校验文件"],
  "go.mod": ["go", "Go 模块"],
  "pyproject.toml": ["python", "Python 项目"],
  "requirements.txt": ["python", "Python 依赖"],
  "setup.py": ["python", "Python 打包"],
  "tsconfig.json": ["tsconfig", "TypeScript 配置"],
  "jsconfig.json": ["tsconfig", "JavaScript 配置"],
  "babel.config.js": ["babel", "Babel 配置"],
  ".babelrc": ["babel", "Babel 配置"],
  "vite.config.ts": ["vite", "Vite 配置"],
  "vite.config.js": ["vite", "Vite 配置"],
  "webpack.config.js": ["webpack", "Webpack 配置"],
  "webpack.config.ts": ["webpack", "Webpack 配置"],
  "rollup.config.js": ["rollup", "Rollup 配置"],
  "rollup.config.ts": ["rollup", "Rollup 配置"],
  "gruntfile.js": ["grunt", "Grunt 配置"],
  "gulpfile.js": ["gulp", "Gulp 配置"],
  "karma.conf.js": ["karma", "Karma 配置"],
  "dockerfile": ["docker", "Dockerfile"],
  "docker-compose.yml": ["docker", "Docker Compose"],
  "docker-compose.yaml": ["docker", "Docker Compose"],
  ".dockerignore": ["docker", "Docker 忽略"],
  "makefile": ["makefile", "Makefile"],
  "build.gradle": ["gradle", "Gradle 构建"],
  "build.gradle.kts": ["gradle", "Gradle 构建"],
  "settings.gradle": ["gradle", "Gradle 设置"],
  "pom.xml": ["maven", "Maven 配置"],
  "package.swift": ["swift", "SwiftPM 清单"],
  ".gitignore": ["git_ignore", "Git 忽略"],
  ".gitattributes": ["git", "Git 属性"],
  ".gitmodules": ["git", "Git 子模块"],
  ".gitkeep": ["git", "Git 占位"],
  ".gitconfig": ["git", "Git 配置"],
  ".editorconfig": ["editorconfig", "EditorConfig"],
  ".eslintrc": ["eslint", "ESLint 配置"],
  ".eslintrc.js": ["eslint", "ESLint 配置"],
  ".eslintrc.json": ["eslint", "ESLint 配置"],
  "eslint.config.js": ["eslint", "ESLint 配置"],
  ".stylelintrc": ["stylelint", "Stylelint 配置"],
  ".npmrc": ["npm", "npm 配置"],
  ".bowerrc": ["bower", "Bower 配置"],
  "bower.json": ["bower", "Bower 清单"],
  "firebase.json": ["firebase", "Firebase 配置"],
  ".firebaserc": ["firebase", "Firebase 别名"],
  ".env": ["config", "环境变量"],
  ".env.local": ["config", "环境变量"],
  ".env.example": ["config", "环境变量示例"],
  "license": ["license", "许可证"],
  "license.md": ["license", "许可证"],
  "license.txt": ["license", "许可证"],
  "changelog.md": ["markdown", "更新日志"],
  "agents.md": ["markdown", "Agent 说明"],
  "readme": ["markdown", "说明"],
};

/** 文件夹：Seti 只有一种文件夹形状，展开状态靠左侧箭头表示 */
const FOLDER: Entry = ["folder", "文件夹"];
/** 认不出来的文件 */
const FALLBACK: Entry = ["default", "文件"];

const EMPTY_VIEW = {
  theme: "seti" as FileIconThemeId,
  seti: "default",
  label: "文件",
  color: "#8b929e",
  inkColor: "#8b929e",
  body: "",
  isFolder: false,
};

export interface FileIconView {
  theme: FileIconThemeId;
  /** 命中的 Seti 图标名 */
  seti: string;
  label: string;
  /** 品牌色（图标原色） */
  color: string;
  /** 实际画图标用的颜色：Seti=品牌色、单色=正文色、填充=黑/白 */
  inkColor: string;
  /** SVG 内容（fill 已换成 currentColor） */
  body: string;
  isFolder: boolean;
}

/** 取扩展名：`a.d.ts` → `ts`；`.gitignore` → `""`（点开头的算特殊文件名） */
export function fileExtension(name: string): string {
  const base = String(name ?? "").trim().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** 文件名（去掉目录部分），用于特殊文件名匹配 */
export function fileName(name: string): string {
  return String(name ?? "").trim().split(/[\\/]/).pop() ?? "";
}

/**
 * 命中的类型。优先级：文件夹 → 特殊文件名 → `.env.local` 这类前缀回退 →
 * 扩展名 → 点开头当配置 → 兜底。
 */
export function fileIconEntry(
  name: string,
  options: { isFolder?: boolean } = {},
): Entry {
  if (options.isFolder) return FOLDER;
  const base = fileName(name).toLowerCase();
  if (!base) return FALLBACK;
  const special = BY_FILENAME[base];
  if (special) return special;
  if (base.startsWith(".")) {
    for (let index = base.length - 1; index > 1; index -= 1) {
      if (base[index] !== ".") continue;
      const hit = BY_FILENAME[base.slice(0, index)];
      if (hit) return hit;
    }
  }
  const ext = fileExtension(base);
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext]!;
  if (base.startsWith(".")) return ["config", "配置"] as const;
  return FALLBACK;
}

/**
 * 品牌色上该用黑字还是白字。
 *
 * 填充主题要把图标反白压在品牌色上：浅色（黄、青）配白会糊成一团，
 * 按 WCAG 相对亮度挑一个，阈值 0.32（黄 #c4b24a 落在黑字一侧）。
 */
export function contrastInk(color: string): string {
  const hex = String(color ?? "").replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length !== 6) return "#ffffff";
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.32 ? "#12141a" : "#ffffff";
}

/** 解析成界面要用的视图 */
export function resolveFileIcon(
  name: string,
  options: { theme?: FileIconThemeId; isFolder?: boolean; open?: boolean } = {},
): FileIconView {
  const theme: FileIconThemeId = options.theme ?? "seti";
  const [seti, label] = fileIconEntry(name, { isFolder: options.isFolder });
  const icon = setiIcons[seti] ?? setiIcons.default;
  if (!icon) return { ...EMPTY_VIEW, theme };
  const inkColor =
    theme === "block" ? contrastInk(icon.color) : theme === "mono" ? "var(--fg-2)" : icon.color;
  return {
    theme,
    seti,
    label,
    color: icon.color,
    inkColor,
    body: icon.body,
    isFolder: Boolean(options.isFolder),
  };
}

/** 设置页预览用的固定样例 */
export const FILE_ICON_SAMPLES = [
  "src/app.ts",
  "src/App.vue",
  "src/styles.css",
  "package.json",
  "README.md",
  "assets/logo.png",
  "bundle.tar.gz",
] as const;
