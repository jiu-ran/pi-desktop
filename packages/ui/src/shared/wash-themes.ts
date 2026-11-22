/**
 * 窗口 wash 主题：浅色 5 套 + 深色 5 套（共 10 套独立调色板）。
 *
 * 每套主题拥有独立的渐变窗框、双层氛围柔光、玻璃层参数与整套表面/文字色板，
 * 让主窗口、玻璃岛屿、设置弹窗、下拉浮层与终端在色温和层次上浑然一体。
 */

export type LightWashThemeId = "sakura" | "sky" | "matcha" | "twilight" | "alabaster";
export type DarkWashThemeId = "midnight" | "nebula" | "abyss" | "frost" | "obsidian";
export type WashThemeId = LightWashThemeId | DarkWashThemeId;
export type WashScheme = "light" | "dark";

export interface WashPalette {
  /** 渐变停靠点（左上 → 右下） */
  stops: string[];
  /** 双层径向柔光，营造氛围光晕 */
  glow: string;
  /** 原生窗口 / 标题栏底色 */
  frame: string;
  /** 玻璃岛屿底色（rgba，配合 backdrop-filter） */
  glassBg: string;
  /** 选中行 / 悬浮胶囊的强玻璃底色 */
  glassStrong: string;
  /** 玻璃描边与镜面高光 */
  glassBorder: string;
  glassHighlight: string;
  /** 岛屿阴影与边框 */
  cardBorder: string;
  cardShadow: string;
  /** 表面色阶（设置弹窗、浮层、卡片、输入框、终端） */
  bg: string;
  bg1: string;
  bg2: string;
  bg3: string;
  inputBg: string;
  termBg: string;
  userBg: string;
  /** 文字与分割线 */
  fg: string;
  fg2: string;
  fg3: string;
  line: string;
  line2: string;
  hover: string;
  press: string;
}

export interface WashThemeEntry<Id extends WashThemeId = WashThemeId> {
  id: Id;
  scheme: WashScheme;
  label: string;
  /** 缩略图里的代表色徽标 */
  accent: string;
  palette: WashPalette;
}

export const LIGHT_WASH_THEMES: WashThemeEntry<LightWashThemeId>[] = [
  {
    id: "sakura",
    scheme: "light",
    label: "云樱",
    accent: "#d94b8c",
    palette: {
      stops: ["#f3dff0", "#f9e6ef", "#fbeae5", "#fdf2e3"],
      glow: "linear-gradient(0deg, rgba(252, 220, 190, 0.34), transparent 32%), radial-gradient(70% 60% at 88% 2%, rgba(244, 164, 205, 0.62), transparent 66%), radial-gradient(62% 56% at 12% 98%, rgba(255, 214, 153, 0.50), transparent 70%)",
      frame: "#f3dff0",
      glassBg: "rgba(253, 248, 252, 0.74)",
      glassStrong: "rgba(250, 232, 245, 0.88)",
      glassBorder: "rgba(255, 255, 255, 0.82)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.72)",
      cardShadow: "0 1px 2px rgba(74, 36, 64, 0.05), 0 20px 48px rgba(74, 36, 64, 0.10)",
      bg: "#fdf9fc",
      bg1: "#f8eff5",
      bg2: "#f0e4ee",
      bg3: "#e6d7e6",
      inputBg: "#ffffff",
      termBg: "#fdf9fc",
      userBg: "#f6e7f1",
      fg: "#241d29",
      fg2: "#6a5a70",
      fg3: "#8e7d97",
      line: "rgba(76, 38, 80, 0.09)",
      line2: "rgba(76, 38, 80, 0.15)",
      hover: "rgba(76, 38, 80, 0.06)",
      press: "rgba(76, 38, 80, 0.11)",
    },
  },
  {
    id: "sky",
    scheme: "light",
    label: "晴空",
    accent: "#2563eb",
    palette: {
      stops: ["#d3e3fc", "#e0ecfe", "#ecf4fd", "#f4f7fa"],
      glow: "linear-gradient(0deg, rgba(190, 225, 250, 0.30), transparent 32%), radial-gradient(70% 60% at 88% 2%, rgba(120, 170, 250, 0.60), transparent 66%), radial-gradient(62% 56% at 12% 98%, rgba(140, 220, 240, 0.48), transparent 70%)",
      frame: "#d3e3fc",
      glassBg: "rgba(249, 252, 255, 0.74)",
      glassStrong: "rgba(228, 240, 254, 0.88)",
      glassBorder: "rgba(255, 255, 255, 0.84)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.74)",
      cardShadow: "0 1px 2px rgba(28, 56, 96, 0.05), 0 20px 48px rgba(28, 56, 96, 0.10)",
      bg: "#fafcff",
      bg1: "#f2f6fd",
      bg2: "#e7eefa",
      bg3: "#dbe6f6",
      inputBg: "#ffffff",
      termBg: "#fafcff",
      userBg: "#e7f0fc",
      fg: "#1a2232",
      fg2: "#59667c",
      fg3: "#8592a8",
      line: "rgba(26, 54, 96, 0.09)",
      line2: "rgba(26, 54, 96, 0.15)",
      hover: "rgba(26, 54, 96, 0.06)",
      press: "rgba(26, 54, 96, 0.11)",
    },
  },
  {
    id: "matcha",
    scheme: "light",
    label: "青岚",
    accent: "#0d9488",
    palette: {
      stops: ["#d3efe2", "#e0f3e9", "#eaf5ec", "#f5f7ec"],
      glow: "linear-gradient(0deg, rgba(200, 240, 210, 0.28), transparent 32%), radial-gradient(70% 60% at 88% 2%, rgba(122, 226, 163, 0.52), transparent 66%), radial-gradient(62% 56% at 12% 98%, rgba(140, 236, 222, 0.46), transparent 70%)",
      frame: "#d3efe2",
      glassBg: "rgba(248, 253, 250, 0.74)",
      glassStrong: "rgba(226, 244, 236, 0.88)",
      glassBorder: "rgba(255, 255, 255, 0.84)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.72)",
      cardShadow: "0 1px 2px rgba(22, 66, 56, 0.05), 0 20px 48px rgba(22, 66, 56, 0.10)",
      bg: "#f7fdf9",
      bg1: "#eef7f1",
      bg2: "#e3efe9",
      bg3: "#d7e7df",
      inputBg: "#ffffff",
      termBg: "#f7fdf9",
      userBg: "#e3f3ec",
      fg: "#182623",
      fg2: "#54695f",
      fg3: "#7f978f",
      line: "rgba(22, 70, 58, 0.09)",
      line2: "rgba(22, 70, 58, 0.15)",
      hover: "rgba(22, 70, 58, 0.06)",
      press: "rgba(22, 70, 58, 0.11)",
    },
  },
  {
    id: "twilight",
    scheme: "light",
    label: "琉璃",
    accent: "#8b5cf6",
    palette: {
      stops: ["#e0d8fb", "#eee0f8", "#fbe4e0", "#fdefdd"],
      glow: "linear-gradient(0deg, rgba(230, 200, 250, 0.28), transparent 32%), radial-gradient(70% 60% at 88% 2%, rgba(186, 166, 252, 0.60), transparent 66%), radial-gradient(62% 56% at 12% 98%, rgba(252, 178, 140, 0.46), transparent 70%)",
      frame: "#e0d8fb",
      glassBg: "rgba(252, 249, 255, 0.74)",
      glassStrong: "rgba(238, 228, 251, 0.88)",
      glassBorder: "rgba(255, 255, 255, 0.82)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.72)",
      cardShadow: "0 1px 2px rgba(52, 36, 84, 0.05), 0 20px 48px rgba(52, 36, 84, 0.10)",
      bg: "#fbf9ff",
      bg1: "#f4effc",
      bg2: "#ece3f8",
      bg3: "#e1d6f0",
      inputBg: "#ffffff",
      termBg: "#fbf9ff",
      userBg: "#eee7fb",
      fg: "#221e2e",
      fg2: "#635a76",
      fg3: "#8d84a2",
      line: "rgba(52, 38, 84, 0.09)",
      line2: "rgba(52, 38, 84, 0.15)",
      hover: "rgba(52, 38, 84, 0.06)",
      press: "rgba(52, 38, 84, 0.11)",
    },
  },
  {
    id: "alabaster",
    scheme: "light",
    label: "素雪",
    accent: "#4f46e5",
    palette: {
      stops: ["#e6eaf3", "#eef1f7", "#f4f6fa", "#f8f9fc"],
      glow: "linear-gradient(0deg, rgba(220, 230, 245, 0.28), transparent 32%), radial-gradient(72% 60% at 86% 0%, rgba(196, 214, 240, 0.55), transparent 66%), radial-gradient(62% 54% at 12% 98%, rgba(210, 222, 238, 0.40), transparent 70%)",
      frame: "#e6eaf3",
      glassBg: "rgba(253, 254, 255, 0.76)",
      glassStrong: "rgba(232, 238, 248, 0.90)",
      glassBorder: "rgba(255, 255, 255, 0.86)",
      glassHighlight: "rgba(255, 255, 255, 0.98)",
      cardBorder: "rgba(255, 255, 255, 0.78)",
      cardShadow: "0 1px 2px rgba(30, 42, 62, 0.05), 0 20px 48px rgba(30, 42, 62, 0.09)",
      bg: "#fbfcfe",
      bg1: "#f3f5f9",
      bg2: "#e9edf4",
      bg3: "#dee4ee",
      inputBg: "#ffffff",
      termBg: "#fbfcfe",
      userBg: "#eef1f8",
      fg: "#1d1e24",
      fg2: "#5f6474",
      fg3: "#8b90a0",
      line: "rgba(30, 42, 64, 0.085)",
      line2: "rgba(30, 42, 64, 0.145)",
      hover: "rgba(30, 42, 64, 0.055)",
      press: "rgba(30, 42, 64, 0.10)",
    },
  },
];

export const DARK_WASH_THEMES: WashThemeEntry<DarkWashThemeId>[] = [
  {
    id: "midnight",
    scheme: "dark",
    label: "星夜",
    accent: "#6ea8ff",
    palette: {
      stops: ["#0a1122", "#0f1a35", "#142146", "#101a33"],
      glow: "linear-gradient(180deg, rgba(170, 205, 255, 0.10), transparent 24%), radial-gradient(74% 62% at 86% 0%, rgba(64, 140, 255, 0.42), transparent 66%), radial-gradient(66% 58% at 10% 98%, rgba(124, 92, 255, 0.26), transparent 70%)",
      frame: "#0a1122",
      glassBg: "rgba(18, 28, 54, 0.70)",
      glassStrong: "rgba(44, 74, 132, 0.62)",
      glassBorder: "rgba(147, 197, 253, 0.20)",
      glassHighlight: "rgba(191, 219, 254, 0.30)",
      cardBorder: "rgba(147, 197, 253, 0.13)",
      cardShadow: "0 2px 6px rgba(3, 6, 16, 0.42), 0 22px 56px rgba(3, 8, 22, 0.58)",
      bg: "#121b33",
      bg1: "#18233d",
      bg2: "#1f2c4b",
      bg3: "#28375c",
      inputBg: "#0d1527",
      termBg: "#0f1730",
      userBg: "#1d2f57",
      fg: "#eef3ff",
      fg2: "#a8bade",
      fg3: "#7a8db4",
      line: "rgba(165, 198, 255, 0.11)",
      line2: "rgba(165, 198, 255, 0.18)",
      hover: "rgba(165, 198, 255, 0.08)",
      press: "rgba(165, 198, 255, 0.14)",
    },
  },
  {
    id: "nebula",
    scheme: "dark",
    label: "星云",
    accent: "#c99bff",
    palette: {
      stops: ["#120b21", "#1a1033", "#241543", "#1b1130"],
      glow: "linear-gradient(180deg, rgba(232, 200, 255, 0.10), transparent 24%), radial-gradient(74% 62% at 86% 0%, rgba(196, 132, 252, 0.42), transparent 66%), radial-gradient(66% 58% at 10% 98%, rgba(255, 110, 180, 0.26), transparent 70%)",
      frame: "#120b21",
      glassBg: "rgba(26, 19, 46, 0.72)",
      glassStrong: "rgba(74, 48, 122, 0.62)",
      glassBorder: "rgba(216, 180, 254, 0.20)",
      glassHighlight: "rgba(243, 232, 255, 0.28)",
      cardBorder: "rgba(216, 180, 254, 0.13)",
      cardShadow: "0 2px 6px rgba(6, 3, 14, 0.44), 0 22px 56px rgba(8, 3, 20, 0.60)",
      bg: "#1a1330",
      bg1: "#221938",
      bg2: "#2b2048",
      bg3: "#362a5b",
      inputBg: "#140e26",
      termBg: "#171029",
      userBg: "#2c1f4d",
      fg: "#f6f1ff",
      fg2: "#beaede",
      fg3: "#8b7bab",
      line: "rgba(224, 198, 255, 0.11)",
      line2: "rgba(224, 198, 255, 0.18)",
      hover: "rgba(224, 198, 255, 0.08)",
      press: "rgba(224, 198, 255, 0.14)",
    },
  },
  {
    id: "abyss",
    scheme: "dark",
    label: "极光",
    accent: "#3fe0c5",
    palette: {
      stops: ["#04131a", "#061c22", "#08242c", "#061a24"],
      glow: "linear-gradient(180deg, rgba(180, 255, 244, 0.09), transparent 24%), radial-gradient(74% 62% at 86% 0%, rgba(45, 212, 191, 0.38), transparent 66%), radial-gradient(66% 58% at 12% 98%, rgba(56, 132, 255, 0.26), transparent 70%)",
      frame: "#04131a",
      glassBg: "rgba(9, 30, 36, 0.72)",
      glassStrong: "rgba(22, 68, 72, 0.62)",
      glassBorder: "rgba(94, 234, 212, 0.19)",
      glassHighlight: "rgba(204, 251, 241, 0.26)",
      cardBorder: "rgba(94, 234, 212, 0.13)",
      cardShadow: "0 2px 6px rgba(2, 10, 14, 0.44), 0 22px 56px rgba(2, 12, 18, 0.60)",
      bg: "#0c2229",
      bg1: "#112a31",
      bg2: "#16353d",
      bg3: "#1d4450",
      inputBg: "#08191f",
      termBg: "#0a1c22",
      userBg: "#123a3d",
      fg: "#eafaf7",
      fg2: "#9ec9c2",
      fg3: "#6f9a94",
      line: "rgba(150, 240, 225, 0.11)",
      line2: "rgba(150, 240, 225, 0.18)",
      hover: "rgba(150, 240, 225, 0.08)",
      press: "rgba(150, 240, 225, 0.14)",
    },
  },
  {
    id: "frost",
    scheme: "dark",
    label: "霜夜",
    accent: "#9dc3d6",
    palette: {
      stops: ["#101620", "#161e2b", "#1b2637", "#151c28"],
      glow: "linear-gradient(180deg, rgba(226, 240, 255, 0.08), transparent 24%), radial-gradient(74% 62% at 86% 0%, rgba(136, 192, 208, 0.30), transparent 66%), radial-gradient(66% 58% at 12% 98%, rgba(129, 161, 193, 0.20), transparent 70%)",
      frame: "#101620",
      glassBg: "rgba(23, 31, 44, 0.74)",
      glassStrong: "rgba(52, 68, 96, 0.62)",
      glassBorder: "rgba(180, 210, 235, 0.18)",
      glassHighlight: "rgba(229, 233, 240, 0.24)",
      cardBorder: "rgba(180, 210, 235, 0.12)",
      cardShadow: "0 2px 6px rgba(6, 10, 18, 0.38), 0 22px 56px rgba(6, 10, 20, 0.54)",
      bg: "#181f2c",
      bg1: "#1e2735",
      bg2: "#26303f",
      bg3: "#303c4e",
      inputBg: "#141a24",
      termBg: "#161d29",
      userBg: "#25313f",
      fg: "#edf1f7",
      fg2: "#b3bccd",
      fg3: "#828da3",
      line: "rgba(216, 228, 244, 0.10)",
      line2: "rgba(216, 228, 244, 0.17)",
      hover: "rgba(216, 228, 244, 0.07)",
      press: "rgba(216, 228, 244, 0.13)",
    },
  },
  {
    id: "obsidian",
    scheme: "dark",
    label: "曜石",
    accent: "#b9c4d6",
    palette: {
      stops: ["#07080a", "#0b0d11", "#0f1218", "#090a0d"],
      glow: "linear-gradient(180deg, rgba(226, 232, 240, 0.11), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(226, 232, 240, 0.16), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(148, 163, 184, 0.10), transparent 70%)",
      frame: "#07080a",
      glassBg: "rgba(18, 20, 25, 0.72)",
      glassStrong: "rgba(46, 52, 64, 0.62)",
      glassBorder: "rgba(255, 255, 255, 0.13)",
      glassHighlight: "rgba(255, 255, 255, 0.22)",
      cardBorder: "rgba(255, 255, 255, 0.11)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.44), 0 22px 56px rgba(0, 0, 0, 0.60)",
      bg: "#111317",
      bg1: "#171a20",
      bg2: "#1e222a",
      bg3: "#272c36",
      inputBg: "#0c0e12",
      termBg: "#0f1116",
      userBg: "#1d212a",
      fg: "#f2f4f8",
      fg2: "#a9b0be",
      fg3: "#767d8c",
      line: "rgba(255, 255, 255, 0.09)",
      line2: "rgba(255, 255, 255, 0.16)",
      hover: "rgba(255, 255, 255, 0.07)",
      press: "rgba(255, 255, 255, 0.13)",
    },
  },
];

export const WASH_THEMES: WashThemeEntry[] = [...LIGHT_WASH_THEMES, ...DARK_WASH_THEMES];

const LIGHT_IDS = LIGHT_WASH_THEMES.map((item) => item.id);
const DARK_IDS = DARK_WASH_THEMES.map((item) => item.id);

/** 旧版 theme id 到新版 5+5 主题的迁移映射。 */
const LEGACY_LIGHT_MAP: Record<string, LightWashThemeId> = {
  petal: "sakura",
  dusk: "twilight",
  mist: "sky",
  tide: "sky",
  meadow: "matcha",
  aurora: "matcha",
  apricot: "sakura",
  dune: "sakura",
  paper: "alabaster",
  plain: "alabaster",
};

const LEGACY_DARK_MAP: Record<string, DarkWashThemeId> = {
  petal: "nebula",
  dusk: "nebula",
  mist: "midnight",
  tide: "abyss",
  meadow: "abyss",
  aurora: "abyss",
  apricot: "nebula",
  dune: "frost",
  paper: "obsidian",
  plain: "obsidian",
};

export function normalizeLightWashTheme(value: unknown): LightWashThemeId {
  if (typeof value !== "string") return "sakura";
  if ((LIGHT_IDS as string[]).includes(value)) return value as LightWashThemeId;
  return LEGACY_LIGHT_MAP[value] ?? "sakura";
}

export function normalizeDarkWashTheme(value: unknown): DarkWashThemeId {
  if (typeof value !== "string") return "midnight";
  if ((DARK_IDS as string[]).includes(value)) return value as DarkWashThemeId;
  return LEGACY_DARK_MAP[value] ?? "midnight";
}

export function washEntry(id: string, scheme: WashScheme): WashThemeEntry {
  if (scheme === "dark") {
    const normalized = normalizeDarkWashTheme(id);
    return DARK_WASH_THEMES.find((item) => item.id === normalized) ?? DARK_WASH_THEMES[0];
  }
  const normalized = normalizeLightWashTheme(id);
  return LIGHT_WASH_THEMES.find((item) => item.id === normalized) ?? LIGHT_WASH_THEMES[0];
}

/** `linear-gradient(...)`：主窗框与设置缩略图共用。 */
export function washGradient(id: string, scheme: WashScheme): string {
  const { stops } = washEntry(id, scheme).palette;
  const formatted = stops.length > 1
    ? stops.map((color, index) => `${color} ${Math.round((index / (stops.length - 1)) * 100)}%`)
    : [`${stops[0]} 0%`, `${stops[0]} 100%`];
  return `linear-gradient(165deg, ${formatted.join(", ")})`;
}

/** 双层径向氛围光晕。 */
export function washGlow(id: string, scheme: WashScheme): string {
  return washEntry(id, scheme).palette.glow;
}

/** 设置页缩略图：把柔光叠在渐变上。 */
export function washBackground(id: string, scheme: WashScheme): string {
  return `${washGlow(id, scheme)}, ${washGradient(id, scheme)}`;
}
