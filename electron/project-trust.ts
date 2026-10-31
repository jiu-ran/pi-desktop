/**
 * 项目信任（Pi 的 `trust.json`）。
 *
 * 为什么需要这一层：Pi 在加载项目的 `.pi/settings.json`、`.pi/extensions`、`.pi/skills`
 * 这类「会执行代码 / 注入设定」的东西之前，要求先信任这个目录。CLI 里它会弹窗问一句；
 * 桌面端走 RPC（没有 TUI），Pi 拿不到回答就**一律按不信任处理**——于是项目级扩展、
 * 技能、MCP 静默不生效，而桌面端自己的文件扫描却把它们列出来了。
 *
 * 所以桌面端自己实现 `/trust`：直接读写 Pi 的 `<agentDir>/trust.json`（格式与 Pi 一致：
 * 绝对路径 → true / false，键排序、两空格缩进），再重启 Pi 进程让资源重新加载。
 */

import { existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { atomicWriteText, withFileWrite } from "./atomic-file.ts";
import { agentDirPath } from "./pi-resources.ts";

/** 这些项目级资源会让 Pi 要求先信任目录（与 Pi 的 trust-manager 保持一致）。 */
export const TRUST_REQUIRING_ENTRIES = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

export type TrustDecision = boolean | null;
export type TrustAction = "trust" | "trust-parent" | "distrust";

export interface ProjectTrustStatus {
  cwd: string;
  /** 当前生效的决定：命中祖先目录也算 */
  decision: TrustDecision;
  /** 命中的那条记录写在哪个目录上（没有记录时为空） */
  recordedAt: string;
  /** 这个项目有没有需要信任的资源（没有的话 Pi 不校验） */
  needsTrust: boolean;
  /** 真正生效的结果：needsTrust 且没有信任记录时，Pi 在 RPC 模式下按不信任处理 */
  effective: boolean;
}

export function trustFilePath(agentDir = agentDirPath()): string {
  return path.join(agentDir, "trust.json");
}

/** 与 Pi 的 canonicalizePath 一致：能 realpath 就用真实路径（Windows 上还能统一大小写）。 */
export function canonicalTrustPath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isTrustDecision(value: unknown): value is TrustDecision {
  return value === true || value === false || value === null;
}

/** 读 trust.json；坏行/坏值不抛错，交给调用方连同 diagnostics 一起展示。 */
export async function readTrustStore(file: string): Promise<{ store: Record<string, TrustDecision>; error?: string }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { store: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error: any) {
    return { store: {}, error: `${file}：${error?.message ?? error}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { store: {}, error: `${file}：内容不是对象` };
  }
  const store: Record<string, TrustDecision> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isTrustDecision(value)) store[key] = value;
  }
  return { store };
}

/** 按 Pi 的写法落盘：键排序、两空格缩进、结尾换行，避免和 Pi 自己写的内容来回抖动。 */
export async function writeTrustStore(file: string, store: Record<string, TrustDecision>): Promise<void> {
  const sorted: Record<string, boolean> = {};
  for (const key of Object.keys(store).sort()) {
    const value = store[key];
    if (value === true || value === false) sorted[key] = value;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteText(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** 从 cwd 往上找最近的一条记录（与 Pi 的 findNearestTrustEntry 同规则）。 */
export function nearestTrustEntry(
  store: Record<string, TrustDecision>,
  cwd: string,
): { path: string; decision: TrustDecision } | null {
  let current = canonicalTrustPath(cwd);
  for (;;) {
    const value = store[current];
    if (value === true || value === false) return { path: current, decision: value };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 这个目录有没有需要先信任的项目级资源（`.pi/*` 或祖先目录的 `.agents/skills`）。 */
export function projectNeedsTrust(cwd: string, homeDir = homedir()): boolean {
  const start = canonicalTrustPath(cwd);
  const configDir = path.join(start, ".pi");
  if (TRUST_REQUIRING_ENTRIES.some((entry) => existsSync(path.join(configDir, entry)))) return true;
  const userSkills = path.join(canonicalTrustPath(homeDir), ".agents", "skills");
  let current = start;
  for (;;) {
    const skills = path.join(current, ".agents", "skills");
    if (skills !== userSkills && existsSync(skills)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * 读一次完整状态。
 *
 * `defaultProjectTrust` 取自 Pi 的全局设置：`always` 直接算信任，`never` 算不信任，
 * `ask`（默认值）在 RPC 模式下拿不到答案，等价于不信任——这正是要显式告诉用户的地方。
 */
export async function projectTrustStatus({
  cwd,
  agentDir = agentDirPath(),
  defaultProjectTrust = "ask",
}: {
  cwd: string;
  agentDir?: string;
  defaultProjectTrust?: string;
}): Promise<ProjectTrustStatus> {
  const file = trustFilePath(agentDir);
  const { store } = await readTrustStore(file);
  const entry = nearestTrustEntry(store, cwd);
  const needsTrust = projectNeedsTrust(cwd);
  const decision = entry?.decision ?? null;
  const fallback = defaultProjectTrust === "always" ? true : defaultProjectTrust === "never" ? false : false;
  return {
    cwd: canonicalTrustPath(cwd),
    decision,
    recordedAt: entry?.path ?? "",
    needsTrust,
    effective: needsTrust ? decision ?? fallback : true,
  };
}

/**
 * 写入一次信任决定。
 *
 * 「信任上一级目录」与 Pi 的交互弹窗一致：祖先记 true、本目录的记录删掉（继承祖先）。
 */
export async function setProjectTrust({
  cwd,
  action,
  agentDir = agentDirPath(),
  defaultProjectTrust = "ask",
}: {
  cwd: string;
  action: TrustAction;
  agentDir?: string;
  defaultProjectTrust?: string;
}): Promise<ProjectTrustStatus> {
  const file = trustFilePath(agentDir);
  const target = canonicalTrustPath(cwd);
  const parent = path.dirname(target);
  const updates: Array<{ path: string; decision: TrustDecision }> =
    action === "trust"
      ? [{ path: target, decision: true }]
      : action === "distrust"
        ? [{ path: target, decision: false }]
        : parent === target
          ? [{ path: target, decision: true }]
          : [
              { path: parent, decision: true },
              { path: target, decision: null },
            ];
  await withFileWrite(file, async () => {
    const { store } = await readTrustStore(file);
    for (const update of updates) {
      if (update.decision === null) delete store[update.path];
      else store[update.path] = update.decision;
    }
    await writeTrustStore(file, store);
  });
  return projectTrustStatus({ cwd, agentDir, defaultProjectTrust });
}
