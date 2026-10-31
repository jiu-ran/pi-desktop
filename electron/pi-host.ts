// 隔离工作区的分支命名与托管边界参考 ThinkRail（Apache-2.0），见 THIRD-PARTY-NOTICES.md。
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { open as openFileHandle, readdir, readFile, mkdir, lstat, stat, unlink, writeFile, rename, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { agentDirPath as resolveAgentDir, autoResources, configuredPackages, packageResources, readSettings, runPiCli, skillsFromResources } from "./pi-resources.ts";
import { PiRpcClient } from "./pi-rpc.ts";
import { PI_RPC_ALLOWLIST } from "./pi-rpc-allowlist.ts";
import { COMPACT_RPC_TIMEOUT_MS, runCompactResilient } from "./compact-wait.ts";
import { clearSessionHistoryCache, readSessionHistory, readSessionHistoryPage } from "./session-history.ts";
import { firstUserTitle } from "./session-title.ts";
import { readSessionName } from "./session-name.ts";
import { sessionContextBlock } from "./session-context.ts";
import { logPerfLine } from "./perf-log.ts";
import { log } from "./logger.ts";
import { atomicWriteText, withFileWrite } from "./atomic-file.ts";
import { projectTrustStatus, setProjectTrust, type TrustAction } from "./project-trust.ts";
import { listGitBranches, changeGitBranch, type GitBranch } from "./git-branches.ts";

const execFileAsync = promisify(execFile);

/**
 * PiHost：宿主侧的工作区进程池。
 * 一个工作区一个 `pi --mode rpc`（本机安装的 pi），只通过 RPC 通信；
 * 配置 / 软件包 / 技能的读写集中在 pi-resources.ts，桌面端不内置 Pi。
 */

export interface AttachmentItem {
  path: string;
  name: string;
  kind: "file" | "folder";
  image: boolean;
  mimeType?: string;
  data?: string;
  text?: string;
  /** 文件字节数（图片/文档都会带上，便于前端展示） */
  size?: number;
  /** false 表示内容没有内联到消息里，模型需要自己用工具读取 */
  inlined?: boolean;
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  empty: boolean;
  timestamp: number;
}

/** 跨项目列出会话时用的摘要：多带一个所属项目路径。 */
export interface CrossProjectSessionSummary extends SessionSummary {
  /** 会话所属项目目录（从会话头的 cwd 读：目录名是编码过的，反解有歧义） */
  cwd: string;
  /** 项目目录名（展示用） */
  project: string;
}

export interface WorkspaceEntry {
  path: string;
  relative: string;
  name: string;
  kind: "folder" | "file";
}

export interface WorkspaceFileData {
  path: string;
  relative: string;
  name: string;
  content: string;
  size: number;
  /** 文件内容版本，用于阻止覆盖 Agent / 外部编辑器的修改。 */
  revision?: string;
  /** 图片等二进制文件的预览内容（data URL） */
  preview?: { mimeType: string; dataUrl: string };
  /** 非文本文件：只读，不能保存 */
  binary?: boolean;
}

export interface GitStatusFile {
  /** 组合状态码，例如 "M" / "MM" / "??" */
  code: string;
  /** 暂存区状态（porcelain 第一列） */
  index: string;
  /** 工作区状态（porcelain 第二列） */
  worktree: string;
  /** 仓库内相对路径 */
  path: string;
  /** 未跟踪文件 */
  untracked: boolean;
}

export interface GitCommitNode {
  hash: string;
  shortHash: string;
  graph: string;
  subject: string;
  author: string;
  relativeTime: string;
  refs: string;
}

export interface GitOverview {
  isRepo: boolean;
  /** 仓库根目录绝对路径，非仓库为空 */
  root: string;
  branch: string;
  /** HEAD 处于游离状态 */
  detached: boolean;
  /** 上游分支，例如 origin/main */
  upstream: string;
  ahead: number;
  behind: number;
  /** 仓库是否已有提交（空仓库为 false） */
  hasCommits: boolean;
  /** 仓库根目录是否就是当前项目目录（否则禁止写操作） */
  canWrite: boolean;
  /** 是否配置了远程仓库 */
  hasRemote: boolean;
  status: GitStatusFile[];
  commits: GitCommitNode[];
  userName: string;
  userEmail: string;
  /** 默认托管隔离工作区根目录（如 ~/.pi-desktop/worktrees） */
  worktreeRoot?: string;
  /** 主仓库根目录的 8 位哈希前缀 */
  repoKey?: string;
}

export type GitActionName = "init" | "stage" | "unstage" | "commit" | "fetch" | "pull" | "push" | "switchBranch" | "createBranch" | "deleteBranch";

export interface GitActionPayload {
  /** 仓库内相对路径列表 */
  paths?: string[];
  /** 暂存全部改动 */
  all?: boolean;
  /** 提交信息 */
  message?: string;
  branch?: string;
  localName?: string;
  startPoint?: string;
  force?: boolean;
}

export interface GitActionResult {
  ok: boolean;
  message: string;
  overview: GitOverview;
}

export interface GitInspectResult {
  kind: "commit" | "working" | "staged" | "unstaged";
  target: string;
  title: string;
  subtitle: string;
  meta: string;
  diff: string;
}

export type McpExposureMode = "codemode" | "deferred" | "direct" | "hidden";

export interface McpServerItem {
  name: string;
  scope: "global" | "project";
  sourcePath: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: { provider: string };
  oauth?: Record<string, any>;
  enabled: boolean;
  exposure: McpExposureMode;
  description?: string;
  timeout?: number;
  state?: string;
  tools?: string[];
  error?: string;
  resources?: boolean;
}

export interface McpOverview {
  agentDir: string;
  globalConfigPath: string;
  projectConfigPath: string;
  autoEnableCodemode: boolean;
  servers: McpServerItem[];
  errors: string[];
}

export interface PiPackageItem {
  source: string;
  scope: "user" | "project";
  kind: "npm" | "git" | "local";
  displayName: string;
  version?: string;
  description?: string;
  installed: boolean;
  installedPath?: string;
  filtered: boolean;
  counts: {
    extensions: number;
    skills: number;
    prompts: number;
    themes: number;
  };
}

export interface PiResourceItem {
  path: string;
  name: string;
  type: "extensions" | "skills" | "prompts" | "themes";
  enabled: boolean;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string;
}

export interface PiPackagesOverview {
  agentDir: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  packages: PiPackageItem[];
  resources: PiResourceItem[];
}

export interface PiSkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  source: string;
  /** true 时只能通过 /skill:name 显式调用，不会自动注入系统提示词 */
  disableModelInvocation: boolean;
}

export interface PiSkillDirectory {
  label: string;
  path: string;
}

export interface PiSkillsOverview {
  agentDir: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  directories: PiSkillDirectory[];
  skills: PiSkillItem[];
  diagnostics: string[];
}

export interface PiHostOptions {
  emit: (payload: { cwd: string; sessionFile?: string; event: any }) => void;
  trash?: (file: string) => Promise<any>;
  /** Pi Desktop 托管的隔离工作区根目录 */
  worktreeRoot?: string;
  /**
   * 本机 Pi CLI 的 `dist/cli.js` 入口。
   * 桌面端不内置 Pi 的推理与工具执行，会话一律跑用户自己装的那份（见 docs/product-boundary.md）。
   */
  piEntry?: () => Promise<string>;
}

export type GitWorktreeMergeStrategy = "squash" | "merge" | "rebase";

export interface GitWorktree {
  path: string;
  branch: string;
  head: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** Git 的主工作区（仓库根目录） */
  primary: boolean;
  /** 由 Pi Desktop 创建、可以安全移除的隔离工作区 */
  managed: boolean;
  exists: boolean;
  /** 创建时记录的目标基础分支（合并时默认回到该分支） */
  baseBranch?: string;
  /** 创建时所基于的起点（分支名或提交短哈希） */
  baseRef?: string;
  /** 创建时的起点提交哈希 */
  baseCommit?: string;
  /** 工作区是否有未提交或未跟踪改动 */
  dirty?: boolean;
  /** 相对目标基础分支领先的提交数（待合并提交数） */
  ahead?: number;
  /** 相对目标基础分支落后的提交数 */
  behind?: number;
}

export interface GitWorktreeCreateOptions {
  /** 分支策略：create（新建分支，默认）/ existing（检出已有本地或远程分支） */
  branchMode?: "create" | "existing";
  /** 自定义分支名称（create 模式下为新分支名，如 "feat/login"；existing 检出远程分支时为本地跟踪分支名） */
  branchName?: string;
  /** existing 模式下要检出的已有分支（完整 ref 或分支名） */
  existingBranch?: string;
  /** 起点引用：本地分支、远程分支或提交哈希（省略时为当前 HEAD） */
  startPoint?: string;
  /** 合并回的目标基础分支（省略时取起点对应的本地分支或主工作区当前分支；传空字符串 "" 表示暂不绑定） */
  baseBranch?: string;
  /** 自定义 Worktree 存放的目标目录绝对路径（省略时使用默认托管目录） */
  targetDir?: string;
  /** 创建后要复制迁移到新 Worktree 的源会话文件路径（.jsonl） */
  sourceSessionFile?: string;
}

export interface GitWorktreeCreateResult {
  ok: true;
  message: string;
  worktree: GitWorktree;
  /** 当传入 sourceSessionFile 时，返回复制到新 Worktree 会话目录后的新会话文件路径 */
  sessionFile?: string;
}

export interface GitWorktreeRemoveOptions {
  /** 移除隔离工作区目录后，是否同时删除对应的本地分支 */
  deleteBranch?: boolean;
}

export interface GitWorktreeRemoveResult {
  ok: true;
  message: string;
  branch: string;
  path: string;
  branchDeleted?: boolean;
}

export interface GitWorktreeMergeOptions {
  /** 要合并的隔离工作区路径 */
  worktreePath: string;
  /** 目标本地分支（省略时使用该工作区记录的 baseBranch 或主工作区当前分支） */
  targetBranch?: string;
  /** 合并方式：squash（压缩成一个提交）/ merge（合并提交）/ rebase（变基后快进） */
  strategy?: GitWorktreeMergeStrategy;
  /** 提交说明（用于 squash 或 merge 方式；省略时自动生成） */
  message?: string;
}

export interface GitWorktreeMergeResult {
  ok: boolean;
  conflict?: boolean;
  conflicts?: string[];
  message: string;
  /** 主工作区目录（合并执行位置） */
  primaryPath: string;
  /** 隔离工作区目录 */
  worktreePath: string;
  /** 隔离工作区分支 */
  worktreeBranch: string;
  /** 合并目标分支 */
  targetBranch: string;
  /** 合并方式 */
  strategy: GitWorktreeMergeStrategy;
  /** 合并后主工作区 HEAD 短哈希 */
  commit?: string;
}

export interface GitCloneResult {
  ok: true;
  /** 克隆完成的目录（已 resolve 的绝对路径） */
  path: string;
  message: string;
}

export interface WorkerSlot {
  client: PiRpcClient;
  sessionFile: string;
  streaming: boolean;
  compacting: boolean;
  lastState?: any;
}

export interface WorkspaceClientPool {
  client: PiRpcClient;
  activeSessionFile: string;
  workers: Map<string, WorkerSlot>;
  standbySlot?: WorkerSlot | null;
  standbyPromise?: Promise<WorkerSlot | null> | null;
}

interface CachedSessionMeta {
  mtimeMs: number;
  size: number;
  summary: SessionSummary;
}

const sessionMetaCache = new Map<string, CachedSessionMeta>();

/** `@` 文件补全的目录树缓存：短时间内重复输入时不必反复遍历整个项目。 */
interface CompletionCacheEntry {
  at: number;
  entries: string[];
}
const completionCache = new Map<string, CompletionCacheEntry>();
const COMPLETION_CACHE_TTL = 2000;

function completionKey(root: string): string {
  return process.platform === "win32" ? root.toLowerCase() : root;
}

async function readHeadText(file: string, size: number, maxBytes = 128 * 1024): Promise<string> {
  if (size <= maxBytes) {
    return readFile(file, "utf8");
  }
  const handle = await openFileHandle(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function normSessionFile(file = ""): string {
  if (!file) return "";
  return process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
}

/** 与 Pi 的 getDefaultSessionDir 保持同一编码规则。 */
function sessionDir(cwd: string): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  const resolved = path.resolve(cwd);
  const encoded = `--${[...resolved].map((ch) => ("\\/:".includes(ch) ? "-" : ch)).join("").replace(/^-/, "")}--`;
  return path.join(agentDir, "sessions", encoded);
}

/** Pi 拒绝加载会话文件时的报错（会话损坏 / 不是 Pi 的 JSONL 格式）。 */
export function isBrokenSessionError(error: any): boolean {
  const text = String(error?.message ?? error ?? "");
  return /not a valid pi session|invalid session file|无法读取会话/i.test(text);
}

/** 一次最多引用几个会话：多了提示词会被撑爆，而且是同一份上下文反复计入 token。 */
const SESSION_ATTACHMENT_LIMIT = 5;

/** 会话没有命名时，用第一段用户文字当标题。 */
function firstUserTitleFromMessages(messages: any[]): string {
  for (const message of messages) {
    if (message?.role !== "user") continue;
    const content = message?.content;
    const text = Array.isArray(content)
      ? content.filter((part: any) => part?.type === "text").map((part: any) => String(part.text ?? "")).join(" ")
      : typeof content === "string" ? content : "";
    const trimmed = text.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (trimmed) return trimmed.slice(0, 40);
  }
  return "";
}

const IMAGE_MIME = new Map<string, string>([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const TEXT_EXTENSIONS = new Set<string>([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".css", ".scss", ".less", ".html", ".xml",
  ".json", ".jsonl", ".md", ".txt", ".log", ".yml", ".yaml", ".toml", ".ini", ".env", ".csv",
  ".py", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".sh", ".ps1",
]);
/** 图片仍然走 base64，超过该大小直接拒绝 */
const ATTACHMENT_IMAGE_MAX = 20 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function isProbablyText(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || !path.extname(file);
}

function workspacePath(cwd: string, relative = ""): { root: string; target: string } {
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("项目目录无效");
  const root = path.resolve(cwd);
  const target = path.resolve(root, relative || ".");
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error("路径必须位于当前项目目录内");
  return { root, target };
}

/**
 * 文件编辑器允许打开工具返回的绝对文件路径。
 *
 * 相对路径仍然严格限制在当前项目内；只有调用方明确传入绝对路径时，
 * 才允许查看/保存项目外的单个文件。目录浏览、创建、删除和 Git 操作
 * 继续使用 workspacePath，避免把项目边界整体放开。
 */
/** 图片扩展名 → MIME；文件头识别作为优先判断，扩展名只做兜底 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const TEXT_PREVIEW_MAX = 20 * 1024 * 1024;
const IMAGE_PREVIEW_MAX = 20 * 1024 * 1024;

function sniffImageMime(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 4 && head.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return "image/bmp";
  if (head.length >= 4 && head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return "image/x-icon";
  if (head.length >= 12 && head.subarray(4, 12).toString("latin1").includes("ftypavi")) return "image/avif";
  return null;
}

async function readFileHead(target: string, length = 16): Promise<Buffer> {
  const handle = await openFileHandle(target, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** 二进制文件：含 NUL 字节或无法按 UTF-8 解码 */
function looksBinary(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 8192);
  if (head.includes(0)) return true;
  // 文件比探测窗口长时，窗口末尾可能正好截断一个多字节字符。
  // Buffer.toString("utf8") 会把截断产生的 U+FFFD 当成非法字节，
  // 导致中文 Markdown / 代码在 8 KB 边界被误判为二进制。先退回完整字符边界再严格解码。
  let end = head.length;
  if (buffer.length > head.length) {
    let lead = end - 1;
    while (lead >= 0 && end - lead <= 4 && (head[lead] & 0xc0) === 0x80) lead -= 1;
    if (lead >= 0) {
      const byte = head[lead];
      const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
      if (lead + expected > end) end = lead;
    }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return false;
  } catch {
    return true;
  }
}

function workspaceFilePath(cwd: string, requested: string): { root: string; target: string; external: boolean } {
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("项目目录无效");
  if (typeof requested !== "string" || !requested.trim()) throw new Error("文件路径无效");
  const root = path.resolve(cwd);
  const raw = requested.trim();
  if (path.isAbsolute(raw)) return { root, target: path.resolve(raw), external: true };
  const resolved = workspacePath(cwd, raw);
  return { ...resolved, external: false };
}

async function assertReadableFilePath(
  cwd: string,
  target: string,
  external: boolean,
): Promise<void> {
  if (external) {
    try {
      await realpath(target);
    } catch {
      throw new Error("文件不存在或无法访问");
    }
    return;
  }
  await assertRealWorkspacePath(cwd, target);
}

async function assertRealWorkspacePath(cwd: string, target: string, allowMissing = false): Promise<void> {
  const { root } = workspacePath(cwd, ".");
  const realRoot = await realpath(root);
  let candidate = target;
  while (true) {
    try {
      candidate = await realpath(candidate);
      break;
    } catch {
      if (!allowMissing) throw new Error("路径不存在或无法访问");
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new Error("路径不存在或无法访问");
      candidate = parent;
    }
  }
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (candidate !== realRoot && !candidate.startsWith(prefix)) {
    throw new Error("路径必须位于当前项目目录内");
  }
}

async function walkDirectory(root: string, current = root, output: string[] = [], limit = 400): Promise<string[]> {
  if (output.length >= limit) return output;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await readdir(current, { withFileTypes: true }); } catch { return output; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi" || entry.name === ".pi-desktop") continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      output.push(`${path.relative(root, full)}\\`);
      await walkDirectory(root, full, output, limit);
    } else {
      output.push(path.relative(root, full));
    }
  }
  return output;
}

async function prepareAttachment(_cwd: string, target: string): Promise<AttachmentItem> {
  const file = path.resolve(target);
  const info: AttachmentItem = { path: file, name: path.basename(file), kind: "file", image: false };
  let entry;
  try { entry = await lstat(file); } catch { throw new Error(`找不到附件：${file}`); }
  if (entry.isDirectory()) {
    info.kind = "folder";
    const listing = await walkDirectory(file);
    info.text = `<directory name="${escapeXml(file)}">\n${listing.join("\n")}\n</directory>\n`;
    return info;
  }
  if (!entry.isFile()) throw new Error(`不支持添加此类型的路径：${file}`);
  const size = (await stat(file)).size;
  info.size = size;
  const mime = IMAGE_MIME.get(path.extname(file).toLowerCase());
  if (mime) {
    if (size > ATTACHMENT_IMAGE_MAX) throw new Error(`图片超过 20 MB：${path.basename(file)}`);
    const data = (await readFile(file)).toString("base64");
    info.image = true;
    info.mimeType = mime;
    info.data = data;
    info.text = `<file name="${escapeXml(file)}"></file>\n`;
    return info;
  }
  // 所有文件都只传路径，不再读取/内联内容：
  // 即使是不大的文本文件，内联内容也会随每条消息反复进入上下文，长会话里很快就会撑爆。
  // 模型需要时用 read 工具按需读取，大文件还能分段读。
  info.inlined = false;
  const hint = isProbablyText(file)
    ? `[已通过路径引用（${formatBytes(size)}），未内联文件内容。需要时请使用 read 工具读取该文件。]`
    : `[二进制文件（${formatBytes(size)}），未内联。请使用相应工具读取或处理。]`;
  info.text = `<file name="${escapeXml(file)}" size="${size}" inline="false">\n${hint}\n</file>\n`;
  return info;
}

/** 当前分支：向上查找 .git（兼容 worktree 的 gitdir 文件），只读 HEAD，不调用 git。 */
export async function gitBranch(cwd: string): Promise<string> {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 32; depth += 1) {
    const dotGit = path.join(dir, ".git");
    try {
      let gitDir = dotGit;
      if ((await stat(dotGit)).isFile()) {
        const ref = (await readFile(dotGit, "utf8")).match(/gitdir:\s*(.+)/)?.[1]?.trim();
        if (!ref) return "";
        gitDir = path.resolve(dir, ref);
      }
      const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
      const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return match ? match[1] : head.slice(0, 7);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return "";
      dir = parent;
    }
  }
  return "";
}

/** 把 git 命令失败转换成可以直接展示给用户的中文错误。 */
function gitError(error: unknown): Error {
  const e = error as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string; code?: string };
  if (e?.code === "ENOENT") return new Error("未检测到 git 命令，请先安装 Git 并加入 PATH");
  const raw = `${e?.stderr ?? ""}\n${e?.stdout ?? ""}`.trim();
  if (raw) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return new Error(lines.slice(-8).join("\n") || raw);
  }
  return new Error(e?.message ?? String(error));
}

async function gitRun(cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer,
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return stdout;
  } catch (error) {
    throw gitError(error);
  }
}

/** 失败时返回空字符串：用于探测类命令（上游分支、用户配置等）。 */
async function gitProbe(cwd: string, args: string[]): Promise<string> {
  try {
    return await gitRun(cwd, args, 1024 * 1024);
  } catch {
    return "";
  }
}

/** 仓库根目录；不是仓库时返回空字符串。 */
async function gitRepoRoot(cwd: string): Promise<string> {
  const top = (await gitProbe(path.resolve(cwd), ["rev-parse", "--show-toplevel"])).trim();
  return top ? await realpath(path.resolve(top)) : "";
}

function samePath(a: string, b: string): boolean {
  const norm = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

/** 判断 child 是否严格位于 parent 目录内（不含 parent 自身）。 */
function pathWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** 把用户输入的任务名变成可用的分支名 / 目录名。 */
function worktreeSlug(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.lock$/i, "")
    .slice(0, 40)
    .replace(/^[._-]+|[._-]+$/g, "");
}

function parseWorktreeList(stdout: string): Array<Omit<GitWorktree, "primary" | "managed" | "exists">> {
  const items: Array<Omit<GitWorktree, "primary" | "managed" | "exists">> = [];
  let current: Omit<GitWorktree, "primary" | "managed" | "exists"> | null = null;
  const flush = () => {
    if (current) items.push(current);
    current = null;
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      flush();
      current = {
        path: path.resolve(line.slice("worktree ".length)),
        branch: "",
        head: "",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length).trim();
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  flush();
  return items;
}

/** 解析 `git status --porcelain=v1` 输出。 */
function parseGitStatus(stdout: string): GitStatusFile[] {
  const files: GitStatusFile[] = [];
  const entries = stdout.split("\0");
  for (let n = 0; n < entries.length; n++) {
    const line = entries[n];
    if (!line) continue;
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const target = line.slice(3);
    // -z 模式不引用 / 转义路径，重命名先输出新路径，再输出旧路径。
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") n++;
    if (!target) continue;
    files.push({
      code: `${index}${worktree}`.trim() || "M",
      index,
      worktree,
      path: target.replace(/\\/g, "/"),
      untracked: index === "?" && worktree === "?",
    });
  }
  return files;
}

/** 校验并归一化 git 操作的文件路径，拒绝绝对路径与越界路径。 */
function gitOperationPaths(root: string, paths: unknown): string[] {
  const list = Array.isArray(paths) ? paths : [];
  const output: string[] = [];
  for (const raw of list) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (path.isAbsolute(value)) throw new Error("Git 操作只接受仓库内的相对路径");
    const resolved = path.resolve(root, value);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("路径必须位于当前项目目录内");
    }
    output.push(relative.split(path.sep).join("/"));
  }
  if (!output.length) throw new Error("请先选择要操作的文件");
  return [...new Set(output)];
}

/** 只允许操作该项目会话目录里的 .jsonl，防止渲染进程传入任意路径 */
/** 启动 Pi 的上限：worker 卡住时不能把界面永远留在「启动中」。 */
const START_TIMEOUT_MS = 25_000;
/** 启动后读取快照的上限：RPC 挂起时同样要能失败、能重试。 */
const SNAPSHOT_TIMEOUT_MS = 15_000;

/** 给 Promise 加上限，超时抛错；原始错误照常透传。 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    (timer as any).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 侧栏显示的是「最近活动」：一直在这个会话里聊，就必须是刚刚，
 * 而不是建会话那天的日期。文件 mtime 会随每次追加更新，取两者较大值。
 */
export function sessionTimestamp(headerTimestamp: unknown, mtimeMs: number): number {
  const parsed = typeof headerTimestamp === "string" ? Date.parse(headerTimestamp) : Number.NaN;
  const header = Number.isFinite(parsed) ? parsed : 0;
  return Math.max(header, Math.round(mtimeMs));
}

const normalizePath = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));

/** 会话（含子代理会话）统一放在 <agentDir>/sessions 下。 */
function agentSessionsRoot(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  return normalizePath(path.join(agentDir, "sessions")) + path.sep;
}

/** 删除等写操作只允许该项目自己的会话文件。 */
function assertSessionFile(cwd: string, file: string): string {
  const dir = normalizePath(sessionDir(cwd)) + path.sep;
  if (typeof file !== "string" || !file.endsWith(".jsonl") || !normalizePath(file).startsWith(dir)) {
    throw new Error("只能删除该项目自己的会话文件");
  }
  return path.resolve(file);
}

/**
 * 读取历史时放宽到整个会话根目录：子代理把自己的会话放在
 * <agentDir>/sessions/<父项目>/<会话>/<runId>/run-0/session.jsonl，
 * 在 worktree 里运行时还可能落在别的项目目录下。
 */
function assertReadableSessionFile(cwd: string, file: string): string {
  const dir = normalizePath(sessionDir(cwd)) + path.sep;
  if (typeof file !== "string" || !file.endsWith(".jsonl")) throw new Error("只能读取会话文件");
  const target = normalizePath(file);
  if (!target.startsWith(dir) && !target.startsWith(agentSessionsRoot())) {
    throw new Error("只能读取会话目录下的记录");
  }
  return path.resolve(file);
}

/**
 * 将源会话文件（.jsonl）克隆到目标工作区（例如新建的 Git Worktree）的会话目录中，
 * 同时更新首行 session 头的 cwd、id 与 timestamp，使目标工作区打开时可直接加载完整对话上下文。
 */
async function cloneSessionToWorkspace(srcFile: string, targetCwd: string): Promise<string> {
  const raw = await readFile(srcFile, "utf8");
  const lines = raw.split(/\r?\n/);
  const nowIso = new Date().toISOString();
  const newId = randomUUID();
  if (lines.length > 0 && lines[0]!.trim()) {
    try {
      const head = JSON.parse(lines[0]!);
      if (head && typeof head === "object" && head.type === "session") {
        head.cwd = targetCwd;
        head.id = newId;
        head.timestamp = nowIso;
        lines[0] = JSON.stringify(head);
      }
    } catch {
      // 保持原样
    }
  }
  const destDir = sessionDir(targetCwd);
  await mkdir(destDir, { recursive: true });
  const fileName = `${nowIso.replace(/[:.]/g, "-")}_${newId}.jsonl`;
  const destFile = path.join(destDir, fileName);
  const content = lines.join("\n").endsWith("\n") ? lines.join("\n") : `${lines.join("\n")}\n`;
  await atomicWriteText(destFile, content);
  return destFile;
}

export async function listSessions(cwd: string, keepFile: string | Iterable<string> = ""): Promise<SessionSummary[]> {
  const dir = sessionDir(cwd);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const keepSet = new Set<string>(
    (typeof keepFile === "string" ? (keepFile ? [keepFile] : []) : [...keepFile].filter(Boolean)).map((f) => normSessionFile(f)),
  );
  const items = await Promise.all(
    names.map(async (name): Promise<SessionSummary | null> => {
      // 解析逻辑在 summarizeSessionFile 里（标题 / 空会话 / 最近活动时间同源）。
      const summary = await summarizeSessionFile(path.join(dir, name));
      return summary ? { id: summary.id, path: summary.path, title: summary.title, empty: summary.empty, timestamp: summary.timestamp } : null;
    }),
  );
  return items
    .filter((item): item is SessionSummary => Boolean(item && (!item.empty || keepSet.has(normSessionFile(item.path)))))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 单个会话文件 → 摘要（标题 / 是否空 / 最近活动时间 / 所属项目）。
 * listSessions 与「跨项目引用对话」共用，避免两套解析逻辑各自漂移。
 */
async function summarizeSessionFile(file: string): Promise<CrossProjectSessionSummary | null> {
  const cacheKey = normSessionFile(file);
  try {
    const info = await stat(file);
    const cached = sessionMetaCache.get(cacheKey);
    const rawText = await readHeadText(file, info.size);
    const lines = rawText.split(/\r?\n/);
    let head: Record<string, any> = {};
    try { head = JSON.parse(lines[0] || "{}"); } catch { head = {}; }
    const projectOf = (value: unknown) => (typeof value === "string" ? path.basename(value) || value : "");
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return { ...cached.summary, cwd: typeof head.cwd === "string" ? head.cwd : "", project: projectOf(head.cwd) };
    }
    const title = firstUserTitle(lines);
    const customTitle = await readSessionName(file, info.size, head.name);
    const summary: SessionSummary = {
      id: file,
      path: file,
      title: customTitle || title || "新会话",
      empty: !customTitle && !title,
      timestamp: sessionTimestamp(head.timestamp, info.mtimeMs),
    };
    sessionMetaCache.set(cacheKey, { mtimeMs: info.mtimeMs, size: info.size, summary });
    return { ...summary, cwd: typeof head.cwd === "string" ? head.cwd : "", project: projectOf(head.cwd) };
  } catch {
    sessionMetaCache.delete(cacheKey);
    return null;
  }
}

/** 跨项目会话列表的短暂缓存：输入 @ 时会反复查询，别每次都扫目录。 */
const crossProjectCache = new Map<string, { at: number; items: CrossProjectSessionSummary[] }>();
const CROSS_PROJECT_TTL_MS = 3000;

/**
 * 列出所有项目的会话（「@ 引用其它项目对话」用）。
 *
 * 会话目录是 `<agentDir>/sessions/<编码过的项目路径>/<会话文件>`。
 * 每个项目只取最近几个会话再合并排序：用户可能有几百个项目目录，
 * 全扫一遍会把「输入 @」变成卡顿源。
 */
export async function listCrossProjectSessions(limit = 40): Promise<CrossProjectSessionSummary[]> {
  const root = agentSessionsRoot();
  const cached = crossProjectCache.get(root);
  if (cached && Date.now() - cached.at < CROSS_PROJECT_TTL_MS) return cached.items.slice(0, limit);

  let dirs: string[] = [];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  const picked: Array<{ file: string; mtimeMs: number }> = [];
  for (const dir of dirs) {
    const files = await readdir(path.join(root, dir)).catch(() => [] as string[]);
    const stats = await Promise.all(
      files
        .filter((name) => name.endsWith(".jsonl"))
        .map(async (name) => {
          const file = path.join(root, dir, name);
          const info = await stat(file).catch(() => null);
          return info?.isFile() ? { file, mtimeMs: info.mtimeMs } : null;
        }),
    );
    picked.push(
      ...stats
        .filter((item): item is { file: string; mtimeMs: number } => Boolean(item))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 4),
    );
  }
  picked.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const items: CrossProjectSessionSummary[] = [];
  let index = 0;
  for (const candidate of picked.slice(0, limit)) {
    const summary = await summarizeSessionFile(candidate.file);
    if (summary && !summary.empty) items.push(summary);
    // 每解析几个就让出一次事件循环：解析是同步的（读头 + 找名称 + 解析 JSON），
    // 一次性连做几十个会让主线程连续阻塞上百毫秒到一秒多（实测 5 个会话 700ms）。
    index += 1;
    if (index % 3 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  crossProjectCache.set(root, { at: Date.now(), items });
  return items;
}

/** 只有缓存与文件当前 mtime/size 完全一致时才认为是空会话，避免误删刚写入消息的会话。 */
async function isKnownEmptySession(file: string): Promise<boolean> {
  const cached = sessionMetaCache.get(normSessionFile(file));
  if (!cached?.summary.empty) return false;
  try {
    const info = await stat(file);
    return info.mtimeMs === cached.mtimeMs && info.size === cached.size;
  } catch {
    return false;
  }
}

export class PiHost {
  emit: (payload: { cwd: string; sessionFile?: string; event: any }) => void;
  trash: (file: string) => Promise<any>;
  clients: Map<string, WorkspaceClientPool>;
  starting: Map<string, Promise<void>>;
  maxIdleWorkers: number;
  worktreeRoot: string;
  private authorizedAttachmentPaths = new Set<string>();
  private authorizedWorkspaces = new Map<string, string>();
  /** 每个工作区的启动尝试序号：超时后递增，让半启动的 start() 结果失效。 */
  private startAttempts = new Map<string, number>();
  private closing = false;

  /** 本机 pi 入口的解析器（主进程注入），解析结果缓存到 piEntryCache */
  private piEntryResolver?: () => Promise<string>;
  private piEntryCache = "";

  constructor({ emit, trash, worktreeRoot, piEntry }: PiHostOptions) {
    this.emit = emit;
    this.trash = trash ?? ((file: string) => unlink(file));
    this.clients = new Map();
    this.starting = new Map();
    this.maxIdleWorkers = 3;
    this.worktreeRoot = path.resolve(worktreeRoot ?? path.join(homedir(), ".pi-desktop", "worktrees"));
    this.piEntryResolver = piEntry;
  }

  /** 设置里换了 Pi 路径、或刚更新完 Pi 之后调用：下次启动 worker 时重新解析。 */
  invalidatePiEntry(): void {
    this.piEntryCache = "";
  }

  /** 本机 Pi CLI 的 JS 入口；找不到就抛中文错误（界面据此提示安装或指定路径）。 */
  async piEntry(): Promise<string> {
    if (this.piEntryCache) return this.piEntryCache;
    if (!this.piEntryResolver) throw new Error("没有配置本机 Pi 入口解析器");
    const entry = await this.piEntryResolver();
    if (!entry) throw new Error("没有找到本机 Pi CLI，请先安装 pi 或到「设置 → Pi CLI」指定路径");
    this.piEntryCache = entry;
    log.pi("info", "worker", `使用本机 pi：${entry}`);
    return entry;
  }

  private workspaceKey(cwd: string): string {
    const resolved = path.resolve(cwd);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  async authorizeWorkspace(cwd: string): Promise<string> {
    if (typeof cwd !== "string" || !cwd.trim()) throw new Error("项目目录无效");
    const canonical = await realpath(path.resolve(cwd));
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("项目目录无效");
    this.authorizedWorkspaces.set(this.workspaceKey(canonical), canonical);
    return canonical;
  }

  async requireAuthorizedWorkspace(cwd: string): Promise<string> {
    if (typeof cwd !== "string" || !cwd.trim()) throw new Error("项目目录无效");
    const canonical = await realpath(path.resolve(cwd));
    const registered = this.authorizedWorkspaces.get(this.workspaceKey(canonical));
    if (!registered) throw new Error("项目目录尚未获得授权");
    return registered;
  }

  revokeWorkspace(cwd: string): void {
    if (typeof cwd === "string" && cwd.trim()) this.authorizedWorkspaces.delete(this.workspaceKey(cwd));
  }

  private resolvePoolKey(cwd: string): string {
    if (this.clients.has(cwd) || this.starting.has(cwd)) return cwd;
    const registered = this.authorizedWorkspaces.get(this.workspaceKey(cwd));
    if (registered && (this.clients.has(registered) || this.starting.has(registered))) {
      return registered;
    }
    for (const key of this.clients.keys()) {
      if (samePath(key, cwd)) return key;
    }
    for (const key of this.starting.keys()) {
      if (samePath(key, cwd)) return key;
    }
    return registered ?? cwd;
  }

  /** @param timeoutMs 启动等待上限（测试可传更小的值） */
  async open(cwd: string, timeoutMs = START_TIMEOUT_MS) {
    if (this.closing) throw new Error("Pi 宿主正在关闭");
    const authorized = await this.requireAuthorizedWorkspace(cwd);
    cwd = authorized;
    if (!this.clients.has(cwd)) {
      // 只读当前尝试序号：只有超时才递增它（见下面的 catch），
      // 否则并发的第二次 open() 会把正在进行的启动判成过期。
      const attempt = this.startAttempts.get(cwd) ?? 0;
      let tracked = this.starting.get(cwd);
      if (!tracked) {
        let self: Promise<void>;
        const pending = this.start(cwd, attempt);
        self = pending.finally(() => {
          // 只有自己还是当前记录时才清理：超时后重新发起的那次不能被旧记录删掉。
          if (this.starting.get(cwd) === self) this.starting.delete(cwd);
        });
        tracked = self;
        this.starting.set(cwd, self);
      }
      try {
        await withTimeout(
          tracked,
          timeoutMs,
          `启动 Pi 超时（${timeoutMs / 1000}s）：会话进程没有响应，请重试`,
        );
      } catch (error) {
        // 这次启动作废：让仍在进行的 start() 自己收尾，并把可能半启动的 worker 清掉，
        // 否则下一次重试会复用一个卡住的进程。
        this.startAttempts.set(cwd, attempt + 1);
        if (this.starting.get(cwd) === tracked) this.starting.delete(cwd);
        await this.discardWorkspace(cwd).catch(() => {});
        throw error;
      }
    }
    return withTimeout(this.snapshot(cwd), SNAPSHOT_TIMEOUT_MS, "读取会话状态超时，请重试");
  }

  /**
   * 会话文件读不出来（损坏 / 被别的工具改成非 Pi 格式）时，worker 会停在
   * 半切换状态：后续每个调用都会继续报错，界面表现成「这个工作区还没有启动 Pi」。
   * 这里把这一槽 worker 丢掉，工作区保持可用，用户换一个会话即可继续。
   */
  private async discardBrokenSlot(cwd: string, client: any): Promise<void> {
    cwd = this.resolvePoolKey(cwd);
    const pool = this.clients.get(cwd);
    if (!pool) return;
    for (const [key, slot] of [...pool.workers.entries()]) {
      if (slot.client !== client) continue;
      pool.workers.delete(key);
      if (pool.client === client) pool.client = [...pool.workers.values()][0]?.client ?? pool.client;
    }
    await client.stop().catch(() => {});
  }

  /** 只清掉这个工作区的 worker，不等待可能还挂着的启动流程。 */
  private async discardWorkspace(cwd: string): Promise<void> {
    cwd = this.resolvePoolKey(cwd);
    const pool = this.clients.get(cwd);
    if (!pool) return;
    log.pi("warn", "worker", `丢弃工作区 worker：${cwd}`);
    this.clients.delete(cwd);
    await this.disposeStandby(pool).catch(() => {});
    const clients = [...pool.workers.values()].map((slot) => slot.client);
    pool.workers.clear();
    await Promise.allSettled(clients.map((client) => client.stop()));
  }

  private async spawnWorker(
    cwd: string,
    pool: WorkspaceClientPool,
    options: { targetSessionFile?: string; pickLatestOnInit?: boolean; parentSession?: string } = {},
  ): Promise<WorkerSlot> {
    const client = new PiRpcClient({ entry: await this.piEntry(), cwd });
    const slot: WorkerSlot = {
      client,
      sessionFile: "",
      streaming: false,
      compacting: false,
    };

    client.onEvent((event: any) => {
      if (event?.type === "agent_start") slot.streaming = true;
      else if (event?.type === "agent_settled") {
        slot.streaming = false;
        this.pruneIdleWorkers(pool);
      } else if (event?.type === "compaction_start") {
        slot.compacting = true;
        log.pi("info", "compaction", `开始压缩上下文 ${path.basename(slot.sessionFile || cwd)}`);
      } else if (event?.type === "compaction_end") {
        slot.compacting = false;
        this.pruneIdleWorkers(pool);
        log.pi("info", "compaction", `压缩结束 ${path.basename(slot.sessionFile || cwd)}`);
      }
      // Startup events can arrive before getState establishes the session identity.
      // Do not route an unowned event to the renderer's currently active session.
      if (slot.sessionFile) this.emit({ cwd, sessionFile: slot.sessionFile, event });
    });

    try {
      await client.start();
      let state = await client.getState();
      const initialFile = state.sessionFile ?? "";
      log.pi("info", "worker", `已启动 ${cwd} · ${path.basename(state.sessionFile || "(新会话)")}`);

      if (options.targetSessionFile) {
        if (normSessionFile(initialFile) !== normSessionFile(options.targetSessionFile)) {
          // 目标会话文件坏了（损坏 / 是别的工具写的）：不要因此打不开项目，
          // 先用刚启动的新会话，用户可以在会话列表里换一个。
          const switched = await client.switchSession(options.targetSessionFile).catch((error: any) => {
            if (!isBrokenSessionError(error)) throw error;
            log.warn("session", `会话文件无法加载，改用新会话：${path.basename(options.targetSessionFile!)}`);
            logPerfLine(`会话文件无法加载，改用新会话：${path.basename(options.targetSessionFile!)}`);
            return null;
          });
          if (switched?.cancelled) throw new Error("会话切换已取消");
          if (switched && initialFile && state.messageCount === 0 && normSessionFile(initialFile) !== normSessionFile(state.sessionFile ?? "")) {
            await unlink(initialFile).catch(() => {});
          }
          state = await client.getState();
        }
      } else if (options.parentSession) {
        const created = await client.newSession(options.parentSession);
        if (created?.cancelled) throw new Error("新建会话已取消");
        if (initialFile && state.messageCount === 0) {
          await unlink(initialFile).catch(() => {});
        }
        state = await client.getState();
      } else if (options.pickLatestOnInit) {
        const history = await listSessions(cwd, state.sessionFile);
        const latest = history.find((item) => !item.empty && item.path !== state.sessionFile);
        if (latest && state.messageCount === 0) {
          try {
            const switched = await client.switchSession(latest.path);
            if (!switched?.cancelled) {
              if (initialFile) await unlink(initialFile).catch(() => {});
              state = await client.getState();
            }
          } catch {
            // 保持当前会话
          }
        }
      }

      slot.sessionFile = state.sessionFile ?? "";
      slot.streaming = Boolean(state.isStreaming);
      slot.compacting = Boolean(state.isCompacting);
      slot.lastState = state;
      if (slot.sessionFile) {
        pool.workers.set(normSessionFile(slot.sessionFile), slot);
      }
      pool.client = slot.client;
      pool.activeSessionFile = slot.sessionFile;
      this.pruneIdleWorkers(pool);
      return slot;
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  }

  private warmStandbyWorker(cwd: string, pool: WorkspaceClientPool): void {
    if (pool.standbySlot || pool.standbyPromise) return;
    const promise = (async (): Promise<WorkerSlot | null> => {
      const client = new PiRpcClient({ entry: await this.piEntry(), cwd });
      const slot: WorkerSlot = {
        client,
        sessionFile: "",
        streaming: false,
        compacting: false,
      };
      client.onEvent((event: any) => {
        if (event?.type === "agent_start") slot.streaming = true;
        else if (event?.type === "agent_settled") {
          slot.streaming = false;
          this.pruneIdleWorkers(pool);
        } else if (event?.type === "compaction_start") slot.compacting = true;
        else if (event?.type === "compaction_end") {
          slot.compacting = false;
          this.pruneIdleWorkers(pool);
        }
        if (slot.sessionFile) {
          this.emit({ cwd, sessionFile: slot.sessionFile, event });
        }
      });
      try {
        await client.start();
        const state = await client.getState();
        if (this.clients.get(cwd) !== pool) {
          if (state.sessionFile && state.messageCount === 0) {
            await unlink(state.sessionFile).catch(() => {});
          }
          await client.stop().catch(() => {});
          return null;
        }
        slot.sessionFile = state.sessionFile ?? "";
        slot.streaming = Boolean(state.isStreaming);
        slot.compacting = Boolean(state.isCompacting);
        slot.lastState = state;
        pool.standbySlot = slot;
        return slot;
      } catch {
        await client.stop().catch(() => {});
        return null;
      } finally {
        if (pool.standbyPromise === promise) {
          pool.standbyPromise = null;
        }
      }
    })();
    pool.standbyPromise = promise;
  }

  private async claimStandbyWorker(pool: WorkspaceClientPool): Promise<WorkerSlot | null> {
    if (!pool.standbySlot && pool.standbyPromise) {
      await pool.standbyPromise.catch(() => null);
    }
    const slot = pool.standbySlot ?? null;
    if (!slot) return null;
    pool.standbySlot = null;
    return slot;
  }

  private async disposeStandby(pool: WorkspaceClientPool): Promise<void> {
    if (pool.standbyPromise) {
      await pool.standbyPromise.catch(() => null);
    }
    const slot = pool.standbySlot;
    pool.standbySlot = null;
    if (slot) {
      if (slot.sessionFile) {
        await unlink(slot.sessionFile).catch(() => {});
      }
      await slot.client.stop().catch(() => {});
    }
  }

  private getWorkerStates(pool: WorkspaceClientPool) {
    return [...pool.workers.values()].map((w) => ({
      sessionFile: w.sessionFile,
      streaming: w.streaming,
      compacting: w.compacting,
    }));
  }

  private findIdleSlot(pool: WorkspaceClientPool): WorkerSlot | null {
    const activeKey = normSessionFile(pool.activeSessionFile);
    const activeSlot = pool.workers.get(activeKey);
    if (activeSlot && !activeSlot.streaming && !activeSlot.compacting) {
      return activeSlot;
    }
    for (const slot of pool.workers.values()) {
      if (!slot.streaming && !slot.compacting) return slot;
    }
    return null;
  }

  private pruneIdleWorkers(pool: WorkspaceClientPool, maxIdle = this.maxIdleWorkers): void {
    const activeKey = normSessionFile(pool.activeSessionFile);
    const idleSlots = [...pool.workers.entries()].filter(
      ([key, slot]) => key !== activeKey && !slot.streaming && !slot.compacting,
    );
    while (idleSlots.length > maxIdle) {
      const oldest = idleSlots.shift();
      if (!oldest) break;
      const [key, slot] = oldest;
      pool.workers.delete(key);
      if (pool.client === slot.client) {
        pool.client = pool.workers.get(activeKey)?.client ?? pool.client;
      }
      slot.client.stop().catch(() => {});
    }
  }

  async start(cwd: string, attempt = this.startAttempts.get(cwd) ?? 0): Promise<void> {
    const pool: WorkspaceClientPool = {
      client: null as unknown as PiRpcClient,
      activeSessionFile: "",
      workers: new Map(),
    };
    await this.spawnWorker(cwd, pool, { pickLatestOnInit: true });
    // 启动期间已经被判超时（attempt 变了）：别把这个 worker 留在内存里。
    if ((this.startAttempts.get(cwd) ?? 0) !== attempt) {
      const clients = [...pool.workers.values()].map((slot) => slot.client);
      pool.workers.clear();
      await Promise.allSettled(clients.map((client) => client.stop()));
      throw new Error("启动已取消");
    }
    this.clients.set(cwd, pool);
  }

  async listDirectory(cwd: string, relative = ""): Promise<WorkspaceEntry[]> {
    const { root, target } = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, target);
    let info;
    try { info = await lstat(target); } catch { throw new Error("目录不存在或无法访问"); }
    if (!info.isDirectory()) throw new Error("只能查看目录内容");

    let entries;
    try { entries = await readdir(target, { withFileTypes: true }); } catch { throw new Error("无法读取目录内容"); }
    const result: WorkspaceEntry[] = [];
    for (const entry of entries) {
      // .pi-desktop 是应用自己的目录（日志等），不该出现在项目文件树里
      if (entry.name === ".git" || entry.name === ".pi" || entry.name === ".pi-desktop" || entry.name === "node_modules") continue;
      const absolute = path.join(target, entry.name);
      let entryInfo;
      try { entryInfo = await lstat(absolute); } catch { continue; }
      if (entryInfo.isSymbolicLink()) continue;
      const kind = entryInfo.isDirectory() ? "folder" : entryInfo.isFile() ? "file" : "other";
      if (kind === "other") continue;
      const childRelative = path.relative(root, absolute).replace(/\\/g, "/");
      result.push({ path: absolute, relative: childRelative, name: entry.name, kind });
    }
    return result.sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  async readWorkspaceFile(cwd: string, relative: string): Promise<WorkspaceFileData> {
    const resolved = workspaceFilePath(cwd, relative);
    await assertReadableFilePath(cwd, resolved.target, resolved.external);
    const { root, target } = resolved;
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法打开");
    const pathInfo = {
      path: target,
      relative: resolved.external ? target : path.relative(root, target).replace(/\\/g, "/"),
      name: path.basename(target),
      size: info.size,
    };

    // 图片直接返回 data URL，前端渲染预览，避免把二进制当文本显示
    const head = await readFileHead(target);
    const mime = sniffImageMime(head) ?? IMAGE_MIME_BY_EXT[path.extname(target).toLowerCase()] ?? null;
    if (mime) {
      if (info.size > IMAGE_PREVIEW_MAX) throw new Error("图片超过 20 MB，暂不支持在桌面端预览，可使用系统程序打开");
      const buffer = await readFile(target);
      return {
        ...pathInfo,
        content: "",
        binary: true,
        preview: { mimeType: mime, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` },
      };
    }

    if (info.size > TEXT_PREVIEW_MAX) throw new Error("文件超过 20 MB，暂不支持在桌面端预览，可使用系统程序打开");
    const buffer = await readFile(target);
    if (looksBinary(buffer)) return { ...pathInfo, content: "", binary: true };
    return { ...pathInfo, content: buffer.toString("utf8"), revision: createHash("sha256").update(buffer).digest("hex") };
  }

  async writeWorkspaceFile(cwd: string, relative: string, content: string, expectedRevision?: string): Promise<WorkspaceFileData> {
    const resolved = workspaceFilePath(cwd, relative);
    const { root, target } = resolved;
    if (typeof content !== "string") throw new Error("文件内容必须是文本");
    if (Buffer.byteLength(content, "utf8") > TEXT_PREVIEW_MAX) throw new Error("文件超过 20 MB，暂不支持保存");
    return withFileWrite(target, async () => {
      await assertReadableFilePath(cwd, target, resolved.external);
      const info = await lstat(target).catch(() => null);
      if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法修改");
      if (info.size > TEXT_PREVIEW_MAX) throw new Error("文件超过 20 MB，暂不支持保存");
      const previous = await readFile(target);
      if ((sniffImageMime(previous) ?? IMAGE_MIME_BY_EXT[path.extname(target).toLowerCase()]) || looksBinary(previous)) {
        throw new Error("图片等二进制文件不支持在文本编辑器中保存");
      }
      const revision = createHash("sha256").update(previous).digest("hex");
      if (expectedRevision !== undefined && revision !== expectedRevision) {
        throw new Error("文件已被外部程序或 Agent 修改，已阻止覆盖；请保留草稿并重新读取后合并修改");
      }
      await atomicWriteText(target, content);
      return {
        path: target,
        relative: resolved.external ? target : path.relative(root, target).replace(/\\/g, "/"),
        name: path.basename(target),
        content,
        size: Buffer.byteLength(content, "utf8"),
        revision: createHash("sha256").update(content, "utf8").digest("hex"),
      };
    });
  }
  async openWorkspacePath(cwd: string, relative: string): Promise<string> {
    const resolved = workspaceFilePath(cwd, relative);
    await assertReadableFilePath(cwd, resolved.target, resolved.external);
    const { target } = resolved;
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法打开");
    return target;
  }

  /** 名称只能是当前目录下的一段，不允许路径分隔符。 */
  private async entryName(cwd: string, parent: string, name: string): Promise<{ root: string; target: string }> {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
      throw new Error("名称不能为空，也不能包含路径分隔符");
    }
    const relative = parent ? `${parent.replace(/[\\/]+$/, "")}/${trimmed}` : trimmed;
    const resolved = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, path.dirname(resolved.target));
    const info = await lstat(resolved.target).catch(() => null);
    if (info) throw new Error(`已存在同名项：${trimmed}`);
    return resolved;
  }

  async createWorkspaceEntry(
    cwd: string,
    parent: string,
    name: string,
    kind: "file" | "folder",
  ): Promise<WorkspaceEntry> {
    const { root, target } = await this.entryName(cwd, parent, name);
    const parentInfo = await lstat(path.dirname(target)).catch(() => null);
    if (!parentInfo || !parentInfo.isDirectory()) throw new Error("目标目录不存在");
    if (kind === "folder") await mkdir(target);
    else await writeFile(target, "", { encoding: "utf8", flag: "wx" });
    completionCache.delete(completionKey(path.resolve(cwd)));
    return {
      path: target,
      relative: path.relative(root, target).replace(/\\/g, "/"),
      name: path.basename(target),
      kind,
    };
  }

  async renameWorkspaceEntry(cwd: string, relative: string, name: string): Promise<WorkspaceEntry> {
    const current = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, current.target);
    const info = await lstat(current.target).catch(() => null);
    if (!info || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      throw new Error("项目不存在或无法重命名");
    }
    const parent = path.relative(current.root, path.dirname(current.target)).replace(/\\/g, "/");
    const next = await this.entryName(cwd, parent === "." ? "" : parent, name);
    await rename(current.target, next.target);
    completionCache.delete(completionKey(path.resolve(cwd)));
    return {
      path: next.target,
      relative: path.relative(next.root, next.target).replace(/\\/g, "/"),
      name: path.basename(next.target),
      kind: info.isDirectory() ? "folder" : "file",
    };
  }

  async deleteWorkspaceEntry(cwd: string, relative: string): Promise<void> {
    const { root, target } = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, target);
    if (target === root) throw new Error("不能删除项目根目录");
    const info = await lstat(target).catch(() => null);
    if (!info || info.isSymbolicLink()) throw new Error("项目不存在或无法删除");
    await this.trash(target);
    completionCache.delete(completionKey(path.resolve(cwd)));
  }

  async gitOverview(cwd: string): Promise<GitOverview> {
    const workspace = await realpath(path.resolve(cwd));
    await assertRealWorkspacePath(cwd, workspace);
    const empty: GitOverview = {
      isRepo: false,
      root: "",
      branch: "",
      detached: false,
      upstream: "",
      ahead: 0,
      behind: 0,
      hasCommits: false,
      canWrite: false,
      hasRemote: false,
      status: [],
      commits: [],
      userName: "",
      userEmail: "",
    };
    const root = await gitRepoRoot(workspace);
    if (!root) {
      // 兼容 .git 目录存在但 git 不可用的情况：至少把分支名带回去
      const fallback = await gitBranch(workspace);
      return fallback ? { ...empty, isRepo: true, branch: fallback } : empty;
    }

    const [statusOut, logOut, headOut, symbolicOut, upstreamOut, remoteOut, userName, userEmail] = await Promise.all([
      gitProbe(root, ["status", "--porcelain=v1", "-z", "-uall"]),
      gitProbe(root, [
        "log",
        "--graph",
        "--no-color",
        "-n",
        "60",
        "--pretty=format:\x1f%H\x1f%h\x1f%s\x1f%an\x1f%cr\x1f%D",
      ]),
      gitProbe(root, ["rev-parse", "--verify", "HEAD"]),
      gitProbe(root, ["symbolic-ref", "-q", "--short", "HEAD"]),
      gitProbe(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
      gitProbe(root, ["remote"]),
      gitProbe(root, ["config", "--get", "user.name"]),
      gitProbe(root, ["config", "--get", "user.email"]),
    ]);

    const hasCommits = Boolean(headOut.trim());
    const branch = symbolicOut.trim() || (hasCommits ? headOut.trim().slice(0, 7) : "");
    const detached = !symbolicOut.trim() && hasCommits;
    const upstream = upstreamOut.trim();
    const hasRemote = Boolean(remoteOut.trim());

    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = (await gitProbe(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]))
        .trim()
        .split(/\s+/);
      const behindCount = Number(counts[0]);
      const aheadCount = Number(counts[1]);
      behind = Number.isFinite(behindCount) ? behindCount : 0;
      ahead = Number.isFinite(aheadCount) ? aheadCount : 0;
    }

    const commits: GitCommitNode[] = [];
    for (const line of logOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split("\x1f");
      if (parts.length < 6) continue;
      const [graph, hash, shortHash, subject, author, relativeTime, refs = ""] = parts;
      commits.push({
        graph: graph ?? "",
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        subject: subject.trim(),
        author: author.trim(),
        relativeTime: relativeTime.trim(),
        refs: refs.trim(),
      });
    }

    const listOut = await gitProbe(root, ["worktree", "list", "--porcelain"]);
    const firstWorktree = parseWorktreeList(listOut)[0]?.path;
    const primaryRoot = firstWorktree ? await realpath(firstWorktree).catch(() => firstWorktree) : root;
    const repoKey = createHash("sha1").update(primaryRoot).digest("hex").slice(0, 8);

    return {
      isRepo: true,
      root,
      branch: branch || "HEAD",
      detached,
      upstream,
      ahead,
      behind,
      hasCommits,
      canWrite: samePath(root, workspace),
      hasRemote,
      status: parseGitStatus(statusOut),
      commits,
      userName: userName.trim(),
      userEmail: userEmail.trim(),
      worktreeRoot: this.worktreeRoot,
      repoKey,
    };
  }

  async gitBranches(cwd: string): Promise<GitBranch[]> {
    const workspace = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, workspace);
    const root = await gitRepoRoot(workspace);
    return root ? listGitBranches(root) : [];
  }

  /**
   * 执行 Git 写操作。所有路径参数都会被重新校验为仓库内相对路径，
   * 且只有仓库根目录就是当前项目目录时才允许写入。
   */
  async gitAction(cwd: string, action: GitActionName, payload: GitActionPayload = {}): Promise<GitActionResult> {
    // 同一工作区的 Git 写入串行，避免切换 / 暂存 / 提交竞争索引锁。
    return withFileWrite(path.join(path.resolve(cwd), ".git-pi-operation"), () => this.performGitAction(cwd, action, payload));
  }

  private async performGitAction(cwd: string, action: GitActionName, payload: GitActionPayload = {}): Promise<GitActionResult> {
    const workspace = await realpath(path.resolve(cwd));
    await assertRealWorkspacePath(cwd, workspace);
    const name = String(action ?? "") as GitActionName;

    if (name === "init") {
      if (await gitRepoRoot(workspace)) throw new Error("当前目录已经是 Git 仓库");
      try {
        await gitRun(workspace, ["init", "-b", "main"]);
      } catch {
        // 旧版本 git 不支持 -b，回退到默认分支名
        await gitRun(workspace, ["init"]);
      }
      return { ok: true, message: "已初始化 Git 仓库", overview: await this.gitOverview(cwd) };
    }

    const root = await gitRepoRoot(workspace);
    if (!root) throw new Error("当前目录不是 Git 仓库，请先初始化");
    if (!samePath(root, workspace)) {
      throw new Error("Git 仓库根目录不在当前项目内，暂不支持在此执行写操作");
    }

    const overview = await this.gitOverview(cwd);
    let message = "";

    switch (name) {
      case "switchBranch":
      case "createBranch":
      case "deleteBranch": {
        const pool = [...this.clients.entries()].find(([k]) => samePath(k, workspace))?.[1];
        if (pool && [...pool.workers.values()].some(slot => slot.streaming || slot.compacting)) {
          throw new Error("当前项目有 Agent 任务运行中，请等待结束后再切换、新建或删除分支");
        }
        message = await changeGitBranch(root, name, payload);
        completionCache.delete(completionKey(workspace));
        break;
      }
      case "stage": {
        const paths = payload.all ? [] : gitOperationPaths(root, payload.paths);
        await gitRun(root, payload.all ? ["add", "-A"] : ["add", "--", ...paths]);
        message = payload.all ? "已暂存全部改动" : `已暂存 ${paths.length} 个文件`;
        break;
      }
      case "unstage": {
        const paths = payload.all ? [] : gitOperationPaths(root, payload.paths);
        if (payload.all) {
          await gitRun(root, ["reset", "--quiet"]).catch(async () => {
            await gitRun(root, ["rm", "--cached", "-r", "--quiet", "."]);
          });
          message = "已取消全部暂存";
        } else {
          try {
            await gitRun(root, ["restore", "--staged", "--", ...paths]);
          } catch {
            // 空仓库（还没有 HEAD）没有 restore 的基线
            await gitRun(root, ["rm", "--cached", "-r", "--quiet", "--", ...paths]);
          }
          message = `已取消暂存 ${paths.length} 个文件`;
        }
        break;
      }
      case "commit": {
        const text = String(payload.message ?? "").trim();
        if (!text) throw new Error("提交信息不能为空");
        if (text.length > 5000) throw new Error("提交信息过长（上限 5000 字）");
        if (!overview.status.some((file) => file.index !== " " && file.index !== "?")) {
          throw new Error("没有已暂存的改动，请先暂存要提交的文件");
        }
        await gitRun(root, ["commit", "-m", text]);
        const short = (await gitProbe(root, ["rev-parse", "--short", "HEAD"])).trim();
        message = short ? `已提交 ${short}` : "已提交";
        break;
      }
      case "fetch": {
        if (!overview.upstream && !(await gitProbe(root, ["remote"])).trim()) {
          throw new Error("没有配置远程仓库，无法获取更新");
        }
        await gitRun(root, ["fetch", "--all", "--prune"]);
        message = "已获取远程更新";
        break;
      }
      case "pull": {
        if (!overview.upstream) throw new Error("当前分支没有上游分支，请先推送一次以建立跟踪关系");
        await gitRun(root, ["pull", "--no-edit"]);
        message = "已拉取远程更新";
        break;
      }
      case "push": {
        if (overview.detached) throw new Error("当前处于游离 HEAD 状态，无法推送");
        const remotes = (await gitProbe(root, ["remote"])).trim().split(/\s+/).filter(Boolean);
        if (!remotes.length) throw new Error("没有配置远程仓库，无法推送");
        if (overview.upstream) {
          await gitRun(root, ["push"]);
        } else {
          const remote = remotes.includes("origin") ? "origin" : remotes[0];
          await gitRun(root, ["push", "-u", remote, overview.branch]);
        }
        message = "已推送到远程";
        break;
      }
      default:
        throw new Error(`不支持的 Git 操作：${name}`);
    }

    return { ok: true, message, overview: await this.gitOverview(cwd) };
  }

  async gitInspect(cwd: string, kind: "commit" | "working" | "staged" | "unstaged", target: string): Promise<GitInspectResult> {
    const root = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, root);
    if (kind === "commit") {
      await assertRealWorkspacePath(cwd, root);
      if (!/^[0-9a-fA-F]{4,40}$/.test(target)) throw new Error("无效的提交哈希");
      const [metaOut, diffOut] = await Promise.all([
        execFileAsync(
          "git",
          ["show", "--no-patch", "--pretty=format:%H%n%an <%ae>%n%ci (%cr)%n%s%n%b", target],
          { cwd: root, maxBuffer: 2 * 1024 * 1024 },
        ),
        execFileAsync(
          "git",
          ["show", "--format=", "--patch", "--unified=3", target],
          { cwd: root, maxBuffer: 4 * 1024 * 1024 },
        ),
      ]);
      const lines = metaOut.stdout.split(/\r?\n/);
      const fullHash = lines[0] ?? target;
      const author = lines[1] ?? "";
      const date = lines[2] ?? "";
      const subject = lines[3] ?? target;
      return {
        kind: "commit",
        target: fullHash,
        title: subject,
        subtitle: `${fullHash.slice(0, 7)} · ${author}`,
        meta: date,
        diff: diffOut.stdout,
      };
    }

    const { root: safeRoot, target: safeTarget } = workspacePath(root, target);
    await assertRealWorkspacePath(root, safeTarget, true);
    const relative = path.relative(safeRoot, safeTarget).replace(/\\/g, "/");
    const area = kind === "staged" ? ["--cached"] : kind === "unstaged" ? [] : ["HEAD"];
    const { stdout } = await execFileAsync(
      "git",
      ["diff", ...area, "--unified=3", "--", relative],
      { cwd: safeRoot, maxBuffer: 4 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    let diff = stdout;
    // 只有未跟踪文件才合成新增 Diff；无改动的已跟踪文件不能被误显示为新增。
    const untracked = (await gitProbe(safeRoot, ["ls-files", "--others", "--exclude-standard", "--", relative])).trim();
    if (!diff.trim() && kind !== "staged" && untracked) {
      const content = await readFile(safeTarget, "utf8").catch(() => "");
      if (content) {
        const addedLines = content.split(/\r?\n/).map((l) => `+${l}`).join("\n");
        diff = `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1 @@\n${addedLines}`;
      }
    }

    return {
      kind,
      target: relative,
      title: path.basename(relative),
      subtitle: relative,
      meta: kind === "staged" ? "暂存区变更" : kind === "unstaged" ? "未暂存变更" : "工作区未提交变更",
      diff,
    };
  }

  /** 列出当前仓库的 worktree；managed 表示由 Pi Desktop 创建、可安全移除。 */
  async gitWorktrees(cwd: string): Promise<GitWorktree[]> {
    const workspace = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, workspace);
    const root = await gitRepoRoot(workspace);
    if (!root) return [];
    const out = await gitProbe(root, ["worktree", "list", "--porcelain"]);
    const parsed = parseWorktreeList(out);
    if (!parsed.length) return [];
    // git worktree list 的第一项固定是主工作区（即使当前 cwd 是某个关联 worktree）。
    const primaryRoot = await realpath(parsed[0]!.path).catch(() => parsed[0]!.path);
    const primaryBranch = parsed[0]!.branch || (await gitProbe(primaryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    const managedRoot = await realpath(this.worktreeRoot).catch(() => this.worktreeRoot);

    // 读取记录在仓库 config 中的隔离工作区基线与托管标记（branch.<name>.piBase* / piManaged）
    const configOut = await gitProbe(primaryRoot, ["config", "--get-regexp", "^branch\\..*\\.pi(base|managed)"]);
    const branchMeta = new Map<string, { baseBranch?: string; baseRef?: string; baseCommit?: string; managed?: boolean }>();
    for (const line of configOut.split(/\r?\n/)) {
      const match = /^branch\.(.+)\.(pibasebranch|pibaseref|pibasecommit|pimanaged)\s+(.*)$/i.exec(line.trim());
      if (!match) continue;
      const [, branchName, field, val] = match;
      const entry = branchMeta.get(branchName!) ?? {};
      const lower = field!.toLowerCase();
      if (lower === "pibasebranch") entry.baseBranch = val!.trim();
      else if (lower === "pibaseref") entry.baseRef = val!.trim();
      else if (lower === "pibasecommit") entry.baseCommit = val!.trim();
      else if (lower === "pimanaged") entry.managed = val!.trim().toLowerCase() === "true";
      branchMeta.set(branchName!, entry);
    }

    return Promise.all(parsed.map(async (item) => {
      const canonical = await realpath(item.path).catch(() => item.path);
      const primary = samePath(canonical, primaryRoot);
      const meta = item.branch ? branchMeta.get(item.branch) : undefined;
      const managed = !primary && (pathWithin(managedRoot, canonical) || Boolean(meta?.managed));
      const exists = existsSync(canonical);
      const baseBranch = !primary ? (meta?.baseBranch || primaryBranch || undefined) : undefined;
      const baseRef = !primary ? (meta?.baseRef || baseBranch) : undefined;
      const baseCommit = !primary ? meta?.baseCommit : undefined;

      let dirty = false;
      let ahead = 0;
      let behind = 0;
      if (!primary && exists) {
        const statusOut = await gitProbe(canonical, ["status", "--porcelain=v1", "-uall"]);
        dirty = Boolean(statusOut.trim());
        if (baseBranch && item.head) {
          const hasBase = (await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${baseBranch}`])).trim();
          if (hasBase) {
            const counts = (await gitProbe(primaryRoot, [
              "rev-list",
              "--left-right",
              "--count",
              `refs/heads/${baseBranch}...${item.head}`,
            ])).trim();
            const [behindRaw, aheadRaw] = counts.split(/\s+/);
            behind = Number(behindRaw) || 0;
            ahead = Number(aheadRaw) || 0;
          }
        }
      }

      return {
        ...item,
        path: canonical,
        primary,
        managed,
        exists,
        ...(baseBranch ? { baseBranch } : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        ...(!primary ? { dirty, ahead, behind } : {}),
      };
    }));
  }

  /** 从指定分支或提交（默认当前 HEAD）创建隔离工作区（支持自定义分支名、检出已有分支、自定义目录与克隆会话）。 */
  async gitWorktreeCreate(cwd: string, name: string, options: GitWorktreeCreateOptions = {}): Promise<GitWorktreeCreateResult> {
    const workspace = await realpath(path.resolve(cwd));
    await assertRealWorkspacePath(cwd, workspace);
    const root = await gitRepoRoot(workspace);
    if (!root) throw new Error("当前目录不是 Git 仓库，请先初始化");
    if (!samePath(root, workspace)) throw new Error("请在仓库根目录创建隔离工作区");
    const head = (await gitProbe(root, ["rev-parse", "--verify", "HEAD"])).trim();
    if (!head) throw new Error("仓库还没有提交，无法创建隔离工作区");

    const listOut = await gitProbe(root, ["worktree", "list", "--porcelain"]);
    const parsedWorktrees = parseWorktreeList(listOut);
    const firstWorktree = parsedWorktrees[0]?.path;
    const primaryRoot = firstWorktree ? await realpath(firstWorktree).catch(() => firstWorktree) : root;

    const branches = await listGitBranches(primaryRoot);
    const primaryBranch = (await gitProbe(primaryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    const currentBranch = (await gitProbe(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    const defaultBaseBranch =
      (currentBranch && !currentBranch.startsWith("pi/") ? currentBranch : "") ||
      primaryBranch ||
      branches.find((b) => !b.remote)?.name ||
      "main";

    const branchMode = options?.branchMode === "existing" ? "existing" : "create";
    const customBranchInput = String(options?.branchName ?? "").trim().replace(/^refs\/heads\//, "");

    const validateBranchFormat = async (candidate: string): Promise<string> => {
      if (
        !candidate ||
        candidate.length > 240 ||
        candidate.startsWith("-") ||
        candidate === "HEAD" ||
        /[\x00-\x20\x7f]/.test(candidate)
      ) {
        throw new Error("无效的分支名称（不能包含空白或以 - 开头）");
      }
      if (!(await gitProbe(primaryRoot, ["check-ref-format", "--branch", candidate])).trim()) {
        throw new Error("无效的 Git 分支名称，请换一个名称");
      }
      return candidate;
    };

    let baseCommit = head;
    let baseRef = currentBranch || head.slice(0, 7);
    let inferredBaseBranch = defaultBaseBranch;
    let branch = "";
    let checkoutExistingLocal = false;
    let trackRemoteRef = "";

    if (branchMode === "existing") {
      const rawExisting = String(options?.existingBranch ?? "").trim();
      if (!rawExisting) throw new Error("请选择要检出的已有分支");
      const match = branches.find((b) => b.ref === rawExisting || b.name === rawExisting);
      if (!match) throw new Error(`找不到要检出的分支：${rawExisting}`);

      if (!match.remote) {
        const occupied = parsedWorktrees.find((w) => w.branch === match.name);
        if (occupied || match.current || match.worktreePath) {
          throw new Error(`分支 ${match.name} 已在工作区使用（${occupied?.path || match.worktreePath || root}），不能在多个工作树重复检出`);
        }
        branch = await validateBranchFormat(match.name);
        checkoutExistingLocal = true;
        baseCommit = (await gitProbe(primaryRoot, ["rev-parse", "--verify", match.ref])).trim() || head;
        baseRef = match.name;
        inferredBaseBranch = match.name === defaultBaseBranch
          ? (branches.find((b) => !b.remote && b.name !== match.name)?.name || defaultBaseBranch)
          : defaultBaseBranch;
      } else {
        const stripped = match.name.includes("/") ? match.name.slice(match.name.indexOf("/") + 1) : match.name;
        const localName = await validateBranchFormat(customBranchInput || stripped);
        const occupied = parsedWorktrees.find((w) => w.branch === localName);
        if (occupied) {
          throw new Error(`本地分支 ${localName} 已在工作区使用（${occupied.path}），请指定其他本地跟踪分支名`);
        }
        const localExists = Boolean((await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${localName}`])).trim());
        branch = localName;
        if (localExists) {
          checkoutExistingLocal = true;
        } else {
          trackRemoteRef = match.ref;
        }
        baseCommit = (await gitProbe(primaryRoot, ["rev-parse", "--verify", match.ref])).trim() || head;
        baseRef = match.name;
        inferredBaseBranch = defaultBaseBranch;
      }
    } else {
      const rawStart = String(options?.startPoint ?? "").trim();
      if (rawStart && rawStart !== "HEAD") {
        if (rawStart.startsWith("-") || /[\x00-\x20\x7f]|@\{|\.\./.test(rawStart)) {
          throw new Error("无效的起点分支或提交");
        }
        const resolved = (await gitProbe(primaryRoot, ["rev-parse", "--verify", "--end-of-options", `${rawStart}^{commit}`])).trim();
        if (!resolved) throw new Error(`找不到指定的起点分支或提交：${rawStart}`);
        baseCommit = resolved;

        const localMatch = branches.find((b) => !b.remote && (b.ref === rawStart || b.name === rawStart));
        const remoteMatch = branches.find((b) => b.remote && (b.ref === rawStart || b.name === rawStart));
        if (localMatch) {
          baseRef = localMatch.name;
          inferredBaseBranch = localMatch.name;
        } else if (remoteMatch) {
          baseRef = remoteMatch.name;
          const stripped = remoteMatch.name.includes("/") ? remoteMatch.name.slice(remoteMatch.name.indexOf("/") + 1) : remoteMatch.name;
          const correspondingLocal = branches.find((b) => !b.remote && b.name === stripped);
          inferredBaseBranch = correspondingLocal ? correspondingLocal.name : defaultBaseBranch;
        } else {
          baseRef = resolved.slice(0, 7);
          inferredBaseBranch = defaultBaseBranch;
        }
      }
    }

    let baseBranch = inferredBaseBranch;
    if (options?.baseBranch !== undefined) {
      const rawBaseBranch = String(options.baseBranch ?? "").trim().replace(/^refs\/heads\//, "");
      if (!rawBaseBranch) {
        baseBranch = "";
      } else {
        if (!branches.some((b) => !b.remote && b.name === rawBaseBranch)) {
          throw new Error(`目标基础分支不存在：${rawBaseBranch}`);
        }
        baseBranch = rawBaseBranch;
      }
    }
    if (baseBranch && branch && baseBranch === branch) {
      baseBranch = "";
    }

    const rawSeed = String(name || customBranchInput || branch);
    const slug = worktreeSlug(rawSeed.replace(/^pi[/-]+/i, "")) || worktreeSlug(rawSeed);
    if (!slug) throw new Error("任务名或分支名不能为空");

    const repoKey = createHash("sha1").update(primaryRoot).digest("hex").slice(0, 8);
    await mkdir(this.worktreeRoot, { recursive: true });
    const managedRoot = await realpath(this.worktreeRoot);
    const rawTargetDir = String(options?.targetDir ?? "").trim();

    let target = "";
    if (rawTargetDir) {
      if (!path.isAbsolute(rawTargetDir)) throw new Error("隔离工作区目录必须是绝对路径");
      target = path.resolve(rawTargetDir);
      if (
        samePath(target, primaryRoot) ||
        samePath(target, root) ||
        pathWithin(target, primaryRoot) ||
        pathWithin(path.join(primaryRoot, ".git"), target)
      ) {
        throw new Error("隔离工作区目录不能是当前仓库根目录、其上级目录或 .git 内部");
      }
      if (existsSync(target)) {
        const info = await stat(target).catch(() => null);
        if (!info?.isDirectory()) throw new Error("目标路径已存在且不是文件夹");
        const existingEntries = await readdir(target);
        if (existingEntries.length > 0) {
          throw new Error("目标文件夹非空，请选择空文件夹或修改目标目录名称");
        }
      }
      if (branchMode === "create") {
        if (customBranchInput) {
          branch = await validateBranchFormat(customBranchInput);
          const exists = (await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${branch}`])).trim();
          if (exists) throw new Error(`本地分支 ${branch} 已存在，请换一个分支名或改选「检出已有分支」`);
        } else {
          let reserved = false;
          for (let index = 1; index <= 100; index += 1) {
            const candidate = `pi/${slug}${index === 1 ? "" : `-${index}`}`;
            const exists = (await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${candidate}`])).trim();
            if (!exists) {
              branch = candidate;
              reserved = true;
              break;
            }
          }
          if (!reserved) throw new Error("同名隔离工作区分支过多，请换一个任务名");
          await validateBranchFormat(branch);
        }
      }
    } else {
      const baseDir = path.join(managedRoot, `${repoKey}-${slug}`);
      if (branchMode === "create" && customBranchInput) {
        branch = await validateBranchFormat(customBranchInput);
        const exists = (await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${branch}`])).trim();
        if (exists) throw new Error(`本地分支 ${branch} 已存在，请换一个分支名或改选「检出已有分支」`);
        let reservedDir = false;
        for (let index = 1; index <= 100; index += 1) {
          const candidateDir = `${baseDir}${index === 1 ? "" : `-${index}`}`;
          if (!existsSync(candidateDir)) {
            target = candidateDir;
            reservedDir = true;
            break;
          }
        }
        if (!reservedDir) throw new Error("同名隔离工作区目录过多，请换一个名称或自定义目录");
      } else if (branchMode === "existing") {
        let reservedDir = false;
        for (let index = 1; index <= 100; index += 1) {
          const candidateDir = `${baseDir}${index === 1 ? "" : `-${index}`}`;
          if (!existsSync(candidateDir)) {
            target = candidateDir;
            reservedDir = true;
            break;
          }
        }
        if (!reservedDir) throw new Error("同名隔离工作区目录过多，请自定义存放目录");
      } else {
        let reserved = false;
        for (let index = 1; index <= 100; index += 1) {
          branch = `pi/${slug}${index === 1 ? "" : `-${index}`}`;
          target = `${baseDir}${index === 1 ? "" : `-${index}`}`;
          const exists = (await gitProbe(primaryRoot, ["show-ref", "--verify", `refs/heads/${branch}`])).trim();
          if (!exists && !existsSync(target)) {
            reserved = true;
            break;
          }
        }
        if (!reserved) throw new Error("同名隔离工作区过多，请换一个任务名");
        await validateBranchFormat(branch);
      }
    }

    if (baseBranch && baseBranch === branch) {
      baseBranch = "";
    }

    await mkdir(path.dirname(target), { recursive: true });
    if (branchMode === "existing") {
      if (checkoutExistingLocal) {
        await gitRun(primaryRoot, ["worktree", "add", target, branch]);
      } else {
        await gitRun(primaryRoot, ["worktree", "add", "--track", "-b", branch, target, trackRemoteRef]);
      }
    } else {
      await gitRun(primaryRoot, ["worktree", "add", "-b", branch, target, baseCommit]);
    }

    await gitProbe(primaryRoot, ["config", `branch.${branch}.piManaged`, "true"]);
    if (baseBranch) await gitProbe(primaryRoot, ["config", `branch.${branch}.piBaseBranch`, baseBranch]);
    if (baseRef) await gitProbe(primaryRoot, ["config", `branch.${branch}.piBaseRef`, baseRef]);
    if (baseCommit) await gitProbe(primaryRoot, ["config", `branch.${branch}.piBaseCommit`, baseCommit]);

    const canonicalTarget = await realpath(target);
    this.authorizedWorkspaces.set(this.workspaceKey(canonicalTarget), canonicalTarget);

    let clonedSessionFile: string | undefined;
    const rawSourceSession = String(options?.sourceSessionFile ?? "").trim();
    if (rawSourceSession) {
      const verifiedSession = assertReadableSessionFile(cwd, rawSourceSession);
      clonedSessionFile = await cloneSessionToWorkspace(verifiedSession, canonicalTarget);
    }

    const worktree = (await this.gitWorktrees(cwd)).find((item) => samePath(item.path, canonicalTarget));
    return {
      ok: true,
      message:
        branchMode === "existing"
          ? `已检出分支 ${branch} 创建隔离工作区`
          : `已基于 ${baseRef} 创建隔离工作区（${branch}）`,
      ...(clonedSessionFile ? { sessionFile: clonedSessionFile } : {}),
      worktree: worktree ?? {
        path: canonicalTarget,
        branch,
        head: baseCommit,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        primary: false,
        managed: true,
        exists: true,
        ...(baseBranch ? { baseBranch } : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        dirty: false,
        ahead: 0,
        behind: 0,
      },
    };
  }

  /** 移除非主工作区（Worktree）；默认保留分支，也可选择同时删除本地分支。 */
  async gitWorktreeRemove(cwd: string, target: string, options: GitWorktreeRemoveOptions = {}): Promise<GitWorktreeRemoveResult> {
    const workspace = await realpath(path.resolve(cwd));
    await assertRealWorkspacePath(cwd, workspace);
    const root = await gitRepoRoot(workspace);
    if (!root) throw new Error("当前目录不是 Git 仓库");
    if (!samePath(root, workspace)) throw new Error("请在仓库根目录移除隔离工作区");
    const allWorktrees = await this.gitWorktrees(cwd);
    const primary = allWorktrees.find((item) => item.primary);
    const primaryRoot = primary ? await realpath(primary.path).catch(() => primary.path) : root;
    const canonicalTarget = await realpath(path.resolve(target)).catch(() => path.resolve(target));
    const entry = allWorktrees.find((item) => samePath(item.path, canonicalTarget));
    if (!entry) throw new Error("该目录不是当前仓库的 worktree");
    if (entry.primary) throw new Error("不能移除仓库的主工作区");
    if (samePath(entry.path, workspace)) throw new Error("不能移除当前正在使用的工作区");
    for (const [itemCwd, pool] of [...this.clients.entries()]) {
      if (samePath(itemCwd, entry.path)) {
        if ([...pool.workers.values()].some((slot) => slot.streaming || slot.compacting)) {
          throw new Error("该隔离工作区仍有 Agent 任务正在运行，请等待结束后再移除");
        }
        await this.discardWorkspace(itemCwd);
      }
    }
    if ([...this.starting.keys()].some((itemCwd) => samePath(itemCwd, entry.path))) {
      throw new Error("该隔离工作区正在启动 Pi 进程，请稍候再移除");
    }

    // 1. 若工作树处于锁定状态（例如外部 IDE、JetBrains Air 或用户手动 lock），必须先解锁，否则 git worktree remove 与 prune 会直接跳过或报错
    await gitProbe(primaryRoot, ["worktree", "unlock", entry.path]);

    // 2. 执行 git worktree remove：传入双重 --force 以覆盖未暂存更改与锁定状态，即使目录不存在也应调用清理元数据
    //    目录已不存在时只尝试一次，避免无意义的重试等待。
    let removeError: unknown = null;
    const removeAttempts = entry.exists ? 6 : 1;
    for (let attempt = 0; attempt < removeAttempts; attempt += 1) {
      try {
        await gitRun(primaryRoot, ["worktree", "remove", "--force", "--force", entry.path]);
        removeError = null;
        break;
      } catch (error) {
        removeError = error;
        if (attempt + 1 < removeAttempts) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    // 3. 若目录仍然存在（例如 Windows 句柄锁导致 git remove 失败），进行物理删除重试
    if (existsSync(entry.path)) {
      let removed = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await rm(entry.path, { recursive: true, force: true });
          removed = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!removed) {
        throw new Error("工作区文件仍被占用，请关闭占用该目录的程序后重试");
      }
    }

    // 4. 清理无效的 worktree 内部元数据（指定 --expire now 立即清理，不等待默认的 3 天宽限期）
    await gitProbe(primaryRoot, ["worktree", "prune", "--expire", "now"]);

    // 5. 兜底保障：若 Git 内部依然残留该工作树元数据，只删除 gitdir 精确指向该工作树的那一个元数据目录。
    //    必须精确比较路径：子串匹配会把 `wt` 误判为 `wt-2`，删掉别的工作树的元数据。
    if ((await this.gitWorktrees(cwd)).some((item) => samePath(item.path, canonicalTarget))) {
      const commonDirRaw = (await gitProbe(primaryRoot, ["rev-parse", "--git-common-dir"])).trim();
      const commonDir = commonDirRaw ? path.resolve(primaryRoot, commonDirRaw) : path.join(primaryRoot, ".git");
      const gitWorktreesDir = path.join(commonDir, "worktrees");
      if (existsSync(gitWorktreesDir)) {
        const subdirs = await readdir(gitWorktreesDir).catch(() => [] as string[]);
        for (const sub of subdirs) {
          const gitdirFile = path.join(gitWorktreesDir, sub, "gitdir");
          const pointer = (await readFile(gitdirFile, "utf8").catch(() => "")).trim();
          if (!pointer) continue;
          // gitdir 内容形如 <worktree>/.git
          const pointedWorktree = path.dirname(path.resolve(pointer));
          if (samePath(pointedWorktree, canonicalTarget) || samePath(pointedWorktree, entry.path)) {
            await rm(path.join(gitWorktreesDir, sub), { recursive: true, force: true }).catch(() => {});
          }
        }
        await gitProbe(primaryRoot, ["worktree", "prune", "--expire", "now"]);
      }
    }

    // 6. 保留分支时只清掉 Pi 自己写入的元数据键；不能 --remove-section，否则会把分支的上游跟踪（remote/merge）一起删掉。
    //    删除分支时 git branch -D 会自行清理整个 branch.<name> 配置段。
    if (entry.branch && !options?.deleteBranch) {
      for (const key of ["piManaged", "piBaseBranch", "piBaseRef", "piBaseCommit"]) {
        await gitProbe(primaryRoot, ["config", "--unset-all", `branch.${entry.branch}.${key}`]);
      }
    }

    let branchDeleted = false;
    if (options?.deleteBranch && entry.branch) {
      const deletedOut = await gitProbe(primaryRoot, ["branch", "-D", entry.branch]);
      branchDeleted = Boolean(deletedOut.trim());
    }

    // 7. 最终校验：确认工作树确实已不在列表中
    const finalList = await this.gitWorktrees(cwd);
    if (finalList.some((item) => samePath(item.path, canonicalTarget))) {
      throw new Error(`未能移除工作树 ${entry.path}，Git 仍保留该工作树记录，请检查是否有外部程序占用`);
    }

    const typeLabel = entry.managed ? "隔离工作区" : "外部工作区";
    const label = entry.branch || entry.head.slice(0, 7) || "detached";
    return {
      ok: true,
      message: branchDeleted ? `已移除${typeLabel}并删除分支 ${entry.branch}` : `已移除${typeLabel}（${label}）`,
      branch: entry.branch,
      path: entry.path,
      branchDeleted,
    };
  }

  /**
   * 将隔离工作区中的提交合并回目标基础分支（在主工作区执行）。
   * 支持 squash（压缩成一个提交）、merge（合并提交 --no-ff）和 rebase（线性变基后快进）。
   * 若遇到冲突则自动中止并恢复主工作区与隔离工作区为干净状态，返回冲突文件列表。
   */
  async gitWorktreeMerge(cwd: string, options: GitWorktreeMergeOptions): Promise<GitWorktreeMergeResult> {
    const workspace = await realpath(path.resolve(cwd));
    await assertRealWorkspacePath(cwd, workspace);
    const root = await gitRepoRoot(workspace);
    if (!root) throw new Error("当前目录不是 Git 仓库");

    const allWorktrees = await this.gitWorktrees(workspace);
    const primary = allWorktrees.find((item) => item.primary);
    if (!primary || !primary.exists) throw new Error("找不到仓库的主工作区");
    const primaryRoot = await realpath(primary.path).catch(() => primary.path);
    this.authorizedWorkspaces.set(this.workspaceKey(primaryRoot), primaryRoot);

    const rawTarget = String(options?.worktreePath ?? "").trim();
    if (!rawTarget) throw new Error("请指定要合并的隔离工作区");
    const canonicalWorktree = await realpath(path.resolve(rawTarget)).catch(() => path.resolve(rawTarget));
    const entry = allWorktrees.find((item) => samePath(item.path, canonicalWorktree));
    if (!entry) throw new Error("该目录不是当前仓库的 worktree");
    if (entry.primary) throw new Error("不能将主工作区合并到自身");
    if (!entry.exists) throw new Error("隔离工作区目录不存在");
    if (!entry.branch) throw new Error("隔离工作区处于游离 HEAD 状态，请先在工作区内创建分支后再合并");

    return withFileWrite(path.join(primaryRoot, ".git-pi-operation"), async () => {
      for (const checkPath of [primaryRoot, entry.path]) {
        const pool = [...this.clients.entries()].find(([k]) => samePath(k, checkPath))?.[1];
        if (pool && [...pool.workers.values()].some((slot) => slot.streaming || slot.compacting)) {
          throw new Error("相关工作区仍有 Agent 任务正在运行，请等待任务结束后再合并");
        }
      }

      const targetBranch = String(options?.targetBranch || entry.baseBranch || primary.branch || "")
        .trim()
        .replace(/^refs\/heads\//, "");
      if (!targetBranch) throw new Error("请指定要合并到的目标基础分支");
      if (targetBranch === entry.branch) throw new Error("目标基础分支不能与隔离工作区分支相同");
      const targetRef = `refs/heads/${targetBranch}`;
      if (!(await gitProbe(primaryRoot, ["show-ref", "--verify", targetRef])).trim()) {
        throw new Error(`目标基础分支不存在：${targetBranch}`);
      }

      const strategy: GitWorktreeMergeStrategy =
        options?.strategy === "merge" || options?.strategy === "rebase" || options?.strategy === "squash"
          ? options.strategy
          : "squash";

      if ((await gitProbe(entry.path, ["status", "--porcelain=v1", "-uall"])).trim()) {
        throw new Error(`隔离工作区（${entry.branch}）仍有未提交或未跟踪的改动，请先在隔离工作区提交后再合并`);
      }
      if ((await gitProbe(primaryRoot, ["status", "--porcelain=v1", "-uall"])).trim()) {
        throw new Error(`主工作区（${primary.branch || primaryRoot}）有未提交或未跟踪的改动，请先在主工作区处理后再合并`);
      }

      const counts = (await gitProbe(primaryRoot, [
        "rev-list",
        "--left-right",
        "--count",
        `${targetRef}...refs/heads/${entry.branch}`,
      ])).trim();
      const [, aheadRaw] = counts.split(/\s+/);
      const ahead = Number(aheadRaw) || 0;
      if (ahead <= 0) {
        throw new Error(`分支 ${entry.branch} 没有领先于 ${targetBranch} 的新提交，无需合并`);
      }

      const currentPrimaryBranch = (await gitProbe(primaryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
      if (currentPrimaryBranch !== targetBranch) {
        const occupiedOther = allWorktrees.find((w) => !w.primary && w.branch === targetBranch);
        if (occupiedOther) {
          throw new Error(`目标分支 ${targetBranch} 当前已在另一工作区检出：${occupiedOther.path}`);
        }
        await gitRun(primaryRoot, ["switch", "--no-guess", "--", targetBranch]);
      }

      const customMessage = String(options?.message ?? "").trim();
      if (customMessage.length > 5000) throw new Error("合并提交说明过长（上限 5000 字）");
      let commitMessage = customMessage;
      if (!commitMessage) {
        if (ahead === 1) {
          const singleSubject = (await gitProbe(primaryRoot, ["log", "-1", "--format=%s", `refs/heads/${entry.branch}`])).trim();
          commitMessage = singleSubject || `合并 ${entry.branch} 到 ${targetBranch}`;
        } else {
          const subjects = (await gitProbe(primaryRoot, [
            "log",
            "--reverse",
            "--format=- %s",
            `${targetRef}..refs/heads/${entry.branch}`,
          ])).trim();
          commitMessage = `合并 ${entry.branch} 到 ${targetBranch}` + (subjects ? `\n\n${subjects}` : "");
        }
      }

      const collectConflicts = async (dir: string): Promise<string[]> => {
        const unmerged = (await gitProbe(dir, ["diff", "--name-only", "--diff-filter=U"])).trim();
        if (unmerged) {
          return [...new Set(unmerged.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
        }
        const status = parseGitStatus(await gitProbe(dir, ["status", "--porcelain=v1", "-z"]));
        return status
          .filter((f) => f.index === "U" || f.worktree === "U" || (f.index === "A" && f.worktree === "A") || (f.index === "D" && f.worktree === "D"))
          .map((f) => f.path);
      };

      if (strategy === "squash") {
        try {
          await gitRun(primaryRoot, ["merge", "--squash", `refs/heads/${entry.branch}`]);
        } catch (error) {
          const conflicts = await collectConflicts(primaryRoot);
          await gitProbe(primaryRoot, ["reset", "--hard", "HEAD"]);
          await gitProbe(primaryRoot, ["clean", "-fd"]);
          if (conflicts.length) {
            return {
              ok: false,
              conflict: true,
              conflicts,
              message: `合并 ${entry.branch} 到 ${targetBranch} 时发生冲突（共 ${conflicts.length} 个文件），已自动中止合并并恢复主工作区`,
              primaryPath: primaryRoot,
              worktreePath: entry.path,
              worktreeBranch: entry.branch,
              targetBranch,
              strategy,
            };
          }
          throw error;
        }
        const stagedAfterSquash = (await gitProbe(primaryRoot, ["status", "--porcelain=v1"])).trim();
        if (!stagedAfterSquash) {
          await gitProbe(primaryRoot, ["reset", "--hard", "HEAD"]);
          throw new Error(`分支 ${entry.branch} 的改动内容已包含在 ${targetBranch} 中，无需生成新提交`);
        }
        await gitRun(primaryRoot, ["commit", "-m", commitMessage]);
      } else if (strategy === "merge") {
        try {
          await gitRun(primaryRoot, ["merge", "--no-ff", "-m", commitMessage, `refs/heads/${entry.branch}`]);
        } catch (error) {
          const conflicts = await collectConflicts(primaryRoot);
          await gitProbe(primaryRoot, ["merge", "--abort"]);
          await gitProbe(primaryRoot, ["reset", "--hard", "HEAD"]);
          if (conflicts.length) {
            return {
              ok: false,
              conflict: true,
              conflicts,
              message: `合并 ${entry.branch} 到 ${targetBranch} 时发生冲突（共 ${conflicts.length} 个文件），已自动中止合并并恢复主工作区`,
              primaryPath: primaryRoot,
              worktreePath: entry.path,
              worktreeBranch: entry.branch,
              targetBranch,
              strategy,
            };
          }
          throw error;
        }
      } else {
        // rebase：先在隔离工作区线性变基到目标分支最新提交，成功后再在主工作区快进合并
        try {
          await gitRun(entry.path, ["rebase", targetRef]);
        } catch (error) {
          const conflicts = await collectConflicts(entry.path);
          await gitProbe(entry.path, ["rebase", "--abort"]);
          await gitProbe(entry.path, ["reset", "--hard", "HEAD"]);
          if (conflicts.length) {
            return {
              ok: false,
              conflict: true,
              conflicts,
              message: `将 ${entry.branch} 变基到 ${targetBranch} 时发生冲突（共 ${conflicts.length} 个文件），已中止变基并恢复工作区干净`,
              primaryPath: primaryRoot,
              worktreePath: entry.path,
              worktreeBranch: entry.branch,
              targetBranch,
              strategy,
            };
          }
          throw error;
        }
        await gitRun(primaryRoot, ["merge", "--ff-only", `refs/heads/${entry.branch}`]);
      }

      completionCache.delete(completionKey(primaryRoot));
      const shortCommit = (await gitProbe(primaryRoot, ["rev-parse", "--short", "HEAD"])).trim();
      const strategyLabel = strategy === "squash" ? "压缩合并" : strategy === "rebase" ? "变基快进" : "合并提交";
      return {
        ok: true,
        message: `已通过${strategyLabel}将 ${entry.branch} 合入 ${targetBranch}${shortCommit ? `（${shortCommit}）` : ""}`,
        primaryPath: primaryRoot,
        worktreePath: entry.path,
        worktreeBranch: entry.branch,
        targetBranch,
        strategy,
        commit: shortCommit,
      };
    });
  }

  /**
   * 把仓库克隆到指定目录（「从 Git 克隆」入口）。
   *
   * 目标路径由界面用 `cloneTargetPath` 推导后传进来，这里负责复核：
   * 必须是绝对路径、父目录存在、目标为空或不存在 —— 克隆是往用户目录里写东西，
   * 不能只靠渲染进程的一句「应该没问题」。
   */
  async gitClone(url: string, target: string): Promise<GitCloneResult> {
    const source = String(url ?? "").trim();
    if (!source) throw new Error("仓库地址不能为空");
    // 以 - 开头会被 git 当成选项；控制字符会打断 execFile 的参数传递
    if (source.startsWith("-")) throw new Error("仓库地址不能以 - 开头");
    if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error("仓库地址包含非法字符");
    const raw = String(target ?? "").trim();
    if (!raw) throw new Error("请选择克隆到的位置");
    if (!path.isAbsolute(raw)) throw new Error("位置必须是绝对路径");
    const dest = path.resolve(raw);
    const parent = path.dirname(dest);
    const parentInfo = await stat(parent).catch(() => null);
    if (!parentInfo?.isDirectory()) throw new Error("位置不存在或不是目录");
    const existing = await stat(dest).catch(() => null);
    if (existing) {
      if (!existing.isDirectory()) throw new Error("目标位置已存在同名文件");
      if ((await readdir(dest)).length) throw new Error("目标目录已存在且不为空，请换一个位置");
    }
    // 需要交互式登录的仓库在没有终端时会一直等：显式关掉凭据提示，让它直接报错
    await gitRun(parent, ["clone", "--", source, dest], 8 * 1024 * 1024, { GIT_TERMINAL_PROMPT: "0" });
    return { ok: true, path: await realpath(dest), message: `已克隆 ${source}` };
  }

  async completePaths(cwd: string, query = ""): Promise<WorkspaceEntry[]> {
    const root = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, root);
    const key = completionKey(root);
    const cached = completionCache.get(key);
    let entries: string[];
    if (cached && Date.now() - cached.at < COMPLETION_CACHE_TTL) {
      entries = cached.entries;
    } else {
      entries = await walkDirectory(root, root, [], 5000);
      completionCache.set(key, { at: Date.now(), entries });
      if (completionCache.size > 8) {
        const oldest = completionCache.keys().next().value;
        if (oldest) completionCache.delete(oldest);
      }
    }
    const q = String(query).trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

    function score(relative: string): number | null {
      const value = relative.toLowerCase();
      const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
      const name = trimmed.split("/").at(-1) ?? trimmed;
      if (!q) return 0;
      if (name === q) return 0;
      if (name.startsWith(q)) return 10;
      if (trimmed.startsWith(q)) return 20;
      if (name.includes(q)) return 30;
      if (trimmed.includes(q)) return 40;

      let cursor = 0;
      let gaps = 0;
      for (const character of q) {
        const found = value.indexOf(character, cursor);
        if (found < 0) return null;
        gaps += found - cursor;
        cursor = found + 1;
      }
      return 60 + gaps;
    }

    return entries
      .map((rel) => {
        const normalized = rel.replace(/\\/g, "/");
        return { rel: normalized, score: score(normalized) };
      })
      .filter((item): item is { rel: string; score: number } => item.score !== null)
      .sort((a, b) => a.score - b.score || a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" }))
      .slice(0, 30)
      .map(({ rel }) => {
        const folder = rel.endsWith("/");
        const trimmed = folder ? rel.slice(0, -1) : rel;
        const segments = trimmed.split("/");
        return {
          path: path.join(root, ...segments),
          relative: rel,
          name: segments.at(-1) ?? trimmed,
          kind: folder ? "folder" : "file",
        };
      });
  }

  authorizeAttachmentPaths(paths: string[] = []): void {
    for (const target of paths) {
      if (typeof target === "string" && target.trim() && path.isAbsolute(target)) {
        this.authorizedAttachmentPaths.add(path.resolve(target));
      }
    }
  }

  /**
   * 把「别的会话」准备成上下文块（输入框里 @ 引用对话）。
   *
   * 和文件附件不同，会话可能在会话根目录下的任何项目里，所以只校验它在会话目录内，
   * 不要求位于当前项目。内容经过压缩，不会把整份 JSONL 塞进提示词。
   */
  /** 跨项目会话列表：供「@ 引用其它项目对话」插件使用（只读）。 */
  async crossProjectSessions(limit = 40) {
    return listCrossProjectSessions(limit);
  }

  async prepareSessionAttachments(cwd: string, files: string[] = []) {
    if (!Array.isArray(files) || files.length > SESSION_ATTACHMENT_LIMIT) {
      throw new Error(`一次最多引用 ${SESSION_ATTACHMENT_LIMIT} 个会话`);
    }
    const items: any[] = [];
    const blocks: string[] = [];
    for (const file of files) {
      if (typeof file !== "string" || !file.trim()) continue;
      const target = assertReadableSessionFile(cwd, file);
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(target);
      } catch {
        throw new Error("这个会话文件已不存在");
      }
      if (!info.isFile()) throw new Error("只能引用会话文件");
      const messages = await readSessionHistory(target);
      if (!messages.length) throw new Error("这个会话还没有内容，无法引用");
      const title = (await readSessionName(target, info.size)) || firstUserTitleFromMessages(messages) || "未命名会话";
      items.push({
        path: target,
        name: title,
        kind: "session" as const,
        size: info.size,
        inlined: true,
        messages: messages.length,
      });
      blocks.push(sessionContextBlock({ file: target, title, messages }));
    }
    return { items, text: blocks.join(""), images: [] as any[] };
  }

  async prepareAttachments(cwd: string, paths: string[] = []) {
    if (!Array.isArray(paths) || paths.length > 20) throw new Error("一次最多添加 20 个文件或文件夹");
    await assertRealWorkspacePath(cwd, path.resolve(cwd));
    const workspaceRoot = path.resolve(cwd);
    const workspacePrefix = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
    const items: AttachmentItem[] = [];
    for (const target of paths) {
      if (typeof target !== "string" || !target.trim()) continue;
      const resolved = path.resolve(target);
      const insideWorkspace = resolved === workspaceRoot || resolved.startsWith(workspacePrefix);
      if (!insideWorkspace) {
        const authorized = this.authorizedAttachmentPaths.has(resolved);
        if (!authorized) throw new Error("附件必须位于当前项目目录内，或由系统文件选择器授权");
      } else {
        await assertRealWorkspacePath(cwd, resolved);
      }
      items.push(await prepareAttachment(cwd, target));
    }
    return {
      // 图片附带给前端缩略图数据（过大的图片只回传文件名，避免快照膨胀）
      items: items.map(({ path: file, name, kind, image, mimeType, data, size, inlined }) => ({
        path: file,
        name,
        kind,
        image,
        mimeType: image ? mimeType : undefined,
        data: image && (data?.length ?? 0) <= 8 * 1024 * 1024 ? data : undefined,
        size,
        inlined,
      })),
      text: items.map((item) => item.text ?? "").join(""),
      images: items.filter((item) => item.image).map(({ mimeType, data }) => ({ type: "image", mimeType, data })),
    };
  }

  async snapshot(cwd: string, sessionFile?: string) {
    cwd = this.resolvePoolKey(cwd);
    const pool = this.requirePool(cwd);
    const slot = this.resolveSlot(cwd, sessionFile);
    const client = slot.client;
    const state = await client.getState();
    if (state.sessionFile) {
      const oldKey = normSessionFile(slot.sessionFile);
      const newKey = normSessionFile(state.sessionFile);
      if (oldKey && oldKey !== newKey) pool.workers.delete(oldKey);
      slot.sessionFile = state.sessionFile;
      pool.workers.set(newKey, slot);
    }
    slot.streaming = Boolean(state.isStreaming);
    slot.compacting = Boolean(state.isCompacting);
    const keepFiles = [state.sessionFile, ...[...pool.workers.values()].map((w) => w.sessionFile)].filter(Boolean);
    const [models, levels, messages, sessions, commands, branch] = await Promise.all([
      client.getAvailableModels(),
      client.getAvailableThinkingLevels(),
      client.getMessages(),
      listSessions(cwd, keepFiles),
      client.getCommands().catch(() => []),
      gitBranch(cwd),
    ]);
    const workerStates = [...pool.workers.values()].map((w) => ({
      sessionFile: w.sessionFile,
      streaming: w.streaming,
      compacting: w.compacting,
    }));
    return { state, models, levels, messages, sessions, commands, branch, workerStates };
  }

  /**
   * 从会话文件读取一页历史消息。
   * endIndex 为「不含」的结束下标；<= 0 表示取最新一页（末尾）。
   */
  async messagePage(
    cwd: string,
    sessionFile: string,
    endIndex = 0,
    limit = 8,
    minTurns = 0,
    minBlocks = 0,
  ): Promise<{ messages: any[]; startIndex: number; endIndex: number; total: number }> {
    try {
      assertReadableSessionFile(cwd, sessionFile);
      return await readSessionHistoryPage(sessionFile, endIndex, limit, minTurns, minBlocks);
    } catch (error) {
      throw new Error(`读取会话历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  requirePool(cwd: string): WorkspaceClientPool {
    const entry = this.clients.get(this.resolvePoolKey(cwd));
    if (!entry) throw new Error("这个工作区还没有启动 Pi");
    return entry;
  }

  resolveSlot(cwd: string, sessionFile?: string): WorkerSlot {
    const pool = this.requirePool(cwd);
    if (sessionFile) {
      const byFile = pool.workers.get(normSessionFile(sessionFile));
      if (byFile) return byFile;
      throw new Error(`未知的会话文件：${path.basename(sessionFile)}`);
    }
    const active = pool.workers.get(normSessionFile(pool.activeSessionFile));
    if (active) return active;
    const first = pool.workers.values().next().value;
    if (first) return first;
    throw new Error("当前工作区没有可用的会话 Worker");
  }

  require(cwd: string, sessionFile?: string): PiRpcClient {
    return this.resolveSlot(cwd, sessionFile).client;
  }

  async call(cwd: string, method: string, args: any[] = [], sessionFile?: string) {
    cwd = this.resolvePoolKey(cwd);
    const allowed = new Set<string>(PI_RPC_ALLOWLIST);
    if (!allowed.has(method)) throw new Error(`不允许的 RPC 方法：${method}`);
    if (method === "setMaxIdleWorkers") {
      this.requirePool(cwd);
      if (!Number.isFinite(Number(args?.[0]))) throw new Error("无效的 Worker 空闲上限");
      const limit = Math.max(1, Math.min(8, Number(args?.[0])));
      this.maxIdleWorkers = limit;
      for (const p of this.clients.values()) this.pruneIdleWorkers(p, limit);
      return { maxIdleWorkers: this.maxIdleWorkers };
    }
    const pool = this.requirePool(cwd);
    const restored = (args ?? []).map((arg) => (arg === null ? undefined : arg));

    if (method === "switchSession") {
      const targetFile = String(restored[0] ?? "");
      if (!targetFile) throw new Error("未指定要切换的会话文件");
      try {
        assertSessionFile(cwd, targetFile);
      } catch {
        // 会话文件不在这个项目的会话目录里：说明它属于另一个项目。
        // 这里必须给出能照着做的提示（原来复用了删除的守卫文案，用户完全看不懂）。
        const owner = path.basename(path.dirname(String(targetFile)));
        throw new Error(`这个会话属于另一个项目（${owner}），请从左侧对应的项目里打开`);
      }
      const existing = pool.workers.get(normSessionFile(targetFile));
      if (existing) {
        pool.client = existing.client;
        pool.activeSessionFile = existing.sessionFile;
        return {
          cancelled: false,
          sessionFile: existing.sessionFile,
          reusedWorker: true,
          workerStates: this.getWorkerStates(pool),
        };
      }
      const idleSlot = this.findIdleSlot(pool);
      if (idleSlot) {
        const oldFile = idleSlot.sessionFile;
        const oldKey = normSessionFile(oldFile);
        const res = await idleSlot.client.switchSession(targetFile).catch(async (error: any) => {
          // 会话文件坏了：丢掉这一槽 worker，别让整个工作区跟着失灵。
          if (isBrokenSessionError(error)) {
            await this.discardBrokenSlot(cwd, idleSlot.client);
            throw new Error(`这个会话文件读不出来（可能已损坏或被其它工具改写过）：${path.basename(targetFile)}。文件已保留，换一个会话或新建会话即可继续。`);
          }
          throw error;
        });
        if (!res?.cancelled) {
          if (oldKey) pool.workers.delete(oldKey);
          if (oldFile && await isKnownEmptySession(oldFile)) {
            unlink(oldFile).catch(() => {});
          }
          const st = await idleSlot.client.getState();
          idleSlot.sessionFile = st.sessionFile ?? targetFile;
          idleSlot.streaming = Boolean(st.isStreaming);
          idleSlot.compacting = Boolean(st.isCompacting);
          idleSlot.lastState = st;
          pool.workers.set(normSessionFile(idleSlot.sessionFile), idleSlot);
          pool.client = idleSlot.client;
          pool.activeSessionFile = idleSlot.sessionFile;
          return {
            ...(res ?? { cancelled: false }),
            sessionFile: idleSlot.sessionFile,
            state: st,
            workerStates: this.getWorkerStates(pool),
          };
        }
        return res;
      }
      const standby = await this.claimStandbyWorker(pool);
      if (standby) {
        const initialFile = standby.sessionFile;
        try {
          if (normSessionFile(initialFile) !== normSessionFile(targetFile)) {
            const switched = await standby.client.switchSession(targetFile).catch((error: any) => {
              if (isBrokenSessionError(error)) {
                throw new Error(`这个会话文件读不出来（可能已损坏或被其它工具改写过）：${path.basename(targetFile)}。文件已保留，换一个会话或新建会话即可继续。`);
              }
              throw error;
            });
            if (switched?.cancelled) {
              if (!pool.standbySlot && this.clients.get(cwd) === pool) {
                pool.standbySlot = standby;
              } else {
                if (initialFile && await isKnownEmptySession(initialFile)) {
                  await unlink(initialFile).catch(() => {});
                }
                await standby.client.stop().catch(() => {});
              }
              return switched;
            }
            if (initialFile && await isKnownEmptySession(initialFile)) {
              unlink(initialFile).catch(() => {});
            }
          }
          const st = await standby.client.getState();
          standby.sessionFile = st.sessionFile ?? targetFile;
          standby.streaming = Boolean(st.isStreaming);
          standby.compacting = Boolean(st.isCompacting);
          standby.lastState = st;
          pool.workers.set(normSessionFile(standby.sessionFile), standby);
          pool.client = standby.client;
          pool.activeSessionFile = standby.sessionFile;
          return {
            cancelled: false,
            sessionFile: standby.sessionFile,
            state: st,
            workerStates: this.getWorkerStates(pool),
          };
        } catch (error) {
          if (initialFile && await isKnownEmptySession(initialFile)) {
            await unlink(initialFile).catch(() => {});
          }
          await standby.client.stop().catch(() => {});
          throw error;
        }
      }
      const spawned = await this.spawnWorker(cwd, pool, { targetSessionFile: targetFile });
      return {
        cancelled: false,
        sessionFile: spawned.sessionFile,
        state: spawned.lastState,
        workerStates: this.getWorkerStates(pool),
      };
    }

    if (method === "newSession") {
      const idleSlot = this.findIdleSlot(pool);
      if (idleSlot) {
        const oldFile = idleSlot.sessionFile;
        const oldKey = normSessionFile(oldFile);
        const res = await idleSlot.client.newSession(restored[0]);
        if (!res?.cancelled) {
          if (oldKey) pool.workers.delete(oldKey);
          if (oldFile && await isKnownEmptySession(oldFile)) {
            unlink(oldFile).catch(() => {});
          }
          const st = await idleSlot.client.getState();
          idleSlot.sessionFile = st.sessionFile ?? "";
          idleSlot.streaming = Boolean(st.isStreaming);
          idleSlot.compacting = Boolean(st.isCompacting);
          idleSlot.lastState = st;
          if (idleSlot.sessionFile) {
            pool.workers.set(normSessionFile(idleSlot.sessionFile), idleSlot);
          }
          pool.client = idleSlot.client;
          pool.activeSessionFile = idleSlot.sessionFile;
          const sessions = await this.sessions(cwd);
          return {
            ...(res ?? { cancelled: false }),
            sessionFile: idleSlot.sessionFile,
            state: st,
            sessions,
            workerStates: this.getWorkerStates(pool),
          };
        }
        return res;
      }
      const standby = await this.claimStandbyWorker(pool);
      if (standby) {
        const initialFile = standby.sessionFile;
        try {
          if (restored[0]) {
            const created = await standby.client.newSession(restored[0]);
            if (created?.cancelled) {
              if (!pool.standbySlot && this.clients.get(cwd) === pool) {
                pool.standbySlot = standby;
              } else {
                if (initialFile && await isKnownEmptySession(initialFile)) {
                  await unlink(initialFile).catch(() => {});
                }
                await standby.client.stop().catch(() => {});
              }
              return created;
            }
            if (initialFile && await isKnownEmptySession(initialFile)) {
              unlink(initialFile).catch(() => {});
            }
            const st = await standby.client.getState();
            standby.sessionFile = st.sessionFile ?? "";
            standby.streaming = Boolean(st.isStreaming);
            standby.compacting = Boolean(st.isCompacting);
            standby.lastState = st;
          }
          if (standby.sessionFile) {
            pool.workers.set(normSessionFile(standby.sessionFile), standby);
          }
          pool.client = standby.client;
          pool.activeSessionFile = standby.sessionFile;
          const sessions = await this.sessions(cwd);
          return {
            cancelled: false,
            sessionFile: standby.sessionFile,
            state: standby.lastState,
            sessions,
            workerStates: this.getWorkerStates(pool),
          };
        } catch (error) {
          if (initialFile && await isKnownEmptySession(initialFile)) {
            await unlink(initialFile).catch(() => {});
          }
          await standby.client.stop().catch(() => {});
          throw error;
        }
      }
      const spawned = await this.spawnWorker(cwd, pool, { parentSession: restored[0] });
      const sessions = await this.sessions(cwd);
      return {
        cancelled: false,
        sessionFile: spawned.sessionFile,
        state: spawned.lastState,
        sessions,
        workerStates: this.getWorkerStates(pool),
      };
    }

    const slot = this.resolveSlot(cwd, sessionFile);
    const client = slot.client as any;

    if (method === "prompt") {
      const wasStreaming = slot.streaming;
      slot.streaming = true;
      if (!this.findIdleSlot(pool)) {
        this.warmStandbyWorker(cwd, pool);
      }
      try {
        const disposition = await client.prompt(...restored);
        if (disposition === "handled") slot.streaming = wasStreaming;
        return disposition;
      } catch (error) {
        slot.streaming = wasStreaming;
        throw error;
      }
    }

    if (method === "compact") {
      // 压缩上下文要调模型总结整段对话，动辄一两分钟，远超上游 PiRpcClient 的 30 秒单命令超时。
      // 超时只代表「客户端不等了」，Pi 进程仍在压缩 —— 改成等 compaction_end 事件（见 compact-wait.ts）。
      // 摘要可能因为「思考 token 吃掉输出预算」被截断（generation hit the token cap）：
      // 这种情况临时把思考等级降到 off 重试一次，结束后还原（见 runCompactResilient）。
      const outcome = await runCompactResilient(client, restored[0], {
        getThinkingLevel: async () => (await client.getState())?.thinkingLevel,
        setThinkingLevel: (level) => client.setThinkingLevel(level),
      });
      if (outcome.retriedFrom) {
        log.pi("warn", "compaction", `摘要撞到输出上限，已用 off 思考等级重试（原来是 ${outcome.retriedFrom}）`);
      }
      if (outcome.slow) {
        log.pi("warn", "compaction", `压缩超过 ${COMPACT_RPC_TIMEOUT_MS / 1000} 秒才完成，已改为等待 compaction_end 事件`);
        return { slow: true };
      }
      return outcome.value;
    }

    if (method === "fork" || method === "clone") {
      const oldKey = normSessionFile(slot.sessionFile);
      const res = await client[method](...restored);
      if (!res?.cancelled) {
        if (oldKey) pool.workers.delete(oldKey);
        const st = await slot.client.getState();
        slot.sessionFile = st.sessionFile ?? slot.sessionFile;
        if (slot.sessionFile) pool.workers.set(normSessionFile(slot.sessionFile), slot);
        pool.client = slot.client;
        pool.activeSessionFile = slot.sessionFile;
      }
      return res;
    }

    return client[method](...restored);
  }

  respondExtensionUi(cwd: string, response: Record<string, any>, sessionFile?: string) {
    const client = this.require(cwd, sessionFile) as any;
    const stdin = client.process?.stdin;
    if (!stdin || !stdin.writable) throw new Error("Pi 进程不可写");
    const payload: Record<string, any> = { type: "extension_ui_response", id: String(response.id) };
    if (response.cancelled) payload.cancelled = true;
    else if ("confirmed" in response) payload.confirmed = Boolean(response.confirmed);
    else payload.value = response.value ?? "";
    stdin.write(`${JSON.stringify(payload)}\n`);
  }

  /** 项目信任状态（Pi 在 RPC 模式下没答案就按不信任处理，桌面端要能看见这件事）。 */
  async projectTrust(cwd: string) {
    cwd = this.resolvePoolKey(cwd);
    const { global } = readSettings(cwd, this.agentDirPath());
    const defaultProjectTrust = typeof global.defaultProjectTrust === "string" ? global.defaultProjectTrust : "ask";
    return projectTrustStatus({ cwd, agentDir: this.agentDirPath(), defaultProjectTrust });
  }

  /** 写入信任决定（/trust）。调用方负责重启 Pi 让资源重新加载。 */
  async setProjectTrust(cwd: string, action: TrustAction) {
    cwd = this.resolvePoolKey(cwd);
    const { global } = readSettings(cwd, this.agentDirPath());
    const defaultProjectTrust = typeof global.defaultProjectTrust === "string" ? global.defaultProjectTrust : "ask";
    return setProjectTrust({ cwd, action, agentDir: this.agentDirPath(), defaultProjectTrust });
  }

  /**
   * 导入外部会话（/import）：把 .jsonl 克隆进当前项目的会话目录。
   * 克隆而不是直接引用，是为了让它在侧栏可见、也让会话头里的 cwd 指向这个项目。
   */
  async importSession(cwd: string, file: string): Promise<{ path: string; title: string }> {
    cwd = this.resolvePoolKey(cwd);
    const source = path.resolve(file);
    if (!source.toLowerCase().endsWith(".jsonl")) throw new Error("只能导入 .jsonl 会话文件");
    const firstLine = (await readFile(source, "utf8").catch(() => "")).split("\n", 1)[0];
    const head = firstLine.trim();
    let parsed: any = null;
    try {
      parsed = JSON.parse(head || "{}");
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.type !== "session") throw new Error("这不是 Pi 的会话文件（首行缺少 session 头）");
    const dest = await cloneSessionToWorkspace(source, cwd);
    const summary = await summarizeSessionFile(dest);
    return { path: dest, title: summary?.title ?? "导入的会话" };
  }

  /** 导出原始会话（/export xxx.jsonl）：Pi 的 RPC 只有 HTML 导出，JSONL 自己拷一份。 */
  async exportSessionJsonl(cwd: string, target = ""): Promise<{ path: string }> {
    cwd = this.resolvePoolKey(cwd);
    const source = this.clients.get(cwd)?.activeSessionFile;
    if (!source) throw new Error("当前会话还没有落盘，先发一条消息再导出");
    const text = await readFile(source, "utf8");
    const wanted = target.trim();
    const file = wanted
      ? path.resolve(cwd, wanted)
      : path.join(cwd, `pi-session-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.jsonl`);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, text);
    return { path: file };
  }

  async restart(cwd: string, sessionFile?: string) {
    cwd = this.resolvePoolKey(cwd);
    const pool = this.clients.get(cwd);
    const targetFile = sessionFile || pool?.activeSessionFile || "";
    if (pool) {
      await this.disposeStandby(pool);
      const slot = pool.workers.get(normSessionFile(targetFile));
      if (slot && pool.workers.size > 1) {
        pool.workers.delete(normSessionFile(targetFile));
        await slot.client.stop().catch(() => {});
        const replacement = await this.spawnWorker(cwd, pool, { targetSessionFile: targetFile || undefined });
        return this.snapshot(cwd, replacement.sessionFile);
      }
      const allClients = [...pool.workers.values()].map((w) => w.client);
      this.clients.delete(cwd);
      await Promise.allSettled(allClients.map((c) => c.stop()));
    }
    await this.open(cwd);
    if (targetFile) {
      await this.call(cwd, "switchSession", [targetFile]).catch(() => {});
    }
    return this.snapshot(cwd, targetFile || undefined);
  }

  async close(cwd: string): Promise<boolean> {
    cwd = this.resolvePoolKey(cwd);
    await this.starting.get(cwd)?.catch(() => {});
    const pool = this.clients.get(cwd);
    if (!pool) return false;
    this.clients.delete(cwd);
    await this.disposeStandby(pool);
    const allClients = [...pool.workers.values()].map((w) => w.client);
    await Promise.allSettled(allClients.map((c) => c.stop()));
    return true;
  }

  async deleteSession(cwd: string, file: string): Promise<SessionSummary[]> {
    cwd = this.resolvePoolKey(cwd);
    const target = assertSessionFile(cwd, file);
    const targetKey = normSessionFile(target);
    const pool = this.clients.get(cwd);
    if (pool) {
      const slot = pool.workers.get(targetKey);
      if (slot) {
        const state = await slot.client.getState().catch(() => ({ isStreaming: slot.streaming, sessionFile: slot.sessionFile }));
        if (state.isStreaming || slot.streaming) throw new Error("任务正在运行，请先停止再删除");
        if (pool.workers.size > 1) {
          pool.workers.delete(targetKey);
          await slot.client.stop().catch(() => {});
          if (normSessionFile(pool.activeSessionFile) === targetKey) {
            const nextSlot = pool.workers.values().next().value!;
            pool.client = nextSlot.client;
            pool.activeSessionFile = nextSlot.sessionFile;
          }
        } else {
          pool.workers.delete(targetKey);
          const next = (await listSessions(cwd)).find((item) => !item.empty && normSessionFile(item.path) !== targetKey);
          if (next) await slot.client.switchSession(next.path);
          else await slot.client.newSession();
          const newState = await slot.client.getState();
          slot.sessionFile = newState.sessionFile ?? "";
          if (slot.sessionFile) pool.workers.set(normSessionFile(slot.sessionFile), slot);
          pool.client = slot.client;
          pool.activeSessionFile = slot.sessionFile;
        }
      }
    }
    await this.trash(target);
    clearSessionHistoryCache(target);
    return this.sessions(cwd);
  }

  async deleteAllSessions(cwd: string): Promise<{ deleted: number; failed: number }> {
    cwd = this.resolvePoolKey(cwd);
    if (this.clients.has(cwd)) throw new Error("请先关闭该项目的 Pi 进程");
    const items = await listSessions(cwd);
    const results = await Promise.allSettled(items.map((item) => this.trash(assertSessionFile(cwd, item.path))));
    const failed = results.filter((r) => r.status === "rejected").length;
    return { deleted: items.length - failed, failed };
  }

  sessions(cwd: string): Promise<SessionSummary[]> {
    cwd = this.resolvePoolKey(cwd);
    const pool = this.clients.get(cwd);
    if (!pool) return listSessions(cwd);
    const keepFiles = [pool.activeSessionFile, ...[...pool.workers.values()].map((w) => w.sessionFile)].filter(Boolean);
    return listSessions(cwd, keepFiles);
  }

  async stopAll(): Promise<void> {
    this.closing = true;
    const allClients: PiRpcClient[] = [];
    const starting = [...this.starting.values()];
    const standbyDisposals: Promise<void>[] = [];
    for (const pool of this.clients.values()) {
      standbyDisposals.push(this.disposeStandby(pool));
      for (const slot of pool.workers.values()) {
        allClients.push(slot.client);
      }
    }
    this.clients.clear();
    this.starting.clear();
    await Promise.allSettled([...starting, ...standbyDisposals, ...allClients.map((client) => client.stop())]);
    // A start may finish after the initial snapshot of clients; stop any late pool as well.
    const lateClients = [...this.clients.values()].flatMap((pool) => [...pool.workers.values()].map((slot) => slot.client));
    await Promise.allSettled(lateClients.map((client) => client.stop()));
    this.clients.clear();
  }

  // ---------- MCP 服务配置管理 ----------

  private mcpProbeCache = new Map<string, { state?: string; tools?: string[]; error?: string; resources?: boolean }>();

  private agentDirPath(): string {
    return resolveAgentDir();
  }

  private mcpConfigFile(scope: "global" | "project", cwd?: string): string {
    if (scope === "project") {
      if (!cwd) throw new Error("当前未打开项目目录，无法操作项目级 .pi/mcp.json");
      const root = path.resolve(cwd);
      return path.join(root, ".pi", "mcp.json");
    }
    return path.join(this.agentDirPath(), "mcp.json");
  }

  private async readMcpFile(filePath: string): Promise<{ data: Record<string, any>; error?: string }> {
    if (!existsSync(filePath)) return { data: {} };
    try {
      const text = await readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { data: {}, error: `${filePath}: 根节点必须是 JSON 对象` };
      }
      return { data: parsed };
    } catch (error: any) {
      return { data: {}, error: `${filePath}: ${error?.message ?? String(error)}` };
    }
  }

  private async writeMcpFile(filePath: string, data: Record<string, any>): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, filePath).catch(async (error) => {
      await unlink(temp).catch(() => {});
      throw error;
    });
  }

  private toMcpServerItem(name: string, raw: Record<string, any>, scope: "global" | "project", sourcePath: string): McpServerItem {
    const isHttp = Boolean(raw.url || raw.type === "http");
    const safeUrl = typeof raw.url === "string" && /^https?:\/\//i.test(raw.url) ? raw.url : undefined;
    const probe = this.mcpProbeCache.get(`${scope}:${name}`) ?? this.mcpProbeCache.get(name);
    const exposureRaw = String(raw.exposure ?? "codemode");
    const exposure: McpExposureMode =
      exposureRaw === "direct" || exposureRaw === "deferred" || exposureRaw === "hidden" ? exposureRaw : "codemode";
    const enabled = raw.enabled !== false;
    return {
      name,
      scope,
      sourcePath,
      type: isHttp ? "http" : "stdio",
      command: typeof raw.command === "string" ? raw.command : undefined,
      args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
      env: raw.env && typeof raw.env === "object" && !Array.isArray(raw.env) ? Object.fromEntries(Object.keys(raw.env).map((key) => [key, "••••••"])) : undefined,
      cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
      url: safeUrl,
      headers: raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers) ? Object.fromEntries(Object.keys(raw.headers).map((key) => [key, "••••••"])) : undefined,
      auth: raw.auth && typeof raw.auth === "object" ? { provider: typeof raw.auth.provider === "string" ? raw.auth.provider : "configured" } : undefined,
      oauth: raw.oauth && typeof raw.oauth === "object" ? { configured: true } : undefined,
      enabled,
      exposure,
      description: typeof raw.description === "string" ? raw.description : undefined,
      timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
      state: !enabled ? "disabled" : probe?.state,
      tools: probe?.tools,
      error: probe?.error,
      resources: probe?.resources,
    };
  }

  async mcpOverview(cwd?: string): Promise<McpOverview> {
    if (cwd) await assertRealWorkspacePath(cwd, path.resolve(cwd));
    const agentDir = this.agentDirPath();
    const globalConfigPath = path.join(agentDir, "mcp.json");
    const projectConfigPath = cwd ? path.join(path.resolve(cwd), ".pi", "mcp.json") : "";
    const errors: string[] = [];

    const globalRes = await this.readMcpFile(globalConfigPath);
    if (globalRes.error) errors.push(globalRes.error);

    const projectRes = projectConfigPath ? await this.readMcpFile(projectConfigPath) : { data: {} as Record<string, any> };
    if (projectRes.error) errors.push(projectRes.error);

    const servers: McpServerItem[] = [];
    const globalServers =
      globalRes.data.mcpServers && typeof globalRes.data.mcpServers === "object" && !Array.isArray(globalRes.data.mcpServers)
        ? globalRes.data.mcpServers
        : {};
    for (const [name, raw] of Object.entries(globalServers)) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        servers.push(this.toMcpServerItem(name, raw as Record<string, any>, "global", globalConfigPath));
      }
    }

    const projectServers =
      projectRes.data.mcpServers && typeof projectRes.data.mcpServers === "object" && !Array.isArray(projectRes.data.mcpServers)
        ? projectRes.data.mcpServers
        : {};
    for (const [name, raw] of Object.entries(projectServers)) {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const rec = raw as Record<string, any>;
        const isOverrideOnly = rec.command === undefined && rec.url === undefined && rec.type === undefined;
        if (isOverrideOnly) {
          const baseIdx = servers.findIndex((s) => s.scope === "global" && s.name === name);
          if (baseIdx !== -1) {
            const baseGlobal = globalServers[name] as Record<string, any>;
            servers[baseIdx] = this.toMcpServerItem(name, { ...baseGlobal, ...rec }, "global", globalConfigPath);
            continue;
          }
        }
        servers.push(this.toMcpServerItem(name, rec, "project", projectConfigPath));
      }
    }

    const autoEnableCodemode =
      typeof projectRes.data.autoEnableCodemode === "boolean"
        ? projectRes.data.autoEnableCodemode
        : typeof globalRes.data.autoEnableCodemode === "boolean"
          ? globalRes.data.autoEnableCodemode
          : true;

    return {
      agentDir,
      globalConfigPath,
      projectConfigPath,
      autoEnableCodemode,
      servers,
      errors,
    };
  }

  async mcpProbe(cwd?: string): Promise<McpOverview> {
    const piEntry = await this.piEntry();
    const targetCwd = cwd ? path.resolve(cwd) : homedir();
    const out = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        [piEntry, "mcp", "list", "--json"],
        {
          cwd: targetCwd,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", FORCE_COLOR: "0" },
          maxBuffer: 8 * 1024 * 1024,
          timeout: 45_000,
        },
        (_err, stdout = "", stderr = "") => {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
      child.stdin?.end();
    });

    const extraErrors: string[] = [];
    try {
      const jsonText = out.stdout.trim();
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed?.servers)) {
          for (const srv of parsed.servers) {
            if (!srv?.name) continue;
            const info = {
              state: srv.state ?? (srv.enabled === false ? "disabled" : "unknown"),
              tools: Array.isArray(srv.tools) ? srv.tools.map(String) : [],
              error: srv.error ? "MCP 服务返回错误（详细诊断已隐藏）" : undefined,
              resources: Boolean(srv.resources),
            };
            const scopeKey = srv.scope === "project" ? "project" : "global";
            this.mcpProbeCache.set(`${scopeKey}:${srv.name}`, info);
            this.mcpProbeCache.set(srv.name, info);
          }
        }
        if (Array.isArray(parsed?.errors) && parsed.errors.length) {
          extraErrors.push("MCP 列表包含错误（详细诊断已隐藏）");
        }
      }
    } catch {
      if (out.stderr.trim()) extraErrors.push("MCP 探测失败（详细诊断已隐藏）");
    }

    const overview = await this.mcpOverview(cwd);
    if (extraErrors.length) {
      overview.errors = [...new Set([...overview.errors, ...extraErrors])];
    }
    return overview;
  }

  async mcpSaveServer(
    cwd: string,
    payload: { scope: "global" | "project"; name: string; previousName?: string; config: Record<string, any> },
  ): Promise<McpOverview> {
    const name = String(payload.name ?? "").trim();
    if (!name) throw new Error("请输入 MCP 服务名称");
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error("MCP 服务名称只能包含字母、数字、点、下划线或连字符");
    }
    const cfg = payload.config ?? {};
    if (!cfg.command && !cfg.url) {
      throw new Error("MCP 服务必须提供本地命令（command）或远程地址（url）");
    }

    const filePath = this.mcpConfigFile(payload.scope, cwd);
    const { data, error } = await this.readMcpFile(filePath);
    if (error) throw new Error(error);

    const servers =
      data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)
        ? { ...data.mcpServers }
        : {};
    const previousConfig = servers[payload.previousName || name];
    if (payload.previousName && payload.previousName !== name) {
      delete servers[payload.previousName];
      this.mcpProbeCache.delete(`${payload.scope}:${payload.previousName}`);
    }
    const cleanConfig: Record<string, any> = {};
    if (cfg.url) {
      cleanConfig.url = String(cfg.url).trim();
      if (cfg.headers && typeof cfg.headers === "object" && Object.keys(cfg.headers).length > 0) {
        cleanConfig.headers = cfg.headers;
      } else if (previousConfig?.headers) {
        cleanConfig.headers = previousConfig.headers;
      }
      if (cfg.auth && typeof cfg.auth === "object") cleanConfig.auth = cfg.auth;
      else if (previousConfig?.auth) cleanConfig.auth = previousConfig.auth;
      if (cfg.oauth && typeof cfg.oauth === "object") cleanConfig.oauth = cfg.oauth;
      else if (previousConfig?.oauth) cleanConfig.oauth = previousConfig.oauth;
    } else {
      cleanConfig.command = String(cfg.command).trim();
      if (Array.isArray(cfg.args) && cfg.args.length > 0) {
        cleanConfig.args = cfg.args.map(String).filter(Boolean);
      }
      if (cfg.env && typeof cfg.env === "object" && Object.keys(cfg.env).length > 0) {
        const masked = Object.values(cfg.env).some((value) => value === "••••••");
        cleanConfig.env = masked && previousConfig?.env ? previousConfig.env : cfg.env;
      } else if (previousConfig?.env) {
        cleanConfig.env = previousConfig.env;
      }
      if (cfg.cwd && String(cfg.cwd).trim()) {
        cleanConfig.cwd = String(cfg.cwd).trim();
      }
    }
    if (cfg.description && String(cfg.description).trim()) {
      cleanConfig.description = String(cfg.description).trim();
    }
    if (cfg.exposure && cfg.exposure !== "codemode") {
      cleanConfig.exposure = cfg.exposure;
    }
    if (cfg.enabled === false) {
      cleanConfig.enabled = false;
    }
    if (typeof cfg.timeout === "number" && cfg.timeout > 0 && cfg.timeout !== 60) {
      cleanConfig.timeout = cfg.timeout;
    }

    servers[name] = cleanConfig;
    data.mcpServers = servers;
    await this.writeMcpFile(filePath, data);
    return this.mcpOverview(cwd);
  }

  async mcpUpdateServer(
    cwd: string,
    payload: { scope: "global" | "project"; name: string; patch: { enabled?: boolean; exposure?: McpExposureMode } },
  ): Promise<McpOverview> {
    const filePath = this.mcpConfigFile(payload.scope, cwd);
    const { data, error } = await this.readMcpFile(filePath);
    if (error) throw new Error(error);
    const servers =
      data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)
        ? { ...data.mcpServers }
        : {};
    const existing = servers[payload.name];
    if (!existing || typeof existing !== "object") {
      throw new Error(`找不到 MCP 服务：${payload.name}`);
    }
    const next = { ...existing };
    if (payload.patch.enabled !== undefined) {
      if (payload.patch.enabled) delete next.enabled;
      else next.enabled = false;
    }
    if (payload.patch.exposure !== undefined) {
      if (payload.patch.exposure === "codemode") delete next.exposure;
      else next.exposure = payload.patch.exposure;
    }
    servers[payload.name] = next;
    data.mcpServers = servers;
    await this.writeMcpFile(filePath, data);
    return this.mcpOverview(cwd);
  }

  async mcpRemoveServer(cwd: string, payload: { scope: "global" | "project"; name: string }): Promise<McpOverview> {
    const filePath = this.mcpConfigFile(payload.scope, cwd);
    const { data, error } = await this.readMcpFile(filePath);
    if (error) throw new Error(error);
    const servers =
      data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)
        ? { ...data.mcpServers }
        : {};
    delete servers[payload.name];
    this.mcpProbeCache.delete(`${payload.scope}:${payload.name}`);
    this.mcpProbeCache.delete(payload.name);
    data.mcpServers = servers;
    await this.writeMcpFile(filePath, data);
    return this.mcpOverview(cwd);
  }

  async mcpSetAutoCodemode(cwd: string, payload: { scope?: "global" | "project"; enabled: boolean }): Promise<McpOverview> {
    const filePath = this.mcpConfigFile(payload.scope ?? "global", cwd);
    const { data, error } = await this.readMcpFile(filePath);
    if (error) throw new Error(error);
    if (payload.enabled) {
      delete data.autoEnableCodemode;
    } else {
      data.autoEnableCodemode = false;
    }
    await this.writeMcpFile(filePath, data);
    return this.mcpOverview(cwd);
  }

  async mcpImportJson(cwd: string, payload: { scope: "global" | "project"; jsonText: string }): Promise<McpOverview> {
    let parsed: any;
    try {
      parsed = JSON.parse(payload.jsonText);
    } catch (error: any) {
      throw new Error(`JSON 格式无法解析：${error?.message ?? String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("请粘贴包含 mcpServers 的 JSON 对象");
    }

    let entries: Record<string, any> = {};
    if (parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)) {
      entries = parsed.mcpServers;
    } else if (typeof parsed.name === "string" && (parsed.command || parsed.url)) {
      const { name, ...rest } = parsed;
      entries = { [name]: rest };
    } else {
      entries = parsed;
    }

    const validEntries = Object.entries(entries).filter(
      ([key, val]) => /^[a-zA-Z0-9._-]+$/.test(key) && val && typeof val === "object" && ((val as any).command || (val as any).url),
    );
    if (!validEntries.length) {
      throw new Error("未在 JSON 中识别出有效的 MCP 服务定义（需要包含 command 或 url 字段）");
    }

    const filePath = this.mcpConfigFile(payload.scope, cwd);
    const { data, error } = await this.readMcpFile(filePath);
    if (error) throw new Error(error);
    const servers =
      data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers)
        ? { ...data.mcpServers }
        : {};
    for (const [name, cfg] of validEntries) {
      servers[name] = cfg;
    }
    data.mcpServers = servers;
    await this.writeMcpFile(filePath, data);
    return this.mcpOverview(cwd);
  }

  // ---------- Pi 软件包管理 ----------

  /** 读全局 + 项目设置，算出当前配置的软件包（含是否已安装）。 */
  private loadPackageState(cwd?: string) {
    const agentDir = this.agentDirPath();
    const effectiveCwd = cwd ? path.resolve(cwd) : homedir();
    const settings = readSettings(effectiveCwd, agentDir);
    const packages = configuredPackages(settings.global, settings.project, effectiveCwd, agentDir);
    return { agentDir, effectiveCwd, settings, packages };
  }

  private normalizeInstallSource(rawSource: string, cwd?: string): string {
    const trimmed = rawSource.trim();
    if (!trimmed) throw new Error("请输入要安装的软件包来源（如 npm:@scope/pkg 或 git:github.com/user/repo）");
    if (
      trimmed.startsWith("npm:") ||
      trimmed.startsWith("git:") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("ssh://") ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../") ||
      trimmed.startsWith(".\\") ||
      trimmed.startsWith("..\\") ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("~") ||
      /^[a-zA-Z]:[\\/]/.test(trimmed)
    ) {
      return trimmed;
    }
    if (cwd && existsSync(path.resolve(cwd, trimmed))) {
      return trimmed;
    }
    if (/^github\.com\/[^/]+\/[^/]+/.test(trimmed)) {
      return `git:${trimmed}`;
    }
    return `npm:${trimmed}`;
  }

  private classifySourceKind(source: string): "npm" | "git" | "local" {
    if (source.startsWith("npm:")) return "npm";
    if (
      source.startsWith("git:") ||
      source.startsWith("http://") ||
      source.startsWith("https://") ||
      source.startsWith("ssh://") ||
      source.includes("github.com/") ||
      source.includes("gitlab.com/")
    ) {
      return "git";
    }
    return "local";
  }

  async packagesOverview(cwd?: string): Promise<PiPackagesOverview> {
    if (cwd) await assertRealWorkspacePath(cwd, path.resolve(cwd));
    const { agentDir, effectiveCwd, settings, packages: configured } = this.loadPackageState(cwd);
    const globalSettingsPath = path.join(agentDir, "settings.json");
    const projectSettingsPath = cwd ? path.join(effectiveCwd, ".pi", "settings.json") : "";

    // 顶层自动发现的资源在前，包内声明的资源在后（与 Pi 的优先级一致）
    const resources: PiResourceItem[] = autoResources(settings, effectiveCwd, agentDir);
    for (const entry of configured) resources.push(...packageResources(entry, settings));

    const packages: PiPackageItem[] = [];
    for (const item of configured) {
      let displayName = item.source.replace(/^npm:/, "").replace(/^git:/, "");
      let version: string | undefined;
      let description: string | undefined;

      if (item.installedPath) {
        const pkgJsonPath = path.join(item.installedPath, "package.json");
        try {
          const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf8"));
          if (pkgJson.name) displayName = pkgJson.name;
          if (pkgJson.version) version = String(pkgJson.version);
          if (pkgJson.description) description = String(pkgJson.description);
        } catch {
          // package.json 缺失或损坏：只影响显示的版本号
        }
      }

      const counts = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
      if (item.installedPath) {
        const normRoot = path.resolve(item.installedPath).toLowerCase();
        for (const res of resources) {
          if (res.origin !== "package") continue;
          if (path.resolve(res.path).toLowerCase().startsWith(normRoot)) counts[res.type] += 1;
        }
      }

      packages.push({
        source: item.source,
        scope: item.scope,
        kind: item.kind,
        displayName,
        version,
        description,
        installed: Boolean(item.installedPath),
        installedPath: item.installedPath,
        filtered: item.filtered,
        counts,
      });
    }

    return { agentDir, globalSettingsPath, projectSettingsPath, packages, resources };
  }

  async packagesInstall(cwd: string, payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    const local = Boolean(payload?.local);
    if (local && !cwd) throw new Error("当前未打开项目目录，无法安装到项目级配置");
    const normalized = this.normalizeInstallSource(payload?.source ?? "", cwd);
    const entry = await this.piEntry();
    const result = await runPiCli(entry, ["install", normalized, ...(local ? ["-l"] : [])], local && cwd ? path.resolve(cwd) : undefined);
    if (result.code !== 0) throw new Error(`安装失败：${result.output.slice(-400) || "pi install 异常退出"}`);
    return this.packagesOverview(cwd);
  }

  async packagesRemove(cwd: string, payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    const local = Boolean(payload?.local);
    const entry = await this.piEntry();
    const result = await runPiCli(entry, ["remove", String(payload?.source ?? ""), ...(local ? ["-l"] : [])], local && cwd ? path.resolve(cwd) : undefined);
    if (result.code !== 0) throw new Error(`卸载失败：${result.output.slice(-400) || "pi remove 异常退出"}`);
    return this.packagesOverview(cwd);
  }

  async packagesUpdate(cwd: string, payload?: { source?: string }): Promise<PiPackagesOverview> {
    const entry = await this.piEntry();
    const target = payload?.source ? ["--extension", String(payload.source)] : ["--extensions"];
    const result = await runPiCli(entry, ["update", ...target], cwd ? path.resolve(cwd) : undefined);
    if (result.code !== 0) throw new Error(`更新失败：${result.output.slice(-400) || "pi update 异常退出"}`);
    return this.packagesOverview(cwd);
  }

  async skillsOverview(cwd?: string): Promise<PiSkillsOverview> {
    if (cwd) await assertRealWorkspacePath(cwd, path.resolve(cwd));
    const agentDir = this.agentDirPath();
    const effectiveCwd = cwd || homedir();
    const globalSkillsDir = path.join(agentDir, "skills");
    const projectSkillsDir = cwd ? path.join(effectiveCwd, ".pi", "skills") : "";
    const { settings, packages: configured } = this.loadPackageState(cwd);
    const userAgentsSkillsDir = path.join(homedir(), ".agents", "skills");
    const directories = new Map<string, string>([
      [path.resolve(globalSkillsDir), "全局技能目录"],
      [path.resolve(userAgentsSkillsDir), "用户 Agent Skills"],
    ]);
    if (projectSkillsDir) directories.set(path.resolve(projectSkillsDir), "当前项目技能目录");
    let dir = path.resolve(effectiveCwd);
    while (cwd) {
      directories.set(path.join(dir, ".agents", "skills"), "项目 Agent Skills");
      if (existsSync(path.join(dir, ".git"))) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const resources = autoResources({ global: settings.global, project: settings.project }, effectiveCwd, agentDir);
    for (const item of configured) resources.push(...packageResources(item, { global: settings.global, project: settings.project }));
    const { skills, diagnostics } = await skillsFromResources(resources);
    return {
      agentDir,
      globalSkillsDir,
      projectSkillsDir,
      directories: [...directories].map(([skillPath, label]) => ({ label, path: skillPath })),
      skills,
      diagnostics,
    };
  }
}

export async function readRecent(file: string): Promise<string[]> {
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    const entries = Array.isArray(saved) ? saved.filter((cwd): cwd is string => typeof cwd === "string") : [];
    const valid: string[] = [];
    for (const cwd of entries) {
      try {
        const info = await stat(cwd);
        if (info.isDirectory()) valid.push(path.resolve(cwd));
      } catch {
        // Drop stale or inaccessible recent workspaces.
      }
    }
    return [...new Set(valid)];
  } catch {
    return [];
  }
}

export async function writeRecent(file: string, cwd: string): Promise<string[]> {
  return withFileWrite(file, async () => {
    const next = [cwd, ...(await readRecent(file)).filter(item => !samePath(item, cwd))].slice(0, 20);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, JSON.stringify(next, null, 2));
    return next;
  });
}

export async function forgetRecent(file: string, cwd: string): Promise<string[]> {
  return withFileWrite(file, async () => {
    const next = (await readRecent(file)).filter(item => !samePath(item, cwd));
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, JSON.stringify(next, null, 2));
    return next;
  });
}
