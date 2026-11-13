/**
 * 思考等级的能力判断（纯函数，界面直接 import）。
 *
 * 不同的模型支持的等级并不一样：不支持推理的模型只有 `off`；部分模型把某几档映射成
 * `null`（表示不支持），`xhigh` / `max` 只有模型显式映射过才出现。这条规则与 Pi 内部
 * 的 `getSupportedThinkingLevels` 一致，界面按它渲染下拉框，才不会出现「选了却没有效果」。
 */

/** Pi 的思考等级，按从轻到重排序。 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

export interface ThinkingCapableModel {
  reasoning?: boolean;
  /** Pi 的 thinkingLevelMap：null 表示这一档不支持；undefined 表示用提供方默认 */
  thinkingLevelMap?: Record<string, string | null | undefined> | null;
}

/**
 * 这个模型支持哪些思考等级。
 *
 * 拿不到能力信息（`reasoning` 未定义）时返回全部等级 —— 宁可多显示，也不要把用户卡在
 * 只有 `off` 的选项里；真正不支持的等级由 Pi 在 `setThinkingLevel` 时钳制。
 */
export function supportedThinkingLevels(model?: ThinkingCapableModel | null): ThinkingLevelName[] {
  if (!model || typeof model.reasoning !== "boolean") return [...THINKING_LEVELS];
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap ?? {};
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    // xhigh / max 属于「提供方显式支持才有」的两档
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/** 把不支持的等级收敛到最近的可用档（与 Pi 的 clamp 行为一致）。 */
export function clampThinkingLevel(level: string, available: readonly string[]): string {
  if (available.includes(level)) return level;
  const index = THINKING_LEVELS.indexOf(level as ThinkingLevelName);
  if (index === -1) return available[0] ?? "off";
  for (let i = index; i < THINKING_LEVELS.length; i += 1) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  return available[0] ?? "off";
}
