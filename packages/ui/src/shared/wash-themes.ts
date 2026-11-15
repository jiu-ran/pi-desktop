/**
 * Kero 的窗口 wash 主题。
 *
 * 每个主题同时有浅色与深色两套底：浅色窗口 / 深色窗口分别选，
 * 由 theme.ts 按当前配色取对应的一套写进 CSS 变量。
 * 颜色取自 Kero 的 washTable（rex = 花瓣 / petal）。
 */

export type WashThemeId =
  | "petal"
  | "mist"
  | "meadow"
  | "dusk"
  | "tide"
  | "apricot"
  | "aurora"
  | "dune"
  | "paper"
  | "plain";

export type WashScheme = "light" | "dark";

interface WashSide {
  /** 渐变停靠点，从浅到深（深色则从深到更暖/更冷） */
  stops: string[];
  /** 右上角的柔光 */
  glow: string;
  /** 标题栏 / 原生窗口底色，取渐变的第一站 */
  frame: string;
}

export interface WashThemeDefinition {
  id: WashThemeId;
  label: string;
  /** 主题缩略图里的强调色点缀 */
  accent: Record<WashScheme, string>;
  light: WashSide;
  dark: WashSide;
}

export const WASH_THEMES: WashThemeDefinition[] = [
  {
    id: "petal",
    label: "花瓣",
    accent: { light: "oklch(55% 0.13 350)", dark: "oklch(74% 0.13 350)" },
    light: {
      stops: ["#ebe0f3", "#f3e7f1", "#f7eee4", "#f6efcf"],
      glow: "rgba(247, 220, 241, 0.75)",
      frame: "#ebe0f3",
    },
    dark: {
      stops: ["#240f1d", "#26111a", "#271610"],
      glow: "rgba(142, 58, 110, 0.30)",
      frame: "#240f1d",
    },
  },
  {
    id: "mist",
    label: "薄雾",
    accent: { light: "oklch(55% 0.13 255)", dark: "oklch(74% 0.13 255)" },
    light: {
      stops: ["#e3e9f4", "#ebeff6", "#f1f2f3", "#f2f1ec"],
      glow: "rgba(210, 225, 248, 0.75)",
      frame: "#e3e9f4",
    },
    dark: {
      stops: ["#0c1628", "#0d1827", "#111b23"],
      glow: "rgba(46, 91, 166, 0.30)",
      frame: "#0c1628",
    },
  },
  {
    id: "meadow",
    label: "草地",
    accent: { light: "oklch(55% 0.13 140)", dark: "oklch(74% 0.13 140)" },
    light: {
      stops: ["#e2eee5", "#ebf2e7", "#f3f2e2", "#f5f0d6"],
      glow: "rgba(214, 240, 222, 0.75)",
      frame: "#e2eee5",
    },
    dark: {
      stops: ["#081c0d", "#101d0c", "#1b1c0b"],
      glow: "rgba(6, 113, 50, 0.30)",
      frame: "#081c0d",
    },
  },
  {
    id: "dusk",
    label: "黄昏",
    accent: { light: "oklch(55% 0.13 315)", dark: "oklch(74% 0.13 315)" },
    light: {
      stops: ["#e4dbf3", "#efdeee", "#f6e3dc", "#f7e6cf"],
      glow: "rgba(246, 206, 222, 0.80)",
      frame: "#e4dbf3",
    },
    dark: {
      stops: ["#190f2e", "#260f24", "#2d140b"],
      glow: "rgba(125, 65, 138, 0.30)",
      frame: "#190f2e",
    },
  },
  {
    id: "tide",
    label: "潮汐",
    accent: { light: "oklch(55% 0.13 205)", dark: "oklch(74% 0.13 205)" },
    light: {
      stops: ["#dbebef", "#e3eff1", "#ecf3f0", "#f2f2e8"],
      glow: "rgba(194, 232, 238, 0.75)",
      frame: "#dbebef",
    },
    dark: {
      stops: ["#001b22", "#001e1f", "#0b1e1b"],
      glow: "rgba(0, 112, 128, 0.30)",
      frame: "#001b22",
    },
  },
  {
    id: "apricot",
    label: "杏子",
    accent: { light: "oklch(55% 0.13 50)", dark: "oklch(74% 0.13 50)" },
    light: {
      stops: ["#f5e1d6", "#f8e7dc", "#f8eedf", "#f6f0da"],
      glow: "rgba(252, 212, 194, 0.78)",
      frame: "#f5e1d6",
    },
    dark: {
      stops: ["#2a1207", "#291507", "#25190a"],
      glow: "rgba(151, 62, 22, 0.30)",
      frame: "#2a1207",
    },
  },
  {
    id: "aurora",
    label: "极光",
    accent: { light: "oklch(55% 0.13 170)", dark: "oklch(74% 0.13 170)" },
    light: {
      stops: ["#dbefe8", "#e1ebf2", "#e8e4f4", "#f0e6f1"],
      glow: "rgba(198, 238, 224, 0.75)",
      frame: "#dbefe8",
    },
    dark: {
      stops: ["#001f13", "#06192b", "#1e122a"],
      glow: "rgba(0, 115, 75, 0.30)",
      frame: "#001f13",
    },
  },
  {
    id: "dune",
    label: "沙丘",
    accent: { light: "oklch(55% 0.13 80)", dark: "oklch(74% 0.13 80)" },
    light: {
      stops: ["#ede4d8", "#f1e9de", "#f4eee4", "#f3efe8"],
      glow: "rgba(242, 222, 194, 0.70)",
      frame: "#ede4d8",
    },
    dark: {
      stops: ["#22190b", "#211a0e", "#201b12"],
      glow: "rgba(135, 79, 0, 0.30)",
      frame: "#22190b",
    },
  },
  {
    id: "paper",
    label: "白纸",
    accent: { light: "oklch(55% 0.13 262)", dark: "oklch(74% 0.13 262)" },
    light: {
      stops: ["#f6f6f7", "#f7f7f8", "#f8f8f8"],
      glow: "rgba(255, 255, 255, 0.00)",
      frame: "#f6f6f7",
    },
    dark: {
      stops: ["#141416", "#151517", "#161618"],
      glow: "rgba(90, 120, 200, 0.10)",
      frame: "#141416",
    },
  },
  {
    id: "plain",
    label: "纯色",
    accent: { light: "#6b7280", dark: "#c9c9cf" },
    light: {
      stops: ["#eceef4", "#eceef4"],
      glow: "rgba(0, 0, 0, 0.00)",
      frame: "#eceef4",
    },
    dark: {
      stops: ["#141418", "#141418"],
      glow: "rgba(0, 0, 0, 0.00)",
      frame: "#141418",
    },
  },
];

const WASH_IDS = WASH_THEMES.map((item) => item.id);

export function washTheme(id: string): WashThemeDefinition {
  return WASH_THEMES.find((item) => item.id === id) ?? WASH_THEMES[0];
}

export function normalizeWashTheme(value: unknown): WashThemeId {
  return typeof value === "string" && (WASH_IDS as string[]).includes(value)
    ? (value as WashThemeId)
    : "petal";
}

/** `linear-gradient(...)`：主题切换与设置页缩略图共用。 */
export function washGradient(id: string, scheme: WashScheme): string {
  const side = washTheme(id)[scheme];
  const stops = side.stops.length > 1
    ? side.stops.map((color, index) => `${color} ${Math.round((index / (side.stops.length - 1)) * 100)}%`)
    : [`${side.stops[0]} 0%`, `${side.stops[0]} 100%`];
  return `linear-gradient(172deg, ${stops.join(", ")})`;
}

/** 右上角的柔光；角度和 Kero 的 glowOf 一致。 */
export function washGlow(id: string, scheme: WashScheme): string {
  return `linear-gradient(225deg, ${washTheme(id)[scheme].glow} 0%, transparent 50%)`;
}

/** 设置页缩略图：一层柔光叠在渐变上。 */
export function washBackground(id: string, scheme: WashScheme): string {
  return `${washGlow(id, scheme)}, ${washGradient(id, scheme)}`;
}
