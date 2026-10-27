import { fileGlyphs } from "./file-glyphs.ts";

/**
 * 文件类型图标：把「文件名」映射成一套主题化的图标。
 *
 * 三种画法共用同一张「类型表」，只换画法，所以切换主题时认文件靠的类型划分不变：
 *
 * - `solid`（默认，VS Code 风）：品牌色实心方块 + 白色字母 / 白色图形；
 * - `outline`（JetBrains 风）：同形状但只描边，字母与线条都用品牌色；
 * - `tint`（最克制）：不画底，只有品牌色的字形或字母。
 *
 * 字母与图形二选一：代码类用字母（TS / PY / C# / `{}` / `<>` / `#` / `>_`），
 * 文档、媒体、压缩包这类用图形（一眼就能分出「这是图片 / 这是压缩包」）。
 *
 * 颜色写死成中间调：同一个文件在深色/浅色主题下必须是同一种颜色，
 * 否则「靠颜色认类型」这件事就不成立。
 */
export type FileIconThemeId = "solid" | "outline" | "tint";

export const FILE_ICON_THEMES: Array<{ id: FileIconThemeId; label: string; hint: string }> = [
  { id: "solid", label: "填充", hint: "品牌色实心方块 + 字母（VS Code 风，默认）" },
  { id: "outline", label: "描边", hint: "同形状的细描边彩色字形（JetBrains 风）" },
  { id: "tint", label: "裸字形", hint: "不画底，只有品牌色的字形或字母" },
];

export type FileIconKind =
  | "folder"
  | "folderOpen"
  | "source"
  | "web"
  | "shell"
  | "json"
  | "config"
  | "markdown"
  | "text"
  | "data"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "pdf"
  | "doc"
  | "sheet"
  | "font"
  | "lock"
  | "binary"
  | "file";

export interface IconStyle {
  kind: FileIconKind;
  /** 品牌色（深浅主题共用） */
  color: string;
  /** 给人看的类型名 */
  label: string;
  /** 字母画法（代码类）：2–4 个字符 */
  letters?: string;
  /** 图形画法（文档/媒体类）：`fileGlyphs` 的键 */
  glyph?: string;
}

/** 每种 kind 的兜底样式（语言表没命中时用） */
const KINDS: Record<FileIconKind, IconStyle> = {
  folder: { kind: "folder", color: "#7f8ca6", label: "文件夹", glyph: "folder" },
  folderOpen: { kind: "folderOpen", color: "#7f8ca6", label: "文件夹", glyph: "folderOpen" },
  source: { kind: "source", color: "#5b8def", label: "源码", letters: "SRC" },
  web: { kind: "web", color: "#e34c26", label: "网页", glyph: "code" },
  shell: { kind: "shell", color: "#7c8798", label: "脚本", glyph: "terminal" },
  json: { kind: "json", color: "#b8912f", label: "JSON", letters: "{}" },
  config: { kind: "config", color: "#7b86c9", label: "配置", glyph: "config" },
  markdown: { kind: "markdown", color: "#4f8fb3", label: "Markdown", letters: "M↓" },
  text: { kind: "text", color: "#8d97a6", label: "文本", glyph: "text" },
  data: { kind: "data", color: "#3f9070", label: "数据", glyph: "sheet" },
  image: { kind: "image", color: "#9a6cc4", label: "图片", glyph: "image" },
  video: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  audio: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  archive: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  pdf: { kind: "pdf", color: "#cc4c48", label: "PDF", glyph: "page" },
  doc: { kind: "doc", color: "#3a6fbe", label: "文档", glyph: "page" },
  sheet: { kind: "sheet", color: "#3f8f5f", label: "表格", glyph: "sheet" },
  font: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  lock: { kind: "lock", color: "#858c98", label: "锁文件", glyph: "lock" },
  binary: { kind: "binary", color: "#77808f", label: "二进制", glyph: "binary" },
  file: { kind: "file", color: "#8d97a6", label: "文件", glyph: "page" },
};

/** 语言/格式表：扩展名（小写）→ 样式。颜色取各语言的习惯色，压到深浅主题都能读的中间调 */
const BY_EXTENSION: Record<string, IconStyle> = {
  // ---- 前端 ----
  ts: { kind: "source", color: "#3178c6", label: "TypeScript", letters: "TS" },
  tsx: { kind: "source", color: "#3178c6", label: "TypeScript", letters: "TS" },
  mts: { kind: "source", color: "#3178c6", label: "TypeScript", letters: "TS" },
  cts: { kind: "source", color: "#3178c6", label: "TypeScript", letters: "TS" },
  js: { kind: "source", color: "#b99a1a", label: "JavaScript", letters: "JS" },
  jsx: { kind: "source", color: "#b99a1a", label: "JavaScript", letters: "JS" },
  mjs: { kind: "source", color: "#b99a1a", label: "JavaScript", letters: "JS" },
  cjs: { kind: "source", color: "#b99a1a", label: "JavaScript", letters: "JS" },
  vue: { kind: "web", color: "#3fa877", label: "Vue", letters: "VUE" },
  svelte: { kind: "web", color: "#e2562b", label: "Svelte", letters: "SVE" },
  astro: { kind: "web", color: "#ff5d01", label: "Astro", letters: "AST" },
  html: { kind: "web", color: "#d2542a", label: "HTML", letters: "<>" },
  htm: { kind: "web", color: "#d2542a", label: "HTML", letters: "<>" },
  css: { kind: "web", color: "#b1459b", label: "CSS", letters: "#" },
  scss: { kind: "web", color: "#b1459b", label: "SCSS", letters: "#" },
  sass: { kind: "web", color: "#b1459b", label: "Sass", letters: "#" },
  less: { kind: "web", color: "#b1459b", label: "Less", letters: "#" },
  // ---- 后端 / 系统 ----
  py: { kind: "source", color: "#3572a5", label: "Python", letters: "PY" },
  pyi: { kind: "source", color: "#3572a5", label: "Python", letters: "PY" },
  ipynb: { kind: "source", color: "#e3702a", label: "Notebook", letters: "IPY" },
  // Java 用咖啡杯（JetBrains 的做法）：四个字母在 16px 下糊成一团，杯子一眼就认出来
  java: { kind: "source", color: "#b07219", label: "Java", glyph: "cup" },
  kt: { kind: "source", color: "#a97bff", label: "Kotlin", letters: "KT" },
  kts: { kind: "source", color: "#a97bff", label: "Kotlin", letters: "KT" },
  cs: { kind: "source", color: "#178600", label: "C#", letters: "C#" },
  c: { kind: "source", color: "#7f8c96", label: "C", letters: "C" },
  h: { kind: "source", color: "#9a72c4", label: "C 头文件", letters: "H" },
  cpp: { kind: "source", color: "#e05580", label: "C++", letters: "C++" },
  cxx: { kind: "source", color: "#e05580", label: "C++", letters: "C++" },
  cc: { kind: "source", color: "#e05580", label: "C++", letters: "C++" },
  hpp: { kind: "source", color: "#9a72c4", label: "C++ 头文件", letters: "H" },
  go: { kind: "source", color: "#00a3cc", label: "Go", letters: "GO" },
  rs: { kind: "source", color: "#c98a63", label: "Rust", letters: "RS" },
  rb: { kind: "source", color: "#cc342d", label: "Ruby", letters: "RB" },
  php: { kind: "source", color: "#777bb4", label: "PHP", letters: "PHP" },
  swift: { kind: "source", color: "#e5543d", label: "Swift", letters: "SW" },
  m: { kind: "source", color: "#438eff", label: "Objective-C", letters: "M" },
  mm: { kind: "source", color: "#438eff", label: "Objective-C++", letters: "MM" },
  scala: { kind: "source", color: "#c22d40", label: "Scala", letters: "SCL" },
  lua: { kind: "source", color: "#4a7fb5", label: "Lua", letters: "LUA" },
  dart: { kind: "source", color: "#0aa6a0", label: "Dart", letters: "DART" },
  
  zig: { kind: "source", color: "#d98b4b", label: "Zig", letters: "ZIG" },
  ex: { kind: "source", color: "#8a5f9e", label: "Elixir", letters: "EX" },
  exs: { kind: "source", color: "#8a5f9e", label: "Elixir", letters: "EX" },
  erl: { kind: "source", color: "#a90533", label: "Erlang", letters: "ERL" },
  hs: { kind: "source", color: "#7a68a6", label: "Haskell", letters: "HS" },
  clj: { kind: "source", color: "#cc5552", label: "Clojure", letters: "CLJ" },
  r: { kind: "source", color: "#3a7fd5", label: "R", letters: "R" },
  jl: { kind: "source", color: "#9b6bb5", label: "Julia", letters: "JL" },
  sol: { kind: "source", color: "#a8703f", label: "Solidity", letters: "SOL" },
  proto: { kind: "source", color: "#4675c0", label: "Protobuf", letters: "PRO" },
  // ---- 脚本 / 配置 ----
  sh: { kind: "shell", color: "#7c8798", label: "Shell", letters: ">_" },
  bash: { kind: "shell", color: "#7c8798", label: "Bash", letters: ">_" },
  zsh: { kind: "shell", color: "#7c8798", label: "Zsh", letters: ">_" },
  fish: { kind: "shell", color: "#7c8798", label: "Fish", letters: ">_" },
  ps1: { kind: "shell", color: "#3a6fa8", label: "PowerShell", letters: "PS" },
  psm1: { kind: "shell", color: "#3a6fa8", label: "PowerShell", letters: "PS" },
  bat: { kind: "shell", color: "#7c8798", label: "批处理", glyph: "terminal" },
  cmd: { kind: "shell", color: "#7c8798", label: "批处理", glyph: "terminal" },
  yml: { kind: "config", color: "#7b86c9", label: "YAML", letters: "YML" },
  yaml: { kind: "config", color: "#7b86c9", label: "YAML", letters: "YML" },
  toml: { kind: "config", color: "#7b86c9", label: "TOML", letters: "TML" },
  ini: { kind: "config", color: "#7b86c9", label: "INI", letters: "INI" },
  cfg: { kind: "config", color: "#7b86c9", label: "配置", glyph: "config" },
  conf: { kind: "config", color: "#7b86c9", label: "配置", glyph: "config" },
  env: { kind: "config", color: "#7b86c9", label: "环境变量", letters: "ENV" },
  properties: { kind: "config", color: "#7b86c9", label: "Properties", letters: "PRP" },
  xml: { kind: "config", color: "#7b86c9", label: "XML", letters: "XML" },
  json: { kind: "json", color: "#b8912f", label: "JSON", letters: "{}" },
  jsonc: { kind: "json", color: "#b8912f", label: "JSON", letters: "{}" },
  json5: { kind: "json", color: "#b8912f", label: "JSON", letters: "{}" },
  jsonl: { kind: "json", color: "#b8912f", label: "JSON Lines", letters: "{}" },
  ndjson: { kind: "json", color: "#b8912f", label: "JSON Lines", letters: "{}" },
  graphql: { kind: "config", color: "#d14893", label: "GraphQL", letters: "GQL" },
  gql: { kind: "config", color: "#d14893", label: "GraphQL", letters: "GQL" },
  prisma: { kind: "config", color: "#5f6ce0", label: "Prisma", letters: "PRS" },
  tf: { kind: "config", color: "#7b42bc", label: "Terraform", letters: "TF" },
  tfvars: { kind: "config", color: "#7b42bc", label: "Terraform", letters: "TF" },
  // ---- 文档 / 数据 ----
  md: { kind: "markdown", color: "#4f8fb3", label: "Markdown", letters: "M↓" },
  mdx: { kind: "markdown", color: "#4f8fb3", label: "MDX", letters: "MDX" },
  markdown: { kind: "markdown", color: "#4f8fb3", label: "Markdown", letters: "M↓" },
  txt: { kind: "text", color: "#8d97a6", label: "文本", glyph: "text" },
  log: { kind: "text", color: "#8d97a6", label: "日志", glyph: "text" },
  csv: { kind: "data", color: "#3f9070", label: "CSV", glyph: "sheet" },
  tsv: { kind: "data", color: "#3f9070", label: "TSV", glyph: "sheet" },
  xls: { kind: "sheet", color: "#3f8f5f", label: "Excel", glyph: "sheet" },
  xlsx: { kind: "sheet", color: "#3f8f5f", label: "Excel", glyph: "sheet" },
  ods: { kind: "sheet", color: "#3f8f5f", label: "表格", glyph: "sheet" },
  db: { kind: "data", color: "#3f9070", label: "数据库", glyph: "db" },
  sqlite: { kind: "data", color: "#3f9070", label: "SQLite", glyph: "db" },
  sqlite3: { kind: "data", color: "#3f9070", label: "SQLite", glyph: "db" },
  sql: { kind: "data", color: "#3f9070", label: "SQL", glyph: "db" },
  parquet: { kind: "data", color: "#3f9070", label: "Parquet", glyph: "db" },
  doc: { kind: "doc", color: "#3a6fbe", label: "Word", glyph: "page" },
  docx: { kind: "doc", color: "#3a6fbe", label: "Word", glyph: "page" },
  rtf: { kind: "doc", color: "#3a6fbe", label: "RTF", glyph: "text" },
  odt: { kind: "doc", color: "#3a6fbe", label: "文档", glyph: "page" },
  pdf: { kind: "pdf", color: "#cc4c48", label: "PDF", glyph: "page" },
  ppt: { kind: "doc", color: "#c25a38", label: "演示文稿", glyph: "sheet" },
  pptx: { kind: "doc", color: "#c25a38", label: "演示文稿", glyph: "sheet" },
  patch: { kind: "text", color: "#8d97a6", label: "补丁", glyph: "text" },
  diff: { kind: "text", color: "#8d97a6", label: "补丁", glyph: "text" },
  map: { kind: "json", color: "#b8912f", label: "Source Map", letters: "{}" },
  // ---- 媒体 ----
  png: { kind: "image", color: "#9a6cc4", label: "PNG", glyph: "image" },
  jpg: { kind: "image", color: "#9a6cc4", label: "JPEG", glyph: "image" },
  jpeg: { kind: "image", color: "#9a6cc4", label: "JPEG", glyph: "image" },
  gif: { kind: "image", color: "#9a6cc4", label: "GIF", glyph: "image" },
  webp: { kind: "image", color: "#9a6cc4", label: "WebP", glyph: "image" },
  avif: { kind: "image", color: "#9a6cc4", label: "AVIF", glyph: "image" },
  bmp: { kind: "image", color: "#9a6cc4", label: "BMP", glyph: "image" },
  ico: { kind: "image", color: "#9a6cc4", label: "图标", glyph: "image" },
  tiff: { kind: "image", color: "#9a6cc4", label: "TIFF", glyph: "image" },
  psd: { kind: "image", color: "#31a8ff", label: "Photoshop", glyph: "image" },
  ai: { kind: "image", color: "#e08c00", label: "Illustrator", glyph: "image" },
  sketch: { kind: "image", color: "#d9a000", label: "Sketch", glyph: "image" },
  fig: { kind: "image", color: "#e2562b", label: "Figma", glyph: "image" },
  svg: { kind: "image", color: "#d99a2f", label: "SVG", glyph: "image" },
  mp4: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  mov: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  webm: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  mkv: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  avi: { kind: "video", color: "#c65fa0", label: "视频", glyph: "video" },
  mp3: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  wav: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  flac: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  ogg: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  m4a: { kind: "audio", color: "#b9812a", label: "音频", glyph: "audio" },
  woff: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  woff2: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  ttf: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  otf: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  eot: { kind: "font", color: "#b9863a", label: "字体", glyph: "font" },
  // ---- 打包 / 二进制 ----
  zip: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  tar: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  gz: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  tgz: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  bz2: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  xz: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  zst: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  "7z": { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  rar: { kind: "archive", color: "#b98d4d", label: "压缩包", glyph: "archive" },
  jar: { kind: "archive", color: "#b98d4d", label: "JAR", glyph: "archive" },
  war: { kind: "archive", color: "#b98d4d", label: "WAR", glyph: "archive" },
  exe: { kind: "binary", color: "#77808f", label: "可执行文件", glyph: "binary" },
  dll: { kind: "binary", color: "#77808f", label: "动态库", glyph: "binary" },
  so: { kind: "binary", color: "#77808f", label: "动态库", glyph: "binary" },
  dylib: { kind: "binary", color: "#77808f", label: "动态库", glyph: "binary" },
  bin: { kind: "binary", color: "#77808f", label: "二进制", glyph: "binary" },
  wasm: { kind: "binary", color: "#6b57d9", label: "WebAssembly", glyph: "binary" },
  o: { kind: "binary", color: "#77808f", label: "目标文件", glyph: "binary" },
  class: { kind: "binary", color: "#77808f", label: "Java 类", glyph: "binary" },
  node: { kind: "binary", color: "#77808f", label: "二进制", glyph: "binary" },
  lock: { kind: "lock", color: "#858c98", label: "锁文件", glyph: "lock" },
  sum: { kind: "lock", color: "#858c98", label: "校验文件", glyph: "lock" },
};

/** 特殊文件名（小写比较）：一眼定类型，不看扩展名 */
const BY_FILENAME: Record<string, IconStyle> = {
  "package.json": { kind: "lock", color: "#c0392b", label: "npm 清单", letters: "NPM" },
  "package-lock.json": { kind: "lock", color: "#858c98", label: "npm 锁文件", glyph: "lock" },
  "yarn.lock": { kind: "lock", color: "#2f79b8", label: "yarn 锁文件", glyph: "lock" },
  "pnpm-lock.yaml": { kind: "lock", color: "#c08a1e", label: "pnpm 锁文件", glyph: "lock" },
  "cargo.lock": { kind: "lock", color: "#c98a63", label: "Cargo 锁文件", glyph: "lock" },
  "poetry.lock": { kind: "lock", color: "#3572a5", label: "Poetry 锁文件", glyph: "lock" },
  "uv.lock": { kind: "lock", color: "#9b6dff", label: "uv 锁文件", glyph: "lock" },
  "go.sum": { kind: "lock", color: "#00a3cc", label: "Go 校验文件", glyph: "lock" },
  "go.mod": { kind: "config", color: "#00a3cc", label: "Go 模块", letters: "GO" },
  "cargo.toml": { kind: "config", color: "#c98a63", label: "Cargo 清单", letters: "RS" },
  "pyproject.toml": { kind: "config", color: "#3572a5", label: "Python 项目", letters: "PY" },
  "requirements.txt": { kind: "config", color: "#3572a5", label: "Python 依赖", letters: "PY" },
  "tsconfig.json": { kind: "config", color: "#3178c6", label: "TypeScript 配置", letters: "TS" },
  "jsconfig.json": { kind: "config", color: "#b99a1a", label: "JavaScript 配置", letters: "JS" },
  "dockerfile": { kind: "config", color: "#2496ed", label: "Dockerfile", letters: "DKR" },
  "docker-compose.yml": { kind: "config", color: "#2496ed", label: "Docker Compose", letters: "DKR" },
  "docker-compose.yaml": { kind: "config", color: "#2496ed", label: "Docker Compose", letters: "DKR" },
  "makefile": { kind: "shell", color: "#7c8798", label: "Makefile", letters: "MK" },
  ".gitignore": { kind: "config", color: "#e0503a", label: "Git 忽略", letters: "GIT" },
  ".gitattributes": { kind: "config", color: "#e0503a", label: "Git 属性", letters: "GIT" },
  ".gitmodules": { kind: "config", color: "#e0503a", label: "Git 子模块", letters: "GIT" },
  ".gitkeep": { kind: "config", color: "#e0503a", label: "Git 占位", letters: "GIT" },
  ".editorconfig": { kind: "config", color: "#7b86c9", label: "EditorConfig", letters: "EDT" },
  ".npmrc": { kind: "config", color: "#c0392b", label: "npm 配置", letters: "NPM" },
  ".env": { kind: "config", color: "#7b86c9", label: "环境变量", letters: "ENV" },
  ".env.local": { kind: "config", color: "#7b86c9", label: "环境变量", letters: "ENV" },
  "license": { kind: "text", color: "#8d97a6", label: "许可证", glyph: "text" },
  "license.md": { kind: "markdown", color: "#4f8fb3", label: "许可证", letters: "LIC" },
  "license.txt": { kind: "text", color: "#8d97a6", label: "许可证", glyph: "text" },
  "dockerignore": { kind: "config", color: "#2496ed", label: "Docker 忽略", letters: "DKR" },
  "agents.md": { kind: "markdown", color: "#4f8fb3", label: "Agent 说明", letters: "AGT" },
};

const FOLDER_STYLE = KINDS.folder;
const FOLDER_OPEN_STYLE = KINDS.folderOpen;
const FILE_STYLE = KINDS.file;

export interface FileIconView {
  theme: FileIconThemeId;
  kind: FileIconKind;
  /** 给人看的类型名（tooltip / 设置预览） */
  label: string;
  /** 品牌色 */
  color: string;
  /** 画法：字母 or 图形 */
  ink: "letters" | "glyph";
  /** 字母（`ink === "letters"` 时有值） */
  letters: string;
  /** 图形 SVG（`ink === "glyph"` 时有值；字母画法也给一个兜底字形） */
  glyph: string;
  /** 字母/线条实际用的颜色：填充主题里是黑或白，其余是品牌色 */
  inkColor: string;
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

/** 命中的样式（语言/特殊文件名/kind 兜底） */
export function fileIconStyle(
  name: string,
  options: { isFolder?: boolean; open?: boolean } = {},
): IconStyle {
  if (options.isFolder) return options.open ? FOLDER_OPEN_STYLE : FOLDER_STYLE;
  const base = fileName(name).toLowerCase();
  if (!base) return FILE_STYLE;
  const special = BY_FILENAME[base];
  if (special) return special;
  // `.env.local` 这类「点 + 后缀」：从后往前逐个点号试一次（`.env.local` → `.env`）
  if (base.startsWith(".")) {
    for (let index = base.length - 1; index > 1; index -= 1) {
      if (base[index] !== ".") continue;
      const hit = BY_FILENAME[base.slice(0, index)];
      if (hit) return hit;
    }
  }
  const ext = fileExtension(base);
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext]!;
  if (base.startsWith(".")) return KINDS.config;
  return FILE_STYLE;
}

/**
 * 品牌色上该用黑字还是白字。
 *
 * 填充主题里字母压在品牌色上，浅色（黄、青）配白字会糊成一团：
 * 按 WCAG 的相对亮度挑一个，阈值取 0.32（黄 #b99a1a 落在黑字一侧，深蓝 / 深绿 / 青仍在白字一侧）。
 */
export function contrastInk(color: string): string {
  const hex = String(color ?? "").replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(0, 2), 16));
  const g = channel(parseInt(hex.slice(2, 4), 16));
  const b = channel(parseInt(hex.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.32 ? "#12141a" : "#ffffff";
}

/**
 * 解析成界面要用的视图。
 *
 * 三种主题只差「底色 + 墨色」：
 * - solid：品牌色实心底，墨色按对比度取黑/白；
 * - outline：透明底 + 品牌色描边，墨色=品牌色；
 * - tint：无底，墨色=品牌色（文件夹跟随正文，避免整列都是彩色）。
 */
export function resolveFileIcon(
  name: string,
  options: { theme?: FileIconThemeId; isFolder?: boolean; open?: boolean } = {},
): FileIconView {
  const theme: FileIconThemeId = options.theme ?? "solid";
  const style = fileIconStyle(name, options);
  const isFolder = Boolean(options.isFolder);
  const glyphKey = style.glyph ?? (isFolder ? "folder" : "page");
  const inkColor =
    theme === "solid"
      ? contrastInk(style.color)
      : theme === "tint" && isFolder
        ? "var(--fg-2)"
        : style.color;
  return {
    theme,
    kind: style.kind,
    label: style.label,
    color: style.color,
    ink: style.letters ? "letters" : "glyph",
    letters: style.letters ?? "",
    glyph: fileGlyphs[glyphKey] ?? fileGlyphs.page ?? "",
    inkColor,
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
