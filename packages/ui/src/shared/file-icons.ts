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
  // ---- 补齐：Seti 没有专属图形，按语义归到最近的图标 ----
  odp: ["word", "演示文稿"],
  pps: ["word", "演示文稿"],
  ppsx: ["word", "演示文稿"],
  key: ["word", "Keynote"],
  pages: ["word", "Pages"],
  dot: ["word", "Word 模板"],
  dotx: ["word", "Word 模板"],
  epub: ["word", "电子书"],
  mobi: ["word", "电子书"],
  azw3: ["word", "电子书"],
  xlsm: ["xls", "Excel"],
  numbers: ["xls", "Numbers"],
  avro: ["db", "Avro"],
  orc: ["db", "ORC"],
  mdb: ["db", "Access"],
  dbf: ["db", "dBase"],
  plist: ["config", "plist"],
  heic: ["image", "HEIC"],
  heif: ["image", "HEIF"],
  eps: ["image", "EPS"],
  raw: ["image", "RAW"],
  dng: ["image", "DNG"],
  cr2: ["image", "Canon RAW"],
  nef: ["image", "Nikon RAW"],
  m4v: ["video", "视频"],
  wmv: ["video", "视频"],
  flv: ["video", "视频"],
  mpg: ["video", "视频"],
  mpeg: ["video", "视频"],
  ogv: ["video", "视频"],
  opus: ["audio", "音频"],
  wma: ["audio", "音频"],
  mid: ["audio", "MIDI"],
  midi: ["audio", "MIDI"],
  lz: ["zip", "压缩包"],
  lz4: ["zip", "压缩包"],
  z: ["zip", "压缩包"],
  cab: ["zip", "压缩包"],
  iso: ["zip", "镜像"],
  dmg: ["zip", "磁盘映像"],
  pkg: ["zip", "安装包"],
  deb: ["zip", "Debian 包"],
  rpm: ["zip", "RPM 包"],
  apk: ["zip", "Android 包"],
  ipa: ["zip", "iOS 包"],
  ear: ["zip", "EAR"],
  xhtml: ["html", "XHTML"],
  hcl: ["config", "HCL"],
  nix: ["config", "Nix"],
  ksh: ["shell", "Ksh"],
  pyw: ["python", "Python"],
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
  astro: ["html", "Astro"],
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
  m: ["c", "Objective-C"],
  mm: ["cpp", "Objective-C++"],
  scala: ["scala", "Scala"],
  sc: ["scala", "Scala"],
  lua: ["lua", "Lua"],
  dart: ["dart", "Dart"],
  zig: ["zig", "Zig"],
  ex: ["elixir", "Elixir"],
  exs: ["elixir", "Elixir"],
  erl: ["unknown", "Erlang"],
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
  sol: ["unknown", "Solidity"],
  proto: ["unknown", "Protobuf"],
  groovy: ["java", "Groovy"],
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
  txt: ["unknown", "文本"],
  log: ["unknown", "日志"],
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
  parquet: ["db", "Parquet"],
  doc: ["word", "Word"],
  docx: ["word", "Word"],
  rtf: ["word", "RTF"],
  odt: ["word", "文档"],
  ppt: ["word", "演示文稿"],
  pptx: ["word", "演示文稿"],
  pdf: ["pdf", "PDF"],
  diff: ["git", "补丁"],
  patch: ["git", "补丁"],
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
  so: ["unknown", "动态库"],
  dylib: ["unknown", "动态库"],
  bin: ["unknown", "二进制"],
  wasm: ["wasm", "WebAssembly"],
  wat: ["wasm", "WebAssembly 文本"],
  o: ["unknown", "目标文件"],
  class: ["unknown", "Java 类"],
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

/**
 * 特殊文件夹：按名字换形状或换色。
 *
 * Seti 只有 `folder` / `git_folder` 两种文件夹形状，所以这里做两件事：
 * - 有语义对应的（`.git`、`node_modules`、`config`…）直接用那个图标；
 * - 其余保持文件夹形状，但按用途换颜色 —— 文件树里一眼能分出「代码 / 测试 / 产出 / 文档」。
 */
const BY_FOLDER: Record<string, { seti?: string; color?: string; label?: string }> = {
  ".git": { seti: "git_folder", color: "#e0503a", label: "Git 目录" },
  ".github": { seti: "git_folder", color: "#e0503a", label: "GitHub 配置" },
  ".vscode": { seti: "config", color: "#3d8fd1", label: "编辑器配置" },
  ".config": { seti: "config", color: "#7b86c9", label: "配置" },
  "__pycache__": { color: "#4a7fb5", label: "Python 缓存" },
  "node_modules": { seti: "npm", color: "#c0392b", label: "依赖目录" },
  src: { color: "#4f8fb3", label: "源码" },
  source: { color: "#4f8fb3", label: "源码" },
  lib: { color: "#4f8fb3", label: "库" },
  app: { color: "#4f8fb3", label: "应用" },
  packages: { color: "#4f8fb3", label: "包" },
  test: { color: "#3f9070", label: "测试" },
  tests: { color: "#3f9070", label: "测试" },
  __tests__: { color: "#3f9070", label: "测试" },
  spec: { color: "#3f9070", label: "测试" },
  specs: { color: "#3f9070", label: "测试" },
  e2e: { color: "#3f9070", label: "端到端测试" },
  docs: { color: "#8d97a6", label: "文档" },
  doc: { color: "#8d97a6", label: "文档" },
  documentation: { color: "#8d97a6", label: "文档" },
  assets: { color: "#9a6cc4", label: "资源" },
  static: { color: "#9a6cc4", label: "静态资源" },
  images: { color: "#9a6cc4", label: "图片" },
  img: { color: "#9a6cc4", label: "图片" },
  media: { color: "#c65fa0", label: "媒体" },
  build: { color: "#b98a4d", label: "构建产物" },
  dist: { color: "#b98a4d", label: "构建产物" },
  out: { color: "#b98a4d", label: "构建产物" },
  output: { color: "#b98a4d", label: "构建产物" },
  target: { color: "#b98a4d", label: "构建产物" },
  coverage: { color: "#b98a4d", label: "覆盖率报告" },
  config: { seti: "config", color: "#7b86c9", label: "配置" },
  configs: { seti: "config", color: "#7b86c9", label: "配置" },
  scripts: { seti: "shell", color: "#8f98a8", label: "脚本" },
  tools: { seti: "shell", color: "#8f98a8", label: "工具" },
  bin: { color: "#77808f", label: "可执行文件" },
  vendor: { color: "#8d97a6", label: "第三方代码" },
  migrations: { seti: "db", color: "#3f9070", label: "数据库迁移" },
};

/** 文件夹配色（Seti 的 folder.svg 是单色，颜色靠这里给） */
const FOLDER_COLOR = "#7f8ca6";
/**
 * 认不出来的文件。
 *
 * 用一个**不存在于 seti-icons 的图标名**（不是 `default`）：这样 `resolveFileIcon`
 * 会走到「扩展名徽标」分支，而不是让所有未知类型都长成同一张空白纸页。
 */
const FALLBACK: Entry = ["unknown", "文件"];

const EMPTY_VIEW = {
  theme: "seti" as FileIconThemeId,
  seti: "default",
  label: "文件",
  color: "#8b929e",
  inkColor: "#8b929e",
  body: "",
  isFolder: false,
};

/** 画法：Seti 图形 / 扩展名徽标 */
export type FileIconInk = "glyph" | "badge";

/**
 * Seti 没有覆盖的类型用「扩展名徽标」兜底。
 *
 * Seti 只有 169 个图标，`.txt`、`.ppt`、`.heic`、`.apk` 这类它本来就没有；
 * 与其所有人共用一个空白纸页，不如把扩展名写成缩写（TXT / PPT / HEIC），
 * 再按大类上色 —— 任何一个扩展名都能有可辨识的样子。
 */
const BADGE_COLORS: Record<string, string> = {
  doc: "#5c7fa8",
  data: "#3f9070",
  media: "#9a6cc4",
  video: "#c65fa0",
  audio: "#b9812a",
  archive: "#b98d4d",
  binary: "#77808f",
  code: "#5b8def",
  config: "#7b86c9",
  default: "#8d97a6",
};

/** 扩展名 → 徽标配色的大类 */
const BADGE_FAMILY: Record<string, string> = {
  // 徽标兜底只在「Seti 没有这个类型」时用到，所以这里列的是**掉到兜底的**那些扩展名
  txt: "doc",
  log: "doc",
  rtf: "doc",
  rst: "doc",
  org: "doc",
  bib: "doc",
  adoc: "doc",
  asciidoc: "doc",
  diff: "doc",
  patch: "doc",
  csv: "data",
  tsv: "data",
  db: "data",
  sqlite: "data",
  parquet: "data",
  avro: "data",
  png: "media",
  jpg: "media",
  jpeg: "media",
  gif: "media",
  svg: "media",
  heic: "media",
  webp: "media",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  "7z": "archive",
  rar: "archive",
  iso: "archive",
  dmg: "archive",
  so: "binary",
  dylib: "binary",
  bin: "binary",
  o: "binary",
  class: "binary",
  pyc: "binary",
  exe: "binary",
  erl: "code",
  sol: "code",
  proto: "code",
  hcls: "code",
  yml: "config",
  yaml: "config",
  toml: "config",
  ini: "config",
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
  /** 画法：有 Seti 图形就画图形，没有就画扩展名徽标 */
  ink: FileIconInk;
  /** 徽标文字（`ink === "badge"` 时有值），2–4 个字符 */
  badge: string;
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
/** 文件夹的样式（形状 + 颜色 + 名称） */
export function folderStyle(name: string): { seti: string; color: string; label: string } {
  const base = fileName(name).toLowerCase() || String(name ?? "").trim().toLowerCase();
  const hit = BY_FOLDER[base] ?? (base.startsWith(".") ? BY_FOLDER[base.split("/")[0]!] : undefined);
  return {
    seti: hit?.seti ?? "folder",
    color: hit?.color ?? FOLDER_COLOR,
    label: hit?.label ?? "文件夹",
  };
}

export function fileIconEntry(
  name: string,
  options: { isFolder?: boolean } = {},
): Entry {
  if (options.isFolder) {
    const style = folderStyle(name);
    return [style.seti, style.label];
  }
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

/** 徽标文字：扩展名（最多 4 位，大写），没有扩展名就用名字前 3 个字 */
export function badgeText(name: string): string {
  const ext = fileExtension(name);
  if (ext) return ext.slice(0, 4).toUpperCase();
  const base = fileName(name).replace(/[^a-zA-Z0-9]/g, "");
  return (base.slice(0, 3) || "FILE").toUpperCase();
}

/** 徽标配色的大类（认不出来按 default） */
export function badgeFamily(name: string): string {
  const ext = fileExtension(name);
  return (ext && BADGE_FAMILY[ext]) || "default";
}

/** 解析成界面要用的视图 */
export function resolveFileIcon(
  name: string,
  options: { theme?: FileIconThemeId; isFolder?: boolean; open?: boolean } = {},
): FileIconView {
  const theme: FileIconThemeId = options.theme ?? "seti";
  const [seti, label] = fileIconEntry(name, { isFolder: options.isFolder });
  const icon = setiIcons[seti];
  // 文件夹的配色按用途走（src / test / dist…），不跟着 folder.svg 的灰色走
  const color = options.isFolder ? folderStyle(name).color : (icon?.color ?? BADGE_COLORS.default!);
  const inkColor =
    theme === "block" ? contrastInk(color) : theme === "mono" ? "var(--fg-2)" : color;

  // Seti 有这个图标就画图形，没有就退到扩展名徽标（永远有东西可看）
  if (icon) {
    return {
      theme,
      seti,
      label,
      color,
      inkColor,
      body: icon.body,
      isFolder: Boolean(options.isFolder),
      ink: "glyph",
      badge: "",
    };
  }
  return {
    theme,
    seti,
    label: label === "文件" ? "未知类型" : label,
    color: BADGE_COLORS[badgeFamily(name)] ?? BADGE_COLORS.default!,
    inkColor:
      theme === "block"
        ? contrastInk(BADGE_COLORS[badgeFamily(name)] ?? BADGE_COLORS.default!)
        : theme === "mono"
          ? "var(--fg-2)"
          : BADGE_COLORS[badgeFamily(name)] ?? BADGE_COLORS.default!,
    body: "",
    isFolder: false,
    ink: "badge",
    badge: badgeText(name),
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
