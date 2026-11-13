/**
 * 新会话的默认模型 / 思考等级（纯逻辑，不 import electron）。
 *
 * 这两项都是 Pi 自己的能力，Pi 已经把它们定义在 `settings.json` 里：
 * `defaultProvider` + `defaultModel` + `defaultThinkingLevel`。桌面端只负责提供一个
 * 能看见、能改的入口 —— 写同一份设置，终端里的 `pi` 也就跟着一致，不会出现
 * 「桌面端选了 A 模型、命令行还是 B」这种两份真相。
 */

/** Pi 的思考等级（与 `ThinkingLevel` 一致，按从轻到重排序）。 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModelDefaultSetting {
  /** 提供方 id，例如 `anthropic`；空串表示「跟随 Pi」 */
  provider: string;
  /** 模型 id，例如 `claude-sonnet-4-5`；空串表示「跟随 Pi」 */
  model: string;
  /** 思考等级；空串表示「跟随 Pi / 用模型默认」 */
  thinkingLevel: string;
}

export const EMPTY_MODEL_DEFAULT: ModelDefaultSetting = { provider: "", model: "", thinkingLevel: "" };

/** 只接受 Pi 认识的等级，其他值一律当没设置。 */
export function normalizeThinkingLevel(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (THINKING_LEVELS as readonly string[]).includes(text) ? text : "";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 从一份 settings.json 里读出这三项。 */
export function modelDefaultOf(settings: unknown): ModelDefaultSetting {
  const value = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return {
    provider: textOf(value.defaultProvider),
    model: textOf(value.defaultModel),
    thinkingLevel: normalizeThinkingLevel(value.defaultThinkingLevel),
  };
}

/** 某一项是不是完整的（provider 与 model 必须同时有，否则 Pi 用不了）。 */
export function hasModel(setting: ModelDefaultSetting): boolean {
  return Boolean(setting.provider && setting.model);
}

/** 生效值：项目设置盖过全局（Pi 的项目信任由调用方先判断）。 */
export function effectiveModelDefault(globalSetting: unknown, projectSetting: unknown): ModelDefaultSetting {
  const globalValue = modelDefaultOf(globalSetting);
  const projectValue = modelDefaultOf(projectSetting);
  return {
    provider: projectValue.provider || globalValue.provider,
    model: projectValue.model || globalValue.model,
    thinkingLevel: projectValue.thinkingLevel || globalValue.thinkingLevel,
  };
}

/**
 * 把选择写进一份 settings 对象（返回新对象，不改入参）。
 *
 * 空值表示「跟随 Pi」：直接把键删掉，而不是写空串 —— Pi 的 schema 里这些键要么不存在，
 * 要么是合法值，留个空串会让它以为「默认模型叫空名字」。
 */
export function applyModelDefault(
  settings: unknown,
  patch: { provider?: string; model?: string; thinkingLevel?: string },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...((settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>) };
  const provider = textOf(patch.provider);
  const model = textOf(patch.model);
  if (provider && model) {
    next.defaultProvider = provider;
    next.defaultModel = model;
  } else if (patch.provider !== undefined || patch.model !== undefined) {
    // 明确要清空（或只给了一半）：两个键一起删，避免留下半套设置
    delete next.defaultProvider;
    delete next.defaultModel;
  }
  if (patch.thinkingLevel !== undefined) {
    const level = normalizeThinkingLevel(patch.thinkingLevel);
    if (level) next.defaultThinkingLevel = level;
    else delete next.defaultThinkingLevel;
  }
  return next;
}

/** 界面上「默认模型」那一行显示什么。 */
export function modelDefaultLabel(setting: ModelDefaultSetting, nameOf?: (provider: string, model: string) => string): string {
  if (!hasModel(setting)) return "跟随 Pi 默认";
  const name = nameOf?.(setting.provider, setting.model) || setting.model;
  return `${name} · ${setting.provider}`;
}

/** 设置页要用的总览（IPC 直接返回这个结构）。 */
export interface PiModelDefaultsOverview {
  global: ModelDefaultSetting;
  project: ModelDefaultSetting;
  /** 合并后的生效值（项目盖过全局） */
  effective: ModelDefaultSetting;
  /** Pi 认识的思考等级，界面直接拿来渲染下拉框 */
  thinkingLevels: string[];
  projectSettingsPath: string;
  projectTrusted: boolean;
  projectWritable: boolean;
}
