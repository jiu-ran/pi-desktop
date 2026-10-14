import { readdir, readFile, mkdir, lstat, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

/**
 * PiHost：宿主侧的工作区进程池。
 * 一个工作区一个 `pi --mode rpc`，只通过官方 RpcClient 通信，不读写 Pi 的配置。
 */

function cliPath() {
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return path.join(path.dirname(entry), "cli.js");
}

/** 与 Pi 的 getDefaultSessionDir 保持同一编码规则。 */
function sessionDir(cwd) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  const resolved = path.resolve(cwd);
  const encoded = `--${[...resolved].map((ch) => ("\\/:".includes(ch) ? "-" : ch)).join("").replace(/^-/, "")}--`;
  return path.join(agentDir, "sessions", encoded);
}

const IMAGE_MIME = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);
const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".css", ".scss", ".less", ".html", ".xml",
  ".json", ".jsonl", ".md", ".txt", ".yml", ".yaml", ".toml", ".ini", ".env", ".csv",
  ".py", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".sh", ".ps1",
]);

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function isProbablyText(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || !path.extname(file);
}

function workspacePath(cwd, relative = "") {
  const root = path.resolve(cwd);
  const target = path.resolve(root, relative || ".");
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error("路径必须位于当前项目目录内");
  return { root, target };
}

async function walkDirectory(root, current = root, output = [], limit = 400) {
  if (output.length >= limit) return output;
  let entries = [];
  try { entries = await readdir(current, { withFileTypes: true }); } catch { return output; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pi") continue;
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

async function prepareAttachment(cwd, target) {
  const file = path.resolve(target);
  const info = { path: file, name: path.basename(file), kind: "file", image: false };
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

function firstUserText(lines) {
  for (const line of lines.slice(0, 80)) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry.message ?? entry;
      if (message.role !== "user") continue;
      const content = message.content;
      const text = typeof content === "string" ? content : content?.find((part) => part.type === "text")?.text;
      if (text) return text.replace(/\s+/g, " ").trim();
    } catch {
      // 跳过损坏行
    }
  }
  return "";
}

/** 当前分支：向上查找 .git（兼容 worktree 的 gitdir 文件），只读 HEAD，不调用 git。 */
export async function gitBranch(cwd) {
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
function assertSessionFile(cwd, file) {
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const dir = norm(sessionDir(cwd)) + path.sep;
  if (typeof file !== "string" || !file.endsWith(".jsonl") || !norm(file).startsWith(dir)) {
    throw new Error("只能删除该项目自己的会话文件");
  }
  return path.resolve(file);
}

export async function listSessions(cwd, keepFile = "") {
  const dir = sessionDir(cwd);
  let names = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const items = await Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    try {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      let header = {};
      try { header = JSON.parse(lines[0] || "{}"); } catch { header = {}; }
      const title = firstUserText(lines);
      return {
        id: file,
        path: file,
        title: header.name || title || "新会话",
        empty: !title,
        timestamp: header.timestamp ? Date.parse(header.timestamp) : 0,
      };
    } catch {
      return null;
    }
  }));
  return items
    .filter((item) => item && (!item.empty || item.path === keepFile))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export class PiHost {
  /**
   * @param {{ emit: Function, trash?: (file: string) => Promise<void> }} options
   *   trash：删除会话文件的方式。桌面端传入 shell.trashItem（移入回收站，可恢复），
   *   与 Pi 终端版「优先 trash」的做法一致；不传时直接删除。
   */
  constructor({ emit, trash }) {
    this.emit = emit;
    this.trash = trash ?? ((file) => unlink(file));
    this.clients = new Map();
    this.starting = new Map();
  }

  async open(cwd) {
    // 同一目录并发打开时只启动一个进程
    if (!this.clients.has(cwd)) {
      if (!this.starting.has(cwd)) {
        this.starting.set(cwd, this.start(cwd).finally(() => this.starting.delete(cwd)));
      }
      await this.starting.get(cwd);
    }
    return this.snapshot(cwd);
  }

  async start(cwd) {
    const client = new RpcClient({ cliPath: cliPath(), cwd });
    await client.start();
    client.onEvent((event) => this.emit({ cwd, event }));

    // 新进程默认是空会话：目录里有历史时自动接上最近一条。
    const state = await client.getState();
    const history = await listSessions(cwd, state.sessionFile);
    const latest = history.find((item) => !item.empty && item.path !== state.sessionFile);
    if (latest && state.messageCount === 0) {
      try { await client.switchSession(latest.path); } catch { /* 保持当前会话 */ }
    }
    this.clients.set(cwd, { client });
  }

  async listDirectory(cwd, relative = "") {
    const { root, target } = workspacePath(cwd, relative);
    let info;
    try { info = await lstat(target); } catch { throw new Error("目录不存在或无法访问"); }
    if (!info.isDirectory()) throw new Error("只能查看目录内容");

    let entries;
    try { entries = await readdir(target, { withFileTypes: true }); } catch { throw new Error("无法读取目录内容"); }
    const result = [];
    for (const entry of entries) {
      // .git 与 .pi 是项目内部元数据，不在文件树中展开；保留 .gitignore 等普通文件。
      if (entry.name === ".git" || entry.name === ".pi") continue;
      const absolute = path.join(target, entry.name);
      let entryInfo;
      try { entryInfo = await lstat(absolute); } catch { continue; }
      // 不跟随符号链接，避免文件树越出当前项目目录。
      if (entryInfo.isSymbolicLink()) continue;
      const kind = entryInfo.isDirectory() ? "folder" : entryInfo.isFile() ? "file" : "other";
      if (kind === "other") continue;
      const childRelative = path.relative(root, absolute).replace(/\\/g, "/");
      result.push({ path: absolute, relative: childRelative, name: entry.name, kind });
    }
    return result.sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  async readWorkspaceFile(cwd, relative) {
    const { root, target } = workspacePath(cwd, relative);
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

  async writeWorkspaceFile(cwd, relative, content) {
    const { root, target } = workspacePath(cwd, relative);
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

  async openWorkspacePath(cwd, relative) {
    const { target } = workspacePath(cwd, relative);
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw new Error("文件不存在或无法打开");
    return target;
  }

  async completePaths(cwd, query = "") {
    const root = path.resolve(cwd);
    const entries = await walkDirectory(root, root, [], 5000);
    const q = String(query).trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

    // Air 的文件补全不是简单的 readdir 顺序：文件名的精确/前缀命中
    // 应排在路径片段命中之前，再用子序列匹配兜底。这里保持搜索在主进程，
    // 不把项目目录暴露给 renderer，也避免每次输入都读取文件内容。
    function score(relative) {
      const value = relative.toLowerCase();
      const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
      const name = trimmed.split("/").at(-1) ?? trimmed;
      if (!q) return 0;
      if (name === q) return 0;
      if (name.startsWith(q)) return 10;
      if (trimmed.startsWith(q)) return 20;
      if (name.includes(q)) return 30;
      if (trimmed.includes(q)) return 40;

      // 简单的 fuzzy 匹配：字符必须按顺序出现，间隔越小越靠前。
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
      .filter((item) => item.score !== null)
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

  async prepareAttachments(cwd, paths = []) {
    if (!Array.isArray(paths) || paths.length > 20) throw new Error("一次最多添加 20 个文件或文件夹");
    const items = [];
    for (const target of paths) {
      if (typeof target !== "string" || !target.trim()) continue;
      items.push(await prepareAttachment(cwd, target));
    }
    return {
      items: items.map(({ path: file, name, kind, image }) => ({ path: file, name, kind, image })),
      text: items.map((item) => item.text).join(""),
      images: items.filter((item) => item.image).map(({ mimeType, data }) => ({ type: "image", mimeType, data })),
    };
  }

  async snapshot(cwd) {
    const client = this.require(cwd);
    const state = await client.getState();
    const [models, levels, messages, sessions, commands, branch] = await Promise.all([
      client.getAvailableModels(),
      client.getAvailableThinkingLevels(),
      client.getMessages(),
      listSessions(cwd, state.sessionFile),
      client.getCommands().catch(() => []),
      gitBranch(cwd),
    ]);
    return { state, models, levels, messages, sessions, commands, branch };
  }

  require(cwd) {
    const entry = this.clients.get(cwd);
    if (!entry) throw new Error("这个工作区还没有启动 Pi");
    return entry.client;
  }

  /**
   * 白名单式 RPC 调用。只允许调用 RpcClient 的公开方法，
   * 渲染进程与插件无法注入任意命令。
   */
  async call(cwd, method, args = []) {
    const allowed = new Set([
      "prompt", "steer", "followUp", "abort", "clearQueue",
      "newSession", "switchSession", "getState", "getMessages",
      "setModel", "getAvailableModels", "setThinkingLevel", "getAvailableThinkingLevels",
      "compact", "getSessionStats", "getCommands", "getTree", "fork", "setSessionName",
      "clone", "getForkMessages", "getLastAssistantText", "exportHtml",
    ]);
    if (!allowed.has(method)) throw new Error(`不允许的 RPC 方法：${method}`);
    const client = this.require(cwd);
    // IPC 会把 undefined 变成 null，这里还原成 undefined，保持 RpcClient 的可选参数语义
    const restored = (args ?? []).map((arg) => (arg === null ? undefined : arg));
    return client[method](...restored);
  }

  /**
   * 回写 extension_ui_response。RpcClient 没有公开这个入口，
   * 按官方 examples/rpc-extension-ui.ts 的做法直接写入子进程 stdin。
   */
  respondExtensionUi(cwd, response) {
    const client = this.require(cwd);
    const stdin = client.process?.stdin;
    if (!stdin || !stdin.writable) throw new Error("Pi 进程不可写");
    const payload = { type: "extension_ui_response", id: String(response.id) };
    if (response.cancelled) payload.cancelled = true;
    else if ("confirmed" in response) payload.confirmed = Boolean(response.confirmed);
    else payload.value = response.value ?? "";
    stdin.write(`${JSON.stringify(payload)}\n`);
  }

  /**
   * 重启工作区的 pi 进程（/reload）：重新加载扩展、技能、提示模板与上下文文件，
   * 并回到重启前的会话。
   */
  async restart(cwd) {
    const entry = this.clients.get(cwd);
    let file = "";
    if (entry) {
      try { file = (await entry.client.getState()).sessionFile ?? ""; } catch { /* 进程可能已退出 */ }
      this.clients.delete(cwd);
      await entry.client.stop().catch(() => {});
    }
    await this.open(cwd);
    if (file) {
      const client = this.require(cwd);
      const state = await client.getState();
      if (state.sessionFile !== file) await client.switchSession(file).catch(() => {});
    }
    return this.snapshot(cwd);
  }

  /** 停止并移除某个项目的 pi 进程 */
  async close(cwd) {
    await this.starting.get(cwd)?.catch(() => {});
    const entry = this.clients.get(cwd);
    if (!entry) return false;
    this.clients.delete(cwd);
    await entry.client.stop().catch(() => {});
    return true;
  }

  /**
   * 删除一个会话。要删的是正在使用的会话时，先让 Pi 切到最近的另一个会话
   *（没有就新建），再删除文件，避免 Pi 继续往已删除的文件里写。
   */
  async deleteSession(cwd, file) {
    const target = assertSessionFile(cwd, file);
    const client = this.clients.get(cwd)?.client;
    if (client) {
      const state = await client.getState();
      if (state.sessionFile && path.resolve(state.sessionFile) === target) {
        if (state.isStreaming) throw new Error("任务正在运行，请先停止再删除");
        const next = (await listSessions(cwd)).find((item) => !item.empty && path.resolve(item.path) !== target);
        if (next) await client.switchSession(next.path);
        else await client.newSession();
      }
    }
    await this.trash(target);
    return this.sessions(cwd);
  }

  /** 删除该项目的全部会话（用于「移除项目并删除会话」，调用前应先 close） */
  async deleteAllSessions(cwd) {
    if (this.clients.has(cwd)) throw new Error("请先关闭该项目的 Pi 进程");
    const items = await listSessions(cwd);
    const results = await Promise.allSettled(items.map((item) => this.trash(assertSessionFile(cwd, item.path))));
    const failed = results.filter((r) => r.status === "rejected").length;
    return { deleted: items.length - failed, failed };
  }

  sessions(cwd) {
    const entry = this.clients.get(cwd);
    if (!entry) return listSessions(cwd);
    return entry.client.getState().then((state) => listSessions(cwd, state.sessionFile));
  }

  async stopAll() {
    const clients = [...this.clients.values()].map((entry) => entry.client);
    this.clients.clear();
    await Promise.allSettled(clients.map((client) => client.stop()));
  }
}

export async function readRecent(file) {
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(saved) ? saved.filter((cwd) => typeof cwd === "string") : [];
  } catch {
    return [];
  }
}

export async function writeRecent(file, cwd) {
  const next = [cwd, ...(await readRecent(file)).filter((item) => item !== cwd)].slice(0, 20);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}

export async function forgetRecent(file, cwd) {
  const next = (await readRecent(file)).filter((item) => item !== cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}
