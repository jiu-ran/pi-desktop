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
      stops: ["#efe1f7", "#f7e4ef", "#fcece4", "#fcf4df"],
      glow: "radial-gradient(68% 58% at 88% 6%, rgba(244, 174, 218, 0.72), transparent 68%), radial-gradient(60% 55% at 12% 96%, rgba(253, 224, 174, 0.56), transparent 70%)",
      frame: "#efe1f7",
      glassBg: "rgba(255, 251, 254, 0.72)",
      glassStrong: "rgba(255, 255, 255, 0.90)",
      glassBorder: "rgba(255, 255, 255, 0.80)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.68)",
      cardShadow: "0 1px 2px rgba(60, 30, 60, 0.05), 0 18px 44px rgba(60, 30, 60, 0.09)",
      bg: "#fefbfd",
      bg1: "#f9f2f7",
      bg2: "#f1e7ef",
      bg3: "#e7dbe6",
      inputBg: "#ffffff",
      termBg: "#fefbfd",
      userBg: "#f6eaf3",
      fg: "#241d29",
      fg2: "#6b5f73",
      fg3: "#9e91a8",
      line: "rgba(56, 28, 66, 0.08)",
      line2: "rgba(56, 28, 66, 0.14)",
      hover: "rgba(56, 28, 66, 0.055)",
      press: "rgba(56, 28, 66, 0.10)",
    },
  },
  {
    id: "sky",
    scheme: "light",
    label: "晴空",
    accent: "#2563eb",
    palette: {
      stops: ["#d6e6fd", "#e2effe", "#edf5fd", "#f5f7fa"],
      glow: "radial-gradient(68% 58% at 88% 6%, rgba(147, 197, 253, 0.74), transparent 68%), radial-gradient(60% 55% at 14% 96%, rgba(186, 230, 253, 0.62), transparent 70%)",
      frame: "#d6e6fd",
      glassBg: "rgba(250, 253, 255, 0.73)",
      glassStrong: "rgba(255, 255, 255, 0.91)",
      glassBorder: "rgba(255, 255, 255, 0.82)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.70)",
      cardShadow: "0 1px 2px rgba(24, 48, 88, 0.05), 0 18px 44px rgba(24, 48, 88, 0.09)",
      bg: "#fafcff",
      bg1: "#f1f6fd",
      bg2: "#e6eefb",
      bg3: "#dae5f6",
      inputBg: "#ffffff",
      termBg: "#fafcff",
      userBg: "#e8f0fc",
      fg: "#1a2232",
      fg2: "#5a667c",
      fg3: "#8e9aaf",
      line: "rgba(24, 50, 92, 0.08)",
      line2: "rgba(24, 50, 92, 0.14)",
      hover: "rgba(24, 50, 92, 0.055)",
      press: "rgba(24, 50, 92, 0.10)",
    },
  },
  {
    id: "matcha",
    scheme: "light",
    label: "青岚",
    accent: "#0d9488",
    palette: {
      stops: ["#d5f0e5", "#e2f4eb", "#edf5ed", "#f6f6ec"],
      glow: "radial-gradient(68% 58% at 88% 6%, rgba(134, 239, 172, 0.58), transparent 68%), radial-gradient(60% 55% at 14% 96%, rgba(153, 246, 228, 0.52), transparent 70%)",
      frame: "#d5f0e5",
      glassBg: "rgba(250, 254, 252, 0.74)",
      glassStrong: "rgba(255, 255, 255, 0.91)",
      glassBorder: "rgba(255, 255, 255, 0.82)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.68)",
      cardShadow: "0 1px 2px rgba(20, 62, 54, 0.05), 0 18px 44px rgba(20, 62, 54, 0.09)",
      bg: "#fafdfb",
      bg1: "#f0f7f3",
      bg2: "#e5f0ea",
      bg3: "#d9e8e0",
      inputBg: "#ffffff",
      termBg: "#fafdfb",
      userBg: "#e5f4ee",
      fg: "#182623",
      fg2: "#576e68",
      fg3: "#89a19a",
      line: "rgba(20, 66, 56, 0.08)",
      line2: "rgba(20, 66, 56, 0.14)",
      hover: "rgba(20, 66, 56, 0.055)",
      press: "rgba(20, 66, 56, 0.10)",
    },
  },
  {
    id: "twilight",
    scheme: "light",
    label: "琉璃",
    accent: "#8b5cf6",
    palette: {
      stops: ["#e2dcfb", "#efe2f8", "#fbe6e2", "#fdf0de"],
      glow: "radial-gradient(68% 58% at 88% 6%, rgba(196, 181, 253, 0.72), transparent 68%), radial-gradient(60% 55% at 12% 96%, rgba(253, 186, 148, 0.60), transparent 70%)",
      frame: "#e2dcfb",
      glassBg: "rgba(254, 252, 255, 0.72)",
      glassStrong: "rgba(255, 255, 255, 0.90)",
      glassBorder: "rgba(255, 255, 255, 0.80)",
      glassHighlight: "rgba(255, 255, 255, 0.96)",
      cardBorder: "rgba(255, 255, 255, 0.68)",
      cardShadow: "0 1px 2px rgba(48, 34, 78, 0.05), 0 18px 44px rgba(48, 34, 78, 0.09)",
      bg: "#fcfaff",
      bg1: "#f5f0fc",
      bg2: "#ede5f7",
      bg3: "#e2d8f0",
      inputBg: "#ffffff",
      termBg: "#fcfaff",
      userBg: "#f0eafb",
      fg: "#221e2e",
      fg2: "#675f78",
      fg3: "#9b92ad",
      line: "rgba(48, 34, 80, 0.08)",
      line2: "rgba(48, 34, 80, 0.14)",
      hover: "rgba(48, 34, 80, 0.055)",
      press: "rgba(48, 34, 80, 0.10)",
    },
  },
  {
    id: "alabaster",
    scheme: "light",
    label: "素雪",
    accent: "#4f46e5",
    palette: {
      stops: ["#ecedf2", "#f2f3f6", "#f6f7f9", "#f9f9fb"],
      glow: "radial-gradient(70% 58% at 86% 4%, rgba(212, 218, 235, 0.65), transparent 68%)",
      frame: "#ecedf2",
      glassBg: "rgba(255, 255, 255, 0.80)",
      glassStrong: "rgba(255, 255, 255, 0.94)",
      glassBorder: "rgba(255, 255, 255, 0.88)",
      glassHighlight: "rgba(255, 255, 255, 0.98)",
      cardBorder: "rgba(255, 255, 255, 0.78)",
      cardShadow: "0 1px 2px rgba(24, 28, 40, 0.05), 0 18px 44px rgba(24, 28, 40, 0.08)",
      bg: "#ffffff",
      bg1: "#f7f8fa",
      bg2: "#eff1f5",
      bg3: "#e5e8ee",
      inputBg: "#ffffff",
      termBg: "#ffffff",
      userBg: "#eff1f7",
      fg: "#1d1e24",
      fg2: "#656875",
      fg3: "#979aa8",
      line: "rgba(24, 28, 40, 0.075)",
      line2: "rgba(24, 28, 40, 0.13)",
      hover: "rgba(24, 28, 40, 0.05)",
      press: "rgba(24, 28, 40, 0.095)",
    },
  },
];

export const DARK_WASH_THEMES: WashThemeEntry<DarkWashThemeId>[] = [
  {
    id: "midnight",
    scheme: "dark",
    label: "星夜",
    accent: "#7aa2f7",
    palette: {
      stops: ["#090e1c", "#0e162c", "#141d38", "#0f1528"],
      glow: "radial-gradient(74% 60% at 86% 2%, rgba(96, 165, 250, 0.34), transparent 64%), radial-gradient(64% 55% at 12% 96%, rgba(139, 92, 246, 0.24), transparent 68%)",
      frame: "#090e1c",
      glassBg: "rgba(16, 24, 46, 0.72)",
      glassStrong: "rgba(28, 41, 74, 0.86)",
      glassBorder: "rgba(147, 197, 253, 0.16)",
      glassHighlight: "rgba(191, 219, 254, 0.24)",
      cardBorder: "rgba(147, 197, 253, 0.14)",
      cardShadow: "0 2px 6px rgba(3, 6, 16, 0.40), 0 20px 50px rgba(3, 6, 18, 0.56)",
      bg: "#11192e",
      bg1: "#17213b",
      bg2: "#1d2a4a",
      bg3: "#26365e",
      inputBg: "#0c1324",
      termBg: "#0e162a",
      userBg: "#1e2e52",
      fg: "#edf2ff",
      fg2: "#9fb2d9",
      fg3: "#6b7fa8",
      line: "rgba(165, 198, 255, 0.09)",
      line2: "rgba(165, 198, 255, 0.16)",
      hover: "rgba(165, 198, 255, 0.07)",
      press: "rgba(165, 198, 255, 0.13)",
    },
  },
  {
    id: "nebula",
    scheme: "dark",
    label: "星云",
    accent: "#c084fc",
    palette: {
      stops: ["#100b1c", "#17102a", "#21132e", "#191024"],
      glow: "radial-gradient(74% 60% at 86% 2%, rgba(192, 132, 252, 0.32), transparent 64%), radial-gradient(64% 55% at 12% 96%, rgba(244, 114, 182, 0.22), transparent 68%)",
      frame: "#100b1c",
      glassBg: "rgba(23, 17, 40, 0.74)",
      glassStrong: "rgba(39, 28, 66, 0.86)",
      glassBorder: "rgba(216, 180, 254, 0.16)",
      glassHighlight: "rgba(243, 232, 255, 0.22)",
      cardBorder: "rgba(216, 180, 254, 0.14)",
      cardShadow: "0 2px 6px rgba(6, 3, 14, 0.42), 0 20px 50px rgba(6, 3, 16, 0.58)",
      bg: "#181228",
      bg1: "#201836",
      bg2: "#291f44",
      bg3: "#352857",
      inputBg: "#120d20",
      termBg: "#150f24",
      userBg: "#2c204a",
      fg: "#f5f0ff",
      fg2: "#b9abd6",
      fg3: "#8475a3",
      line: "rgba(220, 195, 255, 0.09)",
      line2: "rgba(220, 195, 255, 0.16)",
      hover: "rgba(220, 195, 255, 0.07)",
      press: "rgba(220, 195, 255, 0.13)",
    },
  },
  {
    id: "abyss",
    scheme: "dark",
    label: "极光",
    accent: "#2dd4bf",
    palette: {
      stops: ["#061318", "#081c24", "#0c2230", "#11182c"],
      glow: "radial-gradient(74% 60% at 86% 2%, rgba(45, 212, 191, 0.30), transparent 64%), radial-gradient(64% 55% at 14% 96%, rgba(99, 102, 241, 0.24), transparent 68%)",
      frame: "#061318",
      glassBg: "rgba(11, 27, 34, 0.74)",
      glassStrong: "rgba(18, 44, 54, 0.86)",
      glassBorder: "rgba(94, 234, 212, 0.15)",
      glassHighlight: "rgba(204, 251, 241, 0.22)",
      cardBorder: "rgba(94, 234, 212, 0.13)",
      cardShadow: "0 2px 6px rgba(2, 10, 14, 0.42), 0 20px 50px rgba(2, 10, 16, 0.58)",
      bg: "#0c1d24",
      bg1: "#112730",
      bg2: "#17333e",
      bg3: "#1f4250",
      inputBg: "#08161c",
      termBg: "#0a1a20",
      userBg: "#153640",
      fg: "#eaf8f6",
      fg2: "#99c2bd",
      fg3: "#67908b",
      line: "rgba(150, 240, 225, 0.09)",
      line2: "rgba(150, 240, 225, 0.16)",
      hover: "rgba(150, 240, 225, 0.07)",
      press: "rgba(150, 240, 225, 0.13)",
    },
  },
  {
    id: "frost",
    scheme: "dark",
    label: "霜夜",
    accent: "#88c0d0",
    palette: {
      stops: ["#131720", "#171d29", "#1b2332", "#171c26"],
      glow: "radial-gradient(74% 60% at 86% 2%, rgba(136, 192, 208, 0.26), transparent 64%), radial-gradient(64% 55% at 14% 96%, rgba(129, 161, 193, 0.18), transparent 68%)",
      frame: "#131720",
      glassBg: "rgba(26, 33, 46, 0.76)",
      glassStrong: "rgba(40, 50, 70, 0.88)",
      glassBorder: "rgba(180, 210, 235, 0.14)",
      glassHighlight: "rgba(229, 233, 240, 0.20)",
      cardBorder: "rgba(180, 210, 235, 0.12)",
      cardShadow: "0 2px 6px rgba(6, 10, 18, 0.36), 0 20px 50px rgba(6, 10, 18, 0.50)",
      bg: "#1b2230",
      bg1: "#222a3b",
      bg2: "#2a3448",
      bg3: "#344057",
      inputBg: "#151b26",
      termBg: "#181f2c",
      userBg: "#273348",
      fg: "#eceff4",
      fg2: "#aeb8cc",
      fg3: "#7b87a0",
      line: "rgba(216, 228, 244, 0.085)",
      line2: "rgba(216, 228, 244, 0.15)",
      hover: "rgba(216, 228, 244, 0.065)",
      press: "rgba(216, 228, 244, 0.12)",
    },
  },
  {
    id: "obsidian",
    scheme: "dark",
    label: "曜石",
    accent: "#a3b3cc",
    palette: {
      stops: ["#090a0d", "#0e1015", "#12151c", "#0c0e12"],
      glow: "radial-gradient(72% 58% at 86% 2%, rgba(226, 232, 240, 0.13), transparent 64%), radial-gradient(60% 50% at 14% 96%, rgba(148, 163, 184, 0.08), transparent 68%)",
      frame: "#090a0d",
      glassBg: "rgba(21, 23, 29, 0.78)",
      glassStrong: "rgba(35, 39, 49, 0.88)",
      glassBorder: "rgba(255, 255, 255, 0.11)",
      glassHighlight: "rgba(255, 255, 255, 0.18)",
      cardBorder: "rgba(255, 255, 255, 0.10)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.42), 0 20px 50px rgba(0, 0, 0, 0.58)",
      bg: "#15171e",
      bg1: "#1c1f28",
      bg2: "#242834",
      bg3: "#2e3342",
      inputBg: "#0f1117",
      termBg: "#12141b",
      userBg: "#232734",
      fg: "#f1f3f8",
      fg2: "#a1a7b5",
      fg3: "#6f7685",
      line: "rgba(255, 255, 255, 0.08)",
      line2: "rgba(255, 255, 255, 0.14)",
      hover: "rgba(255, 255, 255, 0.06)",
      press: "rgba(255, 255, 255, 0.12)",
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
