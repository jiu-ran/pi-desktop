/**
 * Pi 工具开关：读写 Pi 的 `defaultTools`，并把它翻译成启动参数。
 *
 * 为什么是 `defaultTools` 而不是桌面端自己存一份：
 * - 工具选择是 Pi 的能力，Pi 已经把这个设置定义在 `settings.json` 里，终端里的 `pi`
 *   也应该跟着用户的开关走；
 * - `--tools` 的普通名单会过滤掉未列出的扩展工具（子代理等），不能用来做「只开关内置工具」；
 *   而 `defaultTools` 只决定启动时激活哪些工具，扩展工具仍按自己的默认值注册。
 *
 * 已有会话会从会话记录里恢复当时的工具（Pi 1.3 起的行为），只改 `defaultTools`
 * 不一定能改掉它。所以桌面端启动 Pi 时再用 `--tools +name/-name`（Pi 1.1 起是叠加语义）
 * 把目录里的工具校正一次：只影响内置工具，不碰 MCP 与其它扩展工具。
 */

/** Pi 在没有 `defaultTools` 时启用的工具。 */
export const PI_DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

export interface PiToolMeta {
  name: string;
  label: string;
  description: string;
  group: "builtin" | "extension";
  /** 只在对应平台上存在的工具（powershell 只在 Windows 上注册）。 */
  windowsOnly?: boolean;
}

/**
 * 桌面端认识的工具。Pi 升级新增内置工具时，这里要跟着补 —— `pi-tools.check.ts`
 * 会校验目录里的默认工具与 Pi 的默认值一致，但新增工具只能靠人读更新日志。
 */
export const PI_TOOL_CATALOG: PiToolMeta[] = [
  {
    name: "read",
    label: "读取文件",
    description: "读取文本文件与支持的图片",
    group: "builtin",
  },
  {
    name: "bash",
    label: "运行命令",
    description: "在本机 shell 里执行命令；关闭后模型不能跑命令，但终端与文件区不受影响",
    group: "builtin",
  },
  {
    name: "powershell",
    label: "PowerShell",
    description: "在 Windows 上执行 PowerShell 命令",
    group: "builtin",
    windowsOnly: true,
  },
  {
    name: "edit",
    label: "编辑文件",
    description: "对已有文件做精确文本替换",
    group: "builtin",
  },
  {
    name: "write",
    label: "写入文件",
    description: "创建文件或覆盖已有内容",
    group: "builtin",
  },
  {
    name: "grep",
    label: "搜索内容",
    description: "按模式搜索文件内容",
    group: "builtin",
  },
  {
    name: "find",
    label: "查找文件",
    description: "按 glob 查找路径",
    group: "builtin",
  },
  {
    name: "ls",
    label: "列出目录",
    description: "列出目录内容",
    group: "builtin",
  },
  {
    name: "codemode",
    label: "Codemode 脚本",
    description: "用一段 JavaScript 并行调用其它工具，只把脚本输出交给模型",
    group: "extension",
  },
  {
    name: "tool_search",
    label: "工具搜索",
    description: "按需搜索并加载尚未声明给模型的工具（含 MCP 工具）",
    group: "extension",
  },
];

const CATALOG_NAMES = new Set(PI_TOOL_CATALOG.map((tool) => tool.name));
const DEFAULT_NAMES = new Set<string>(PI_DEFAULT_TOOL_NAMES);

/** 工具名 / 通配模式的字面形状；写入前挡掉带逗号或前缀的乱值。 */
const TOOL_NAME = /^[A-Za-z0-9_.*-]+$/;

export interface ToolSettingsLike {
  defaultTools?: unknown;
}

export function isToolModifier(entry: unknown): entry is string {
  return typeof entry === "string" && (entry.startsWith("+") || entry.startsWith("-"));
}

/** 只保留字符串条目：坏掉的设置值不应该把整个列表带偏。 */
export function toolEntries(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** 设置里是否显式写了 `defaultTools`（空数组也算：它表示全部停用）。 */
export function hasToolSelection(settings: ToolSettingsLike | null | undefined): boolean {
  return Boolean(settings) && Object.prototype.hasOwnProperty.call(settings, "defaultTools");
}

/**
 * 两层设置的合并，规则与 Pi 的 `mergeDefaultTools` 一致：
 * 上层是普通名单就整体替换；只有 `+name` / `-name` 时追加到下层后面。
 */
export function mergeToolEntries(base: unknown, override: unknown): string[] | undefined {
  if (override === undefined) return base === undefined ? undefined : toolEntries(base);
  const baseList = Array.isArray(base) ? toolEntries(base) : null;
  const overrideList = Array.isArray(override) ? toolEntries(override) : null;
  if (!baseList || !overrideList || !overrideList.every(isToolModifier)) return toolEntries(override);
  return [...baseList, ...overrideList];
}

/**
 * 解析 `defaultTools`：有普通名单就用它替换默认值，否则从 Pi 的默认工具出发，
 * 再按顺序应用 `+name` / `-name`。空数组表示全部停用；`undefined` 表示没配置，
 * 保持 Pi 的默认工具。
 */
export function resolveToolEntries(entries: unknown): string[] {
  if (entries === undefined) return [...PI_DEFAULT_TOOL_NAMES];
  const list = Array.isArray(entries) ? toolEntries(entries) : [];
  const modifiers = list.filter(isToolModifier);
  const plain = list.filter((entry) => !isToolModifier(entry));
  const base: string[] = plain.length > 0 || list.length === 0 ? plain : [...PI_DEFAULT_TOOL_NAMES];
  const result: string[] = [...base];
  for (const entry of modifiers) {
    const name = entry.slice(1);
    const index = result.indexOf(name);
    if (!name) continue;
    if (entry.startsWith("+") && index === -1) result.push(name);
    else if (entry.startsWith("-") && index !== -1) result.splice(index, 1);
  }
  return result;
}

/** 全局 + 项目设置解析出的实际工具选择。 */
export function resolveSettingsTools(
  globalSettings: ToolSettingsLike | null | undefined,
  projectSettings: ToolSettingsLike | null | undefined,
): string[] {
  const merged = mergeToolEntries(globalSettings?.defaultTools, projectSettings?.defaultTools);
  return resolveToolEntries(merged);
}

/** 编辑某个作用域时从哪份选择出发（项目普通名单会替换全局）。 */
export function scopeBaseEntries(
  scope: "global" | "project",
  globalEntries: unknown,
  projectEntries: unknown,
  projectConfigured: boolean,
): string[] {
  if (scope === "global" || !projectConfigured) return resolveToolEntries(globalEntries);
  const project = toolEntries(projectEntries);
  if (project.some((entry) => !isToolModifier(entry))) return resolveToolEntries(project);
  return resolveToolEntries(mergeToolEntries(globalEntries, projectEntries));
}

/**
 * 计算写入某个作用域的新 `defaultTools`：从该作用域当前的选择出发，加上或去掉一个工具，
 * 再写成普通名单（解析后的结果）。写普通名单而不是继续叠 `+/-`，是为了让文件里看到的就是
 * 实际选择；目录外的条目（扩展工具名、`mcp__*` 模式）已经包含在解析结果里，不会被丢掉。
 */
export function toggleToolEntries(options: {
  scope: "global" | "project";
  globalEntries: unknown;
  projectEntries: unknown;
  projectConfigured: boolean;
  name: string;
  enabled: boolean;
}): string[] {
  const { scope, globalEntries, projectEntries, projectConfigured, name, enabled } = options;
  if (!TOOL_NAME.test(name)) throw new Error(`工具名不合法：${name}`);
  const base = scopeBaseEntries(scope, globalEntries, projectEntries, projectConfigured);
  const next = enabled ? [...base, name] : base.filter((entry) => entry !== name);
  return [...new Set(next)];
}

/**
 * 启动参数里的工具校正（`--tools +read,-write,…`）。
 *
 * 把目录里的每个工具都显式写出来：会话恢复时 Pi 会用它们叠加到记录里的工具集上，
 * 这样「关掉 write」对已有会话也成立。没有配置过 `defaultTools` 时返回空数组，
 * 保持 Pi 自己的默认行为。
 */
export function toolModifierArguments(enabled: string[], platform: NodeJS.Platform = process.platform): string[] {
  const active = new Set(enabled);
  const entries: string[] = [];
  for (const tool of PI_TOOL_CATALOG) {
    if (tool.windowsOnly && platform !== "win32") continue;
    entries.push(`${active.has(tool.name) ? "+" : "-"}${tool.name}`);
  }
  return entries.length ? ["--tools", entries.join(",")] : [];
}

/** 目录之外、但仍写在 `defaultTools` 里的条目（扩展工具名 / 通配模式）。 */
export function extraToolEntries(globalEntries: unknown, projectEntries: unknown): string[] {
  const merged = mergeToolEntries(globalEntries, projectEntries) ?? [];
  return [...new Set(merged.filter((entry) => !isToolModifier(entry) && !CATALOG_NAMES.has(entry)))];
}

export interface PiToolItem {
  name: string;
  label: string;
  description: string;
  group: "builtin" | "extension";
  enabled: boolean;
  /** Pi 默认就启用的工具（read / bash / edit / write）。 */
  defaultEnabled: boolean;
}

export interface PiToolsOverview {
  agentDir: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  /** 当前生效的选择来自哪里：项目有配置时是 project，否则看全局存不存在。 */
  effectiveScope: "global" | "project" | "default";
  globalConfigured: boolean;
  projectConfigured: boolean;
  /** 项目是否已信任；未信任时项目级设置不会加载（与 Pi 一致）。 */
  projectTrusted: boolean;
  /** 项目级设置是否可写：需要显式信任项目（或 defaultProjectTrust=always）。 */
  projectWritable: boolean;
  globalEntries: string[];
  projectEntries: string[];
  tools: PiToolItem[];
  enabledNames: string[];
  /** 目录外的条目：原样保留在设置文件里。 */
  extraEntries: string[];
  diagnostics: string[];
}

/** 把两层设置整理成设置页要的列表（纯函数，宿主只负责读文件）。 */
export function describeTools(options: {
  globalSettings: ToolSettingsLike | null | undefined;
  projectSettings: ToolSettingsLike | null | undefined;
  globalSettingsPath?: string;
  projectSettingsPath?: string;
  agentDir?: string;
  diagnostics?: string[];
  /** 项目未信任时项目设置已被调用方剔除，这里只负责展示。 */
  projectTrusted?: boolean;
  projectWritable?: boolean;
  /** 当前平台；用来隐藏只在别的平台上存在的工具（powershell）。 */
  platform?: NodeJS.Platform;
}): PiToolsOverview {
  const globalConfigured = hasToolSelection(options.globalSettings);
  const projectConfigured = hasToolSelection(options.projectSettings);
  const globalEntries = toolEntries(options.globalSettings?.defaultTools);
  const projectEntries = toolEntries(options.projectSettings?.defaultTools);
  const enabledNames = resolveSettingsTools(options.globalSettings, options.projectSettings);
  const enabled = new Set(enabledNames);
  const platform = options.platform ?? process.platform;
  const effectiveScope = projectConfigured ? "project" : globalConfigured ? "global" : "default";
  return {
    agentDir: options.agentDir ?? "",
    globalSettingsPath: options.globalSettingsPath ?? "",
    projectSettingsPath: options.projectSettingsPath ?? "",
    effectiveScope,
    globalConfigured,
    projectConfigured,
    projectTrusted: options.projectTrusted ?? true,
    projectWritable: options.projectWritable ?? true,
    globalEntries,
    projectEntries,
    tools: PI_TOOL_CATALOG.filter((tool) => !tool.windowsOnly || platform === "win32").map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      group: tool.group,
      enabled: enabled.has(tool.name),
      defaultEnabled: DEFAULT_NAMES.has(tool.name),
    })),
    enabledNames,
    extraEntries: extraToolEntries(globalEntries, projectEntries),
    diagnostics: options.diagnostics ?? [],
  };
}

export { CATALOG_NAMES, DEFAULT_NAMES, TOOL_NAME };
