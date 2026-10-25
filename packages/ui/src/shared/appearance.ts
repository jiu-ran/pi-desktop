/**
 * 外观选项：主题模式、强调色、圆角、对话宽度、动效。
 *
 * 这里只放纯函数与常量（取值归一化 → CSS 变量），UI 与持久化各自调用，
 * 不依赖 DOM，方便直接用 node 跑检查。
 */

export type ThemeMode = "system" | "dark" | "light";
export type AccentId = "default" | "violet" | "teal" | "green" | "amber" | "rose" | "slate";
export type RadiusId = "sharp" | "default" | "round";
export type ColumnWidthId = "narrow" | "default" | "wide" | "full";

export const THEME_MODES: Array<{ id: ThemeMode; label: string; hint: string }> = [
  { id: "system", label: "跟随系统", hint: "随操作系统的深色/浅色设置自动切换" },
  { id: "dark", label: "深色", hint: "始终使用深色界面" },
  { id: "light", label: "浅色", hint: "始终使用浅色界面" },
];

/** 强调色预设：只给主色，淡色底与前景色由 `accentVars` 推出来。 */
export const ACCENTS: Array<{ id: AccentId; label: string; color: string }> = [
  { id: "default", label: "默认蓝", color: "#2a7deb" },
  { id: "violet", label: "紫罗兰", color: "#8b5cf6" },
  { id: "teal", label: "青碧", color: "#0d9aa8" },
  { id: "green", label: "松绿", color: "#18a05f" },
  { id: "amber", label: "琥珀", color: "#d98518" },
  { id: "rose", label: "玫瑰", color: "#e5484d" },
  { id: "slate", label: "石墨", color: "#6b7280" },
];

export const RADIUS_PRESETS: Array<{ id: RadiusId; label: string; radius: number; small: number }> = [
  { id: "sharp", label: "直角", radius: 4, small: 3 },
  { id: "default", label: "标准", radius: 8, small: 6 },
  { id: "round", label: "圆润", radius: 12, small: 9 },
];

export const COLUMN_WIDTHS: Array<{ id: ColumnWidthId; label: string; max: string }> = [
  { id: "narrow", label: "窄", max: "620px" },
  { id: "default", label: "标准", max: "760px" },
  { id: "wide", label: "宽", max: "980px" },
  { id: "full", label: "铺满", max: "100%" },
];

const THEME_MODE_IDS = THEME_MODES.map((item) => item.id);
const ACCENT_IDS = ACCENTS.map((item) => item.id);
const RADIUS_IDS = RADIUS_PRESETS.map((item) => item.id);
const COLUMN_IDS = COLUMN_WIDTHS.map((item) => item.id);

const pick = <T extends string>(value: unknown, ids: T[], fallback: T): T =>
  typeof value === "string" && (ids as string[]).includes(value) ? (value as T) : fallback;

export const normalizeThemeMode = (value: unknown): ThemeMode => pick(value, THEME_MODE_IDS, "system");
export const normalizeAccent = (value: unknown): AccentId => pick(value, ACCENT_IDS, "default");
export const normalizeRadius = (value: unknown): RadiusId => pick(value, RADIUS_IDS, "default");
export const normalizeColumnWidth = (value: unknown): ColumnWidthId => pick(value, COLUMN_IDS, "default");

/** `#rrggbb` → `rgba(r, g, b, alpha)`；非法色值返回空串，调用方跳过该变量。 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "";
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 强调色变量。`--accent-soft` 在深色下更实一点、浅色下更淡一点，
 * 否则浅色主题里高亮块会显得脏。
 */
export function accentVars(accent: AccentId, scheme: "dark" | "light"): Record<string, string> {
  const preset = ACCENTS.find((item) => item.id === accent) ?? ACCENTS[0];
  const soft = withAlpha(preset.color, scheme === "dark" ? 0.18 : 0.12);
  const hover = withAlpha(preset.color, scheme === "dark" ? 0.3 : 0.22);
  const vars: Record<string, string> = { "--accent": preset.color, "--accent-fg": "#ffffff" };
  if (soft) vars["--accent-soft"] = soft;
  if (hover) vars["--accent-hover"] = hover;
  return vars;
}

export function radiusVars(radius: RadiusId): Record<string, string> {
  const preset = RADIUS_PRESETS.find((item) => item.id === radius) ?? RADIUS_PRESETS[1];
  return { "--radius": `${preset.radius}px`, "--radius-sm": `${preset.small}px` };
}

export function columnWidthVars(width: ColumnWidthId): Record<string, string> {
  const preset = COLUMN_WIDTHS.find((item) => item.id === width) ?? COLUMN_WIDTHS[1];
  return { "--chat-column": preset.max };
}

export interface AppearanceInput {
  themeMode: ThemeMode;
  accent: AccentId;
  radius: RadiusId;
  columnWidth: ColumnWidthId;
  reduceMotion: boolean;
  /** 当前实际生效的配色（由 themeMode / 系统偏好解析出来） */
  scheme: "dark" | "light";
}

export interface AppearanceStyle {
  vars: Record<string, string>;
  dataset: Record<string, string>;
}

/** 一次性算出要写到 `<html>` 上的变量与 data 属性。 */
export function appearanceStyle(input: AppearanceInput): AppearanceStyle {
  return {
    vars: {
      ...accentVars(input.accent, input.scheme),
      ...radiusVars(input.radius),
      ...columnWidthVars(input.columnWidth),
    },
    dataset: {
      motion: input.reduceMotion ? "off" : "on",
      accent: input.accent,
      radius: input.radius,
      column: input.columnWidth,
      themeMode: input.themeMode,
    },
  };
}

/** 把主题模式解析成实际配色；system 时看系统偏好。 */
export function resolveScheme(mode: ThemeMode, systemPrefersDark: boolean): "dark" | "light" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}
