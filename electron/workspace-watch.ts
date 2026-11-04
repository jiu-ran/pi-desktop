import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

/**
 * 项目目录的磁盘监听。
 *
 * 项目的文件会在应用之外被改动：Agent 跑工具改文件、git 切分支、别的编辑器保存。
 * 前端只看得到自己发起的操作，所以这里在主进程盯住工作区根目录，把变化翻成
 * 「哪些目录要重读」+「哪些文件内容变了」两件事交给渲染层。
 *
 * 只关心工作区内部：`.git` / `node_modules` 这类目录的动静既不进文件树也不该进编辑器；
 * 我们自己原子写留下的临时文件（`.foo.md.pi-<hex>.tmp`）同样跳过。
 */

/** 与 `listDirectory` 的隐藏规则保持一致：这些目录不进文件树，变化也不用通知界面。 */
const IGNORED_SEGMENTS = new Set([".git", ".pi", ".pi-desktop", "node_modules"]);
/** `atomicWriteText` 的临时文件名：写入过程中的抖动没必要让界面刷一次。 */
const TEMP_FILE = /\.pi-[0-9a-f]{16}\.tmp$/;
/** 同时盯几个工作区：多开项目时不至于留一堆句柄。 */
const MAX_WATCHED = 8;

export interface WorkspaceDiskChange {
  /** 被监听的工作区根目录（绝对路径，主进程给的） */
  cwd: string;
  /** 变动的文件 / 目录，相对工作区、正斜杠。拿不到名字时是空数组。 */
  relativePaths: string[];
  /** 需要重新 readdir 的目录（相对工作区，`""` 是根目录） */
  directories: string[];
}

/** 这个相对路径的变化值不值得通知界面。 */
export function isWatchedRelative(relative: string): boolean {
  const normalized = relative.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false;
  return !TEMP_FILE.test(segments[segments.length - 1] ?? "");
}

/** `a/b/c.txt` → `a/b`；顶层项 → `""`（根目录）。 */
export function parentDirectoryOf(relative: string): string {
  const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function keyOf(root: string): string {
  return process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root);
}

interface Pending {
  paths: Set<string>;
  directories: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** 按工作区根目录收集 fs.watch 事件，去抖后一次性回调。 */
export class WorkspaceWatcher {
  private readonly watched = new Map<string, { root: string; watcher: FSWatcher }>();
  private readonly pending = new Map<string, Pending>();
  private readonly onChange: (change: WorkspaceDiskChange) => void;
  private readonly debounceMs: number;
  private closed = false;

  // 注意：不能用构造函数参数属性（`constructor(private readonly x)`）—— 仓库的检查脚本
  // 直接跑 Node 的类型擦除模式，那种写法会报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  constructor(onChange: (change: WorkspaceDiskChange) => void, debounceMs = 180) {
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  /** 幂等：已经盯着的目录直接返回。 */
  watch(cwd: string): void {
    if (this.closed || !cwd) return;
    const root = path.resolve(cwd);
    const key = keyOf(root);
    if (this.watched.has(key)) return;

    const watcher = this.open(root, key);
    if (!watcher) return;
    this.watched.set(key, { root, watcher });
    while (this.watched.size > MAX_WATCHED) {
      const oldest = this.watched.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      this.unwatchKey(oldest);
    }
  }

  unwatch(cwd: string): void {
    this.unwatchKey(keyOf(cwd));
  }

  unwatchKey(key: string): void {
    const entry = this.watched.get(key);
    if (!entry) return;
    this.watched.delete(key);
    try { entry.watcher.close(); } catch { /* 已经关掉了 */ }
    const pending = this.pending.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pending.delete(key);
  }

  closeAll(): void {
    this.closed = true;
    for (const key of [...this.watched.keys()]) this.unwatchKey(key);
    for (const pending of this.pending.values()) if (pending.timer) clearTimeout(pending.timer);
    this.pending.clear();
  }

  /** 当前盯着的根目录，测试与日志用。 */
  roots(): string[] {
    return [...this.watched.values()].map((entry) => entry.root);
  }

  private open(root: string, key: string): FSWatcher | null {
    const notify = (filename: string | Buffer | null): void => this.receive(root, key, filename);
    try {
      // 递归监听：Windows / macOS / Linux(Node 20+) 都支持，省掉逐层挂 watcher。
      return watch(root, { recursive: true, persistent: false }, (_event, filename) => notify(filename));
    } catch {
      try {
        return watch(root, { persistent: false }, (_event, filename) => notify(filename));
      } catch {
        return null;
      }
    }
  }

  private receive(root: string, key: string, filename: string | Buffer | null): void {
    if (this.closed) return;
    const raw = typeof filename === "string" ? filename : filename ? filename.toString() : "";
    const relative = raw.replace(/\\/g, "/");
    if (relative && !isWatchedRelative(relative)) return;

    const pending = this.pending.get(key) ?? { paths: new Set<string>(), directories: new Set<string>(), timer: null };
    if (relative) {
      pending.paths.add(relative);
      pending.directories.add(parentDirectoryOf(relative));
    } else {
      // 有些平台拿不到文件名：只能保守地认为「根目录可能变了」。
      pending.directories.add("");
    }
    this.pending.set(key, pending);
    if (pending.timer) return;
    pending.timer = setTimeout(() => this.flush(root, key), this.debounceMs);
  }

  private flush(root: string, key: string): void {
    const pending = this.pending.get(key);
    this.pending.delete(key);
    if (this.closed || !pending) return;
    const change: WorkspaceDiskChange = {
      cwd: root,
      relativePaths: [...pending.paths].sort(),
      directories: [...pending.directories].sort(),
    };
    if (!change.relativePaths.length && !change.directories.length) return;
    try { this.onChange(change); } catch { /* 渲染进程没了也不影响监听 */ }
  }
}
