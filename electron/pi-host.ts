import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open as openFileHandle, readdir, readFile, mkdir, lstat, stat, unlink, writeFile, rename, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DefaultPackageManager, DefaultResourceLoader, getAgentDir, RpcClient, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PI_RPC_ALLOWLIST } from "./pi-rpc-allowlist.ts";
import { clearSessionHistoryCache, readSessionHistoryPage } from "./session-history.ts";
import { sessionTitleFromText } from "./session-title.ts";

const execFileAsync = promisify(execFile);

/**
 * PiHost：宿主侧的工作区进程池。
 * 一个工作区一个 `pi --mode rpc`，只通过官方 RpcClient 通信，不读写 Pi 的配置。
 */

export interface AttachmentItem {
  path: string;
  name: string;
  kind: "file" | "folder";
  image: boolean;
  mimeType?: string;
  data?: string;
  text?: string;
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  empty: boolean;
  timestamp: number;
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
}

export interface GitStatusFile {
  code: string;
  path: string;
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
  branch: string;
  status: GitStatusFile[];
  commits: GitCommitNode[];
}

export interface GitInspectResult {
  kind: "commit" | "working";
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
  scope: "user" | "project" | "temporary";
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
  scope: "user" | "project" | "temporary";
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
}

export interface WorkerSlot {
  client: RpcClient;
  sessionFile: string;
  streaming: boolean;
  compacting: boolean;
  lastState?: any;
}

export interface WorkspaceClientPool {
  client: RpcClient;
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

function cliPath(): string {
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")).replace("app.asar", "app.asar.unpacked");
  return path.join(path.dirname(entry), "cli.js");
}

/** 与 Pi 的 getDefaultSessionDir 保持同一编码规则。 */
function sessionDir(cwd: string): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  const resolved = path.resolve(cwd);
  const encoded = `--${[...resolved].map((ch) => ("\\/:".includes(ch) ? "-" : ch)).join("").replace(/^-/, "")}--`;
  return path.join(agentDir, "sessions", encoded);
}

const IMAGE_MIME = new Map<string, string>([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const TEXT_EXTENSIONS = new Set<string>([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".css", ".scss", ".less", ".html", ".xml",
  ".json", ".jsonl", ".md", ".txt", ".yml", ".yaml", ".toml", ".ini", ".env", ".csv",
  ".py", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".sh", ".ps1",
]);

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
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi") continue;
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
  if (size > 20 * 1024 * 1024) throw new Error(`附件超过 20 MB：${path.basename(file)}`);
  const mime = IMAGE_MIME.get(path.extname(file).toLowerCase());
  if (mime) {
    const data = (await readFile(file)).toString("base64");
    info.image = true;
    info.mimeType = mime;
    info.data = data;
    info.text = `<file name="${escapeXml(file)}"></file>\n`;
    return info;
  }
  if (isProbablyText(file)) {
    const content = await readFile(file, "utf8");
    info.text = `<file name="${escapeXml(file)}">\n${content}\n</file>\n`;
  } else {
    info.text = `<file name="${escapeXml(file)}">\n[二进制文件，无法作为文本读取。请使用工具读取或处理。]\n</file>\n`;
  }
  return info;
}

function firstUserText(lines: string[]): string {
  for (const line of lines.slice(0, 80)) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry.message ?? entry;
      if (message.role !== "user") continue;
      const content = message.content;
      const text = typeof content === "string" ? content : content?.find((part: any) => part.type === "text")?.text;
      if (!text) continue;
      const title = sessionTitleFromText(text);
      if (title) return title;
    } catch {
      // 跳过损坏行
    }
  }
  return "";
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

/** 只允许操作该项目会话目录里的 .jsonl，防止渲染进程传入任意路径 */
function assertSessionFile(cwd: string, file: string): string {
  const norm = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const dir = norm(sessionDir(cwd)) + path.sep;
  if (typeof file !== "string" || !file.endsWith(".jsonl") || !norm(file).startsWith(dir)) {
    throw new Error("只能删除该项目自己的会话文件");
  }
  return path.resolve(file);
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
  const items = await Promise.all(names.map(async (name): Promise<SessionSummary | null> => {
    const file = path.join(dir, name);
    const cacheKey = normSessionFile(file);
    try {
      const info = await stat(file);
      const cached = sessionMetaCache.get(cacheKey);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return cached.summary;
      }
      const rawText = await readHeadText(file, info.size);
      const lines = rawText.split(/\r?\n/);
      let header: Record<string, any> = {};
      try { header = JSON.parse(lines[0] || "{}"); } catch { header = {}; }
      const title = firstUserText(lines);
      const summary: SessionSummary = {
        id: file,
        path: file,
        title: header.name || title || "新会话",
        empty: !title,
        timestamp: header.timestamp ? Date.parse(header.timestamp) : info.mtimeMs,
      };
      sessionMetaCache.set(cacheKey, { mtimeMs: info.mtimeMs, size: info.size, summary });
      return summary;
    } catch {
      sessionMetaCache.delete(cacheKey);
      return null;
    }
  }));
  return items
    .filter((item): item is SessionSummary => Boolean(item && (!item.empty || keepSet.has(normSessionFile(item.path)))))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export class PiHost {
  emit: (payload: { cwd: string; sessionFile?: string; event: any }) => void;
  trash: (file: string) => Promise<any>;
  clients: Map<string, WorkspaceClientPool>;
  starting: Map<string, Promise<void>>;
  maxIdleWorkers: number;
  private authorizedAttachmentPaths = new Set<string>();
  private authorizedWorkspaces = new Map<string, string>();
  private closing = false;

  constructor({ emit, trash }: PiHostOptions) {
    this.emit = emit;
    this.trash = trash ?? ((file: string) => unlink(file));
    this.clients = new Map();
    this.starting = new Map();
    this.maxIdleWorkers = 3;
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

  async open(cwd: string) {
    if (this.closing) throw new Error("Pi 宿主正在关闭");
    const authorized = await this.requireAuthorizedWorkspace(cwd);
    cwd = authorized;
    if (!this.clients.has(cwd)) {
      if (!this.starting.has(cwd)) {
        this.starting.set(cwd, this.start(cwd).finally(() => { this.starting.delete(cwd); }));
      }
      await this.starting.get(cwd);
    }
    return this.snapshot(cwd);
  }

  private async spawnWorker(
    cwd: string,
    pool: WorkspaceClientPool,
    options: { targetSessionFile?: string; pickLatestOnInit?: boolean; parentSession?: string } = {},
  ): Promise<WorkerSlot> {
    const client = new RpcClient({ cliPath: cliPath(), cwd });
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
      // Startup events can arrive before getState establishes the session identity.
      // Do not route an unowned event to the renderer's currently active session.
      if (slot.sessionFile) this.emit({ cwd, sessionFile: slot.sessionFile, event });
    });

    try {
      await client.start();
      let state = await client.getState();
      const initialFile = state.sessionFile ?? "";

      if (options.targetSessionFile) {
        if (normSessionFile(initialFile) !== normSessionFile(options.targetSessionFile)) {
          const switched = await client.switchSession(options.targetSessionFile);
          if (switched?.cancelled) throw new Error("会话切换已取消");
          if (initialFile && state.messageCount === 0) {
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
      const client = new RpcClient({ cliPath: cliPath(), cwd });
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

  async start(cwd: string): Promise<void> {
    const pool: WorkspaceClientPool = {
      client: null as unknown as RpcClient,
      activeSessionFile: "",
      workers: new Map(),
    };
    await this.spawnWorker(cwd, pool, { pickLatestOnInit: true });
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
      if (entry.name === ".git" || entry.name === ".pi" || entry.name === "node_modules") continue;
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
    const { root, target } = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, target);
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法打开");
    const maxSize = 2 * 1024 * 1024;
    if (info.size > maxSize) throw new Error("文件超过 2 MB，暂不支持在桌面端预览");
    const content = await readFile(target, "utf8");
    return {
      path: target,
      relative: path.relative(root, target).replace(/\\/g, "/"),
      name: path.basename(target),
      content,
      size: info.size,
    };
  }

  async writeWorkspaceFile(cwd: string, relative: string, content: string): Promise<WorkspaceFileData> {
    const { root, target } = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, target);
    if (typeof content !== "string") throw new Error("文件内容必须是文本");
    if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024) throw new Error("文件超过 20 MB，暂不支持保存");
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法修改");
    await writeFile(target, content, "utf8");
    return {
      path: target,
      relative: path.relative(root, target).replace(/\\/g, "/"),
      name: path.basename(target),
      content,
      size: Buffer.byteLength(content, "utf8"),
    };
  }

  async openWorkspacePath(cwd: string, relative: string): Promise<string> {
    const { target } = workspacePath(cwd, relative);
    await assertRealWorkspacePath(cwd, target);
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
  }

  async gitOverview(cwd: string): Promise<GitOverview> {
    const root = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, root);
    const branch = await gitBranch(root);
    try {
      const [statusOut, logOut] = await Promise.all([
        execFileAsync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root, maxBuffer: 2 * 1024 * 1024 }),
        execFileAsync(
          "git",
          ["log", "--graph", "--no-color", "-n", "60", "--pretty=format:\x1f%H\x1f%h\x1f%s\x1f%an\x1f%cr\x1f%D"],
          { cwd: root, maxBuffer: 2 * 1024 * 1024 },
        ).catch(() => ({ stdout: "" })),
      ]);

      const status: GitStatusFile[] = statusOut.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => ({
          code: line.slice(0, 2).trim() || "M",
          path: line.slice(3).trim().replace(/^"(.*)"$/, "$1"),
        }));

      const commits: GitCommitNode[] = [];
      for (const line of logOut.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parts = line.split("\x1f");
        if (parts.length >= 6) {
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
      }

      return { isRepo: true, branch: branch || "HEAD", status, commits };
    } catch {
      return { isRepo: false, branch: "", status: [], commits: [] };
    }
  }

  async gitInspect(cwd: string, kind: "commit" | "working", target: string): Promise<GitInspectResult> {
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
    await assertRealWorkspacePath(root, safeTarget);
    const relative = path.relative(safeRoot, safeTarget).replace(/\\/g, "/");
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "HEAD", "--unified=3", "--", relative],
      { cwd: safeRoot, maxBuffer: 4 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));

    let diff = stdout;
    if (!diff.trim()) {
      const content = await readFile(safeTarget, "utf8").catch(() => "");
      if (content) {
        const addedLines = content.split(/\r?\n/).map((l) => `+${l}`).join("\n");
        diff = `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1 @@\n${addedLines}`;
      }
    }

    return {
      kind: "working",
      target: relative,
      title: path.basename(relative),
      subtitle: relative,
      meta: "工作区未提交变更",
      diff,
    };
  }

  async completePaths(cwd: string, query = ""): Promise<WorkspaceEntry[]> {
    const root = path.resolve(cwd);
    await assertRealWorkspacePath(cwd, root);
    const entries = await walkDirectory(root, root, [], 5000);
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
      items: items.map(({ path: file, name, kind, image, mimeType, data }) => ({
        path: file,
        name,
        kind,
        image,
        mimeType: image ? mimeType : undefined,
        data: image && (data?.length ?? 0) <= 8 * 1024 * 1024 ? data : undefined,
      })),
      text: items.map((item) => item.text ?? "").join(""),
      images: items.filter((item) => item.image).map(({ mimeType, data }) => ({ type: "image", mimeType, data })),
    };
  }

  async snapshot(cwd: string, sessionFile?: string) {
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
  ): Promise<{ messages: any[]; startIndex: number; endIndex: number; total: number }> {
    try {
      assertSessionFile(cwd, sessionFile);
      return await readSessionHistoryPage(sessionFile, endIndex, limit);
    } catch (error) {
      throw new Error(`读取会话历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  requirePool(cwd: string): WorkspaceClientPool {
    const entry = this.clients.get(cwd);
    if (!entry) throw new Error("这个工作区还没有启动 Pi");
    return entry;
  }

  resolveSlot(cwd: string, sessionFile?: string): WorkerSlot {
    const pool = this.requirePool(cwd);
    if (sessionFile) {
      const byFile = pool.workers.get(normSessionFile(sessionFile));
      if (byFile) return byFile;
      throw new Error("未知的会话文件");
    }
    const active = pool.workers.get(normSessionFile(pool.activeSessionFile));
    if (active) return active;
    const first = pool.workers.values().next().value;
    if (first) return first;
    throw new Error("当前工作区没有可用的会话 Worker");
  }

  require(cwd: string, sessionFile?: string): RpcClient {
    return this.resolveSlot(cwd, sessionFile).client;
  }

  async call(cwd: string, method: string, args: any[] = [], sessionFile?: string) {
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
      assertSessionFile(cwd, targetFile);
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
        const res = await idleSlot.client.switchSession(targetFile);
        if (!res?.cancelled) {
          if (oldKey) pool.workers.delete(oldKey);
          if (oldFile && sessionMetaCache.get(oldKey)?.summary.empty) {
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
        if (normSessionFile(initialFile) !== normSessionFile(targetFile)) {
          const switched = await standby.client.switchSession(targetFile);
          if (switched?.cancelled) return switched;
          if (initialFile) unlink(initialFile).catch(() => {});
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
          if (oldFile && sessionMetaCache.get(oldKey)?.summary.empty) {
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
        if (restored[0]) {
          const created = await standby.client.newSession(restored[0]);
          if (created?.cancelled) return created;
          if (initialFile) unlink(initialFile).catch(() => {});
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

  async restart(cwd: string, sessionFile?: string) {
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
    if (this.clients.has(cwd)) throw new Error("请先关闭该项目的 Pi 进程");
    const items = await listSessions(cwd);
    const results = await Promise.allSettled(items.map((item) => this.trash(assertSessionFile(cwd, item.path))));
    const failed = results.filter((r) => r.status === "rejected").length;
    return { deleted: items.length - failed, failed };
  }

  sessions(cwd: string): Promise<SessionSummary[]> {
    const pool = this.clients.get(cwd);
    if (!pool) return listSessions(cwd);
    const keepFiles = [pool.activeSessionFile, ...[...pool.workers.values()].map((w) => w.sessionFile)].filter(Boolean);
    return listSessions(cwd, keepFiles);
  }

  async stopAll(): Promise<void> {
    this.closing = true;
    const allClients: RpcClient[] = [];
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
    return process.env.PI_CODING_AGENT_DIR || getAgentDir() || path.join(homedir(), ".pi", "agent");
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
    const targetCwd = cwd ? path.resolve(cwd) : homedir();
    const out = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        [cliPath(), "mcp", "list", "--json"],
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

  private createPackageManager(cwd?: string) {
    const agentDir = this.agentDirPath();
    const effectiveCwd = cwd ? path.resolve(cwd) : homedir();
    const settingsManager = SettingsManager.create(effectiveCwd, agentDir, { projectTrusted: true });
    const packageManager = new DefaultPackageManager({
      cwd: effectiveCwd,
      agentDir,
      settingsManager,
    });
    return { agentDir, effectiveCwd, settingsManager, packageManager };
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
    const { agentDir, effectiveCwd, packageManager } = this.createPackageManager(cwd);
    const globalSettingsPath = path.join(agentDir, "settings.json");
    const projectSettingsPath = cwd ? path.join(effectiveCwd, ".pi", "settings.json") : "";

    const configured = packageManager.listConfiguredPackages();
    let resolved = { extensions: [], skills: [], prompts: [], themes: [] } as any;
    try {
      resolved = await packageManager.resolve(async () => "skip");
    } catch {
      // ignore resolution errors on missing packages
    }

    const resources: PiResourceItem[] = [];
    const resourceTypes = ["extensions", "skills", "prompts", "themes"] as const;
    for (const type of resourceTypes) {
      for (const item of resolved[type] ?? []) {
        if (item?.metadata?.source === "builtin") continue;
        resources.push({
          path: item.path,
          name: path.basename(item.path),
          type,
          enabled: Boolean(item.enabled),
          scope: item.metadata?.scope ?? "user",
          origin: item.metadata?.origin ?? "top-level",
          source: item.metadata?.source ?? "local",
        });
      }
    }

    const packages: PiPackageItem[] = [];
    for (const item of configured) {
      const kind = this.classifySourceKind(item.source);
      let displayName = item.source.replace(/^npm:/, "").replace(/^git:/, "");
      let version: string | undefined;
      let description: string | undefined;

      if (item.installedPath) {
        const pkgJsonPath = path.join(item.installedPath, "package.json");
        if (existsSync(pkgJsonPath)) {
          try {
            const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf8"));
            if (pkgJson.name) displayName = pkgJson.name;
            if (pkgJson.version) version = String(pkgJson.version);
            if (pkgJson.description) description = String(pkgJson.description);
          } catch {
            // ignore malformed package.json
          }
        }
      }

      const counts = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
      if (item.installedPath) {
        const normRoot = path.resolve(item.installedPath).toLowerCase();
        for (const res of resources) {
          const normRes = path.resolve(res.path).toLowerCase();
          if (normRes.startsWith(normRoot)) {
            counts[res.type] += 1;
          }
        }
      }

      packages.push({
        source: item.source,
        scope: item.scope,
        kind,
        displayName,
        version,
        description,
        installed: Boolean(item.installedPath),
        installedPath: item.installedPath,
        filtered: Boolean(item.filtered),
        counts,
      });
    }

    return {
      agentDir,
      globalSettingsPath,
      projectSettingsPath,
      packages,
      resources,
    };
  }

  async packagesInstall(cwd: string, payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    const local = Boolean(payload?.local);
    if (local && !cwd) {
      throw new Error("当前未打开项目目录，无法安装到项目级配置");
    }
    const normalized = this.normalizeInstallSource(payload?.source ?? "", cwd);
    const { packageManager, settingsManager } = this.createPackageManager(cwd);
    await packageManager.installAndPersist(normalized, { local });
    await settingsManager.flush();
    return this.packagesOverview(cwd);
  }

  async packagesRemove(cwd: string, payload: { source: string; local?: boolean }): Promise<PiPackagesOverview> {
    const local = Boolean(payload?.local);
    const { packageManager, settingsManager } = this.createPackageManager(cwd);
    await packageManager.removeAndPersist(payload.source, { local });
    await settingsManager.flush();
    return this.packagesOverview(cwd);
  }

  async packagesUpdate(cwd: string, payload?: { source?: string }): Promise<PiPackagesOverview> {
    const { packageManager, settingsManager } = this.createPackageManager(cwd);
    await packageManager.update(payload?.source || undefined);
    await settingsManager.flush();
    return this.packagesOverview(cwd);
  }

  async skillsOverview(cwd?: string): Promise<PiSkillsOverview> {
    if (cwd) await assertRealWorkspacePath(cwd, path.resolve(cwd));
    const agentDir = this.agentDirPath();
    const effectiveCwd = cwd || homedir();
    const globalSkillsDir = path.join(agentDir, "skills");
    const projectSkillsDir = cwd ? path.join(effectiveCwd, ".pi", "skills") : "";
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
    const loader = new DefaultResourceLoader({ cwd: effectiveCwd, agentDir });
    await loader.reload();
    const result = loader.getSkills();
    return {
      agentDir,
      globalSkillsDir,
      projectSkillsDir,
      directories: [...directories].map(([skillPath, label]) => ({ label, path: skillPath })),
      skills: result.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        scope: skill.sourceInfo.scope,
        origin: skill.sourceInfo.origin,
        source: skill.sourceInfo.source,
        disableModelInvocation: skill.disableModelInvocation,
      })),
      diagnostics: result.diagnostics.map((item) => item.message ?? String(item)),
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
  const next = [cwd, ...(await readRecent(file)).filter((item) => item !== cwd)].slice(0, 20);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}

export async function forgetRecent(file: string, cwd: string): Promise<string[]> {
  const next = (await readRecent(file)).filter((item) => item !== cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}
