import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Pi 的配置 / 资源 / 技能：全部由桌面端自己读写。
 *
 * 以前这些来自 `@earendil-works/pi-coding-agent` 的 `SettingsManager` /
 * `DefaultPackageManager` / `DefaultResourceLoader`。为了不把整份 Pi 打进安装包，
 * 这里按 Pi 的磁盘约定重新实现：
 *
 * - 设置：`<agentDir>/settings.json` 与 `<cwd>/.pi/settings.json`（项目级覆盖全局）
 * - 软件包：`<agentDir>/npm/node_modules/<名>`（项目级在 `<cwd>/.pi/npm/…`），
 *   git 源的检出目录是 `<agentDir>/git/<host>/<path>`
 * - 资源：顶层目录 `{extensions,skills,prompts,themes}` 自动发现 + 每个包的
 *   `package.json` 里 `pi` 字段声明的目录/文件
 * - 技能：扫 `<agentDir>/skills`、`~/.agents/skills`、项目 `.pi/skills`、
 *   项目 `.agents/skills` 与包内 `pi.skills`
 *
 * 与 Pi 的差异写在 docs/pi-compatibility.md 里（例如 `pi config` 那种 TUI 级
 * 的逐项启用开关没有对应实现）。
 */

const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

export type SettingsRecord = Record<string, any>;

interface ResourceItem {
  path: string;
  name: string;
  type: ResourceType;
  enabled: boolean;
  scope: "user" | "project";
  origin: "top-level" | "package";
  source: string;
}

interface PackageEntry {
  source: string;
  scope: "user" | "project";
  kind: "npm" | "git" | "local";
  filtered: boolean;
  /** 设置里写成对象时的原始值（含 autoload / 各类型过滤数组） */
  filteredEntry?: SettingsRecord;
  installedPath?: string;
}

interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  scope: "user" | "project";
  origin: "top-level" | "package";
  source: string;
  disableModelInvocation: boolean;
}

const SKILL_FILE = "SKILL.md";
const GIT_SOURCE = /^(git:|https?:\/\/|ssh:\/\/|git:\/\/)|^[^@\s/]+@[^:/\s]+:|(^|\.)(github|gitlab|bitbucket)\.com[/:]/i;

function isObject(value: unknown): value is SettingsRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function agentDirPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
}

function projectConfigDir(cwd: string): string {
  return path.join(cwd, ".pi");
}

function settingsPaths(cwd: string, agentDir: string): { global: string; project: string } {
  return { global: path.join(agentDir, "settings.json"), project: path.join(cwd, ".pi", "settings.json") };
}

/** 读一个 JSON 设置文件；损坏时返回空对象并带上原因（界面只展示路径，日志里能看到）。 */
function readSettingsFile(file: string): { value: SettingsRecord; error?: string } {
  if (!existsSync(file)) return { value: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { value: isObject(parsed) ? parsed : {} };
  } catch (error: any) {
    return { value: {}, error: `${file}：${error?.message ?? error}` };
  }
}

export function readSettings(cwd: string, agentDir: string) {
  const paths = settingsPaths(cwd, agentDir);
  const global = readSettingsFile(paths.global);
  const project = readSettingsFile(paths.project);
  const diagnostics = [global.error, project.error].filter(Boolean) as string[];
  return { global: global.value, project: project.value, paths, diagnostics };
}

/**
 * 从 git 源里拆出 host 与仓库路径（安装目录就是 `<root>/<host>/<path>`）。
 * 支持 `git:github.com/me/repo`、`git@host:me/repo`（scp）、`https://…/me/repo.git`、
 * `ssh://git@host:端口/me/repo`，以及 `@ref` / `#ref` 这种固定分支后缀。
 */
function parseGitLocation(source: string): { host: string; path: string } | null {
  const rest = source.replace(/^git:/, "").trim();
  let host = "";
  let repoPath = "";
  // scp 写法（git@host:owner/repo）只在没有协议前缀时才成立：
  // 否则 ssh://git@host:2222/… 会被误拆成 host 后面的端口当成路径
  const scp = rest.includes("://") ? null : /^[^@\s]+@([^:/\s]+):(.+)$/.exec(rest);
  if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const url = new URL(rest.includes("://") ? rest : `https://${rest}`);
      host = url.hostname;
      repoPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      return null;
    }
  }
  repoPath = repoPath.replace(/\.git$/, "").replace(/#.*$/, "");
  // `owner/repo@v1.2.0`：@ 后面是固定 ref，不参与安装目录
  const at = repoPath.lastIndexOf("@");
  if (at > 0) repoPath = repoPath.slice(0, at);
  if (!host || !repoPath) return null;
  return { host, path: repoPath };
}

export function parseSource(source: string): { kind: "npm" | "git" | "local"; name?: string; host?: string; path?: string } {
  const trimmed = String(source ?? "").trim();
  if (trimmed.startsWith("npm:")) {
    const spec = trimmed.slice(4).trim();
    // npm:foo@1.2.3 / npm:@scope/foo@^1 → 只要包名部分
    const at = spec.lastIndexOf("@");
    const name = at > 0 ? spec.slice(0, at) : spec;
    return { kind: "npm", name };
  }
  if (GIT_SOURCE.test(trimmed)) {
    const git = parseGitLocation(trimmed);
    if (git) return { kind: "git", host: git.host, path: git.path };
  }
  return { kind: "local", path: trimmed };
}

/** 包在磁盘上的位置（不存在就返回空，界面据此显示「未安装」）。 */
export function installedPathFor(source: string, scope: "user" | "project", cwd: string, agentDir: string): string {
  const parsed = parseSource(source);
  let candidate = "";
  if (parsed.kind === "npm" && parsed.name) {
    candidate =
      scope === "project"
        ? path.join(cwd, ".pi", "npm", "node_modules", parsed.name)
        : path.join(agentDir, "npm", "node_modules", parsed.name);
  } else if (parsed.kind === "git") {
    if (!parsed.host || !parsed.path) return "";
    candidate =
      scope === "project"
        ? path.join(cwd, ".pi", "git", parsed.host, parsed.path)
        : path.join(agentDir, "git", parsed.host, parsed.path);
  } else if (parsed.path) {
    const base = scope === "project" ? path.join(cwd, ".pi") : agentDir;
    const expanded = parsed.path.startsWith("~")
      ? path.join(homedir(), parsed.path.slice(1))
      : path.resolve(base, parsed.path);
    candidate = expanded;
  }
  return candidate && existsSync(candidate) ? candidate : "";
}

export function configuredPackages(global: SettingsRecord, project: SettingsRecord, cwd: string, agentDir: string): PackageEntry[] {
  const output: PackageEntry[] = [];
  for (const [scope, settings] of [["user", global], ["project", project]] as const) {
    for (const raw of (settings.packages ?? []) as unknown[]) {
      const entry = typeof raw === "string" ? raw : isObject(raw) ? String(raw.source ?? "") : "";
      if (!entry) continue;
      output.push({
        source: entry,
        scope,
        kind: parseSource(entry).kind,
        filtered: isObject(raw),
        filteredEntry: isObject(raw) ? raw : undefined,
        installedPath: installedPathFor(entry, scope, cwd, agentDir),
      });
    }
  }
  return output;
}

/** 目录下按扩展名收文件（跳过点目录与 node_modules，与 Pi 的自动发现一致）。 */
function collectFiles(dir: string, accept: (name: string) => boolean, depth = 0): string[] {
  if (depth > 8 || !existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(full);
        isDir = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) files.push(...collectFiles(full, accept, depth + 1));
    else if (isFile && accept(entry.name)) files.push(full);
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const EXTENSION_FILE = /\.(?:js|mjs|cjs|ts)$/i;
const PROMPT_FILE = /\.md$/i;
const THEME_FILE = /\.(?:json|jsonc)$/i;

function filesForType(dir: string, type: ResourceType): string[] {
  if (type === "skills") return collectFiles(dir, (name) => name === SKILL_FILE);
  if (type === "extensions") return collectFiles(dir, (name) => EXTENSION_FILE.test(name));
  if (type === "prompts") return collectFiles(dir, (name) => PROMPT_FILE.test(name));
  return collectFiles(dir, (name) => THEME_FILE.test(name));
}

/** 设置里如果把某个资源列进了数组，就按数组当白名单；没列就是全开。 */
function enabledByOverrides(file: string, overrides: unknown, baseDir: string): boolean {
  if (!Array.isArray(overrides) || overrides.length === 0) return true;
  const relative = path.relative(baseDir, file).split(path.sep).join("/");
  return overrides.some((item) => {
    const value = String(item ?? "").trim().replace(/^\.\//, "").split(path.sep).join("/");
    if (!value) return false;
    if (value === relative) return true;
    if (value.endsWith("/")) return relative.startsWith(value);
    return relative.startsWith(`${value}/`) || relative.includes(`/${value}`);
  });
}

/** 顶层目录自动发现（`<agentDir>/<type>`、`<cwd>/.pi/<type>`、`~/.agents/skills`）。 */
export function autoResources(
  settings: { global: SettingsRecord; project: SettingsRecord },
  cwd: string,
  agentDir: string,
): ResourceItem[] {
  const items: ResourceItem[] = [];
  const scopes: Array<{ scope: "user" | "project"; base: string; values: SettingsRecord }> = [
    { scope: "project", base: projectConfigDir(cwd), values: settings.project },
    { scope: "user", base: agentDir, values: settings.global },
  ];
  for (const type of RESOURCE_TYPES) {
    for (const { scope, base, values } of scopes) {
      for (const file of filesForType(path.join(base, type), type)) {
        items.push({
          path: file,
          name: path.basename(file),
          type,
          enabled: enabledByOverrides(file, values[type], base),
          scope,
          origin: "top-level",
          source: "auto",
        });
      }
    }
    // 用户级 ~/.agents/skills 也是 Pi 的自动发现目录（只有技能）
    if (type === "skills") {
      const agentsDir = path.join(homedir(), ".agents", "skills");
      for (const file of filesForType(agentsDir, type)) {
        items.push({
          path: file,
          name: path.basename(file),
          type,
          enabled: enabledByOverrides(file, settings.global.skills, path.dirname(agentsDir)),
          scope: "user",
          origin: "top-level",
          source: "auto",
        });
      }
    }
  }
  return items;
}

/** 一个包里声明的资源：读 `package.json` 的 `pi` 字段。 */
export function packageResources(entry: PackageEntry, settings: { global: SettingsRecord; project: SettingsRecord }): ResourceItem[] {
  if (!entry.installedPath) return [];
  const manifestPath = path.join(entry.installedPath, "package.json");
  if (!existsSync(manifestPath)) return [];
  let manifest: SettingsRecord = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }
  const declared = isObject(manifest.pi) ? manifest.pi : {};
  const filter = isObject(entry.filteredEntry) ? (entry.filteredEntry as SettingsRecord) : null;
  const items: ResourceItem[] = [];
  for (const type of RESOURCE_TYPES) {
    // 设置里写成了对象：列出来的类型数组当白名单；autoload: false 时没列的一律不启用
    const patterns = filter && Array.isArray(filter[type]) ? (filter[type] as string[]) : null;
    const autoloadOff = filter?.autoload === false;
    const values = Array.isArray(declared[type]) ? (declared[type] as string[]) : [];
    for (const value of values) {
      const target = path.resolve(entry.installedPath, value);
      const files = existsSync(target) && statSync(target).isDirectory() ? filesForType(target, type) : existsSync(target) ? [target] : [];
      for (const file of files) {
        const name = path.basename(file);
        const enabled = patterns ? enabledByOverrides(file, patterns, entry.installedPath) : !autoloadOff;
        items.push({
          path: file,
          name,
          type,
          enabled,
          scope: entry.scope,
          origin: "package",
          source: entry.source,
        });
      }
    }
  }
  return items;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
}

/** 只解析 SKILL.md 顶部的 `---` 块：字段简单（含 `|` / `>` 块文本），不引 YAML 依赖。 */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.trimStart());
  if (!match) return {};
  const result: SkillFrontmatter = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    let value = pair[2].trim();
    // 块文本：`|` 保留换行，`>` 折叠成空格；后续缩进行都属于这个值
    const block = /^([|>])[+-]?$/.exec(value);
    if (block) {
      const collected: string[] = [];
      while (index + 1 < lines.length && (/^\s+\S/.test(lines[index + 1]) || lines[index + 1].trim() === "")) {
        collected.push(lines[index + 1].trim());
        index += 1;
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop();
      value = block[1] === "|" ? `${collected.join("\n")}\n` : `${collected.join(" ")}\n`;
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "disable-model-invocation" || key === "disablemodelinvocation") result.disableModelInvocation = value === "true";
  }
  return result;
}

/** 从资源列表里抽出技能项（含 frontmatter）。 */
export async function skillsFromResources(resources: ResourceItem[]): Promise<{ skills: SkillItem[]; diagnostics: string[] }> {
  const skills: SkillItem[] = [];
  const diagnostics: string[] = [];
  for (const resource of resources) {
    if (resource.type !== "skills" || !resource.enabled) continue;
    let text = "";
    try {
      text = await readFile(resource.path, "utf8");
    } catch (error: any) {
      diagnostics.push(`${resource.path}：${error?.message ?? error}`);
      continue;
    }
    const front = parseSkillFrontmatter(text);
    const baseDir = path.dirname(resource.path);
    const name = front.name || path.basename(baseDir);
    if (!front.description) diagnostics.push(`${resource.path}：缺少 description，列表里会显示为空`);
    skills.push({
      name,
      description: front.description ?? "",
      filePath: resource.path,
      baseDir,
      scope: resource.scope,
      origin: resource.origin,
      source: resource.source,
      disableModelInvocation: Boolean(front.disableModelInvocation),
    });
  }
  return { skills, diagnostics };
}

/** 用本机 pi 跑一条 CLI 命令（安装 / 卸载 / 更新软件包）。 */
export function runPiCli(entry: string, args: string[], cwd?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, ...args],
      {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", FORCE_COLOR: "0", GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
      },
      (error, stdout = "", stderr = "") => {
        const output = `${stdout}${stderr}`.trim();
        if (error) {
          const code = typeof (error as any).code === "number" ? (error as any).code : 1;
          resolve({ code, output: output || String((error as any).message ?? error) });
          return;
        }
        resolve({ code: 0, output });
      },
    );
  });
}
