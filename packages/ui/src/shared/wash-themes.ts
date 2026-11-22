/**
 * 窗口 wash 主题：浅色 5 套 + 深色 5 套（共 10 套独立调色板）。
 *
 * 每套主题拥有独立的渐变窗框、双层氛围柔光、玻璃层参数与整套表面/文字色板，
 * 让主窗口、玻璃岛屿、设置弹窗、下拉浮层与终端在色温和层次上浑然一体。
 */

export type LightWashThemeId = "sakura" | "sky" | "matcha" | "twilight" | "alabaster";
export type DarkWashThemeId = "obsidian" | "frost" | "ember" | "abyss" | "moss";
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
    id: "obsidian",
    scheme: "dark",
    label: "曜石",
    accent: "#b9c2cf",
    palette: {
      stops: ["#07080a", "#0a0c10", "#0d1014", "#090a0d"],
      glow: "linear-gradient(180deg, rgba(226, 232, 240, 0.07), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(203, 213, 225, 0.13), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(148, 163, 184, 0.08), transparent 70%)",
      frame: "#07080a",
      glassBg: "rgba(16, 18, 22, 0.76)",
      glassStrong: "rgba(38, 42, 50, 0.62)",
      glassBorder: "rgba(255, 255, 255, 0.12)",
      glassHighlight: "rgba(255, 255, 255, 0.20)",
      cardBorder: "rgba(255, 255, 255, 0.10)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.44), 0 22px 56px rgba(0, 0, 0, 0.60)",
      bg: "#0f1115",
      bg1: "#14161b",
      bg2: "#1a1d23",
      bg3: "#22252d",
      inputBg: "#0a0b0f",
      termBg: "#0d0e12",
      userBg: "#191c22",
      fg: "#f1f4f8",
      fg2: "#a8b0bd",
      fg3: "#757d8a",
      line: "rgba(255, 255, 255, 0.09)",
      line2: "rgba(255, 255, 255, 0.15)",
      hover: "rgba(255, 255, 255, 0.07)",
      press: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    id: "frost",
    scheme: "dark",
    label: "霜夜",
    accent: "#a3b3c6",
    palette: {
      stops: ["#080a0f", "#0b0e15", "#0e131b", "#090c12"],
      glow: "linear-gradient(180deg, rgba(226, 240, 255, 0.06), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(148, 180, 210, 0.14), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(120, 150, 180, 0.09), transparent 70%)",
      frame: "#080a0f",
      glassBg: "rgba(17, 21, 29, 0.76)",
      glassStrong: "rgba(40, 50, 66, 0.62)",
      glassBorder: "rgba(190, 215, 240, 0.13)",
      glassHighlight: "rgba(230, 240, 250, 0.20)",
      cardBorder: "rgba(190, 215, 240, 0.10)",
      cardShadow: "0 2px 6px rgba(2, 4, 8, 0.44), 0 22px 56px rgba(2, 5, 10, 0.60)",
      bg: "#10141b",
      bg1: "#151a22",
      bg2: "#1b212b",
      bg3: "#232a36",
      inputBg: "#0b0e14",
      termBg: "#0e1118",
      userBg: "#1a2029",
      fg: "#edf1f7",
      fg2: "#aeb7c4",
      fg3: "#7b8493",
      line: "rgba(216, 228, 244, 0.085)",
      line2: "rgba(216, 228, 244, 0.14)",
      hover: "rgba(216, 228, 244, 0.065)",
      press: "rgba(216, 228, 244, 0.12)",
    },
  },
  {
    id: "ember",
    scheme: "dark",
    label: "余烬",
    accent: "#c4a084",
    palette: {
      stops: ["#0a0806", "#0e0b08", "#110e0a", "#0b0907"],
      glow: "linear-gradient(180deg, rgba(255, 225, 190, 0.05), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(255, 170, 90, 0.12), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(200, 90, 60, 0.08), transparent 70%)",
      frame: "#0a0806",
      glassBg: "rgba(20, 17, 14, 0.76)",
      glassStrong: "rgba(52, 42, 32, 0.60)",
      glassBorder: "rgba(255, 200, 150, 0.12)",
      glassHighlight: "rgba(255, 225, 195, 0.18)",
      cardBorder: "rgba(255, 200, 150, 0.09)",
      cardShadow: "0 2px 6px rgba(4, 3, 2, 0.44), 0 22px 56px rgba(6, 4, 2, 0.60)",
      bg: "#131110",
      bg1: "#181513",
      bg2: "#1e1a17",
      bg3: "#27221e",
      inputBg: "#0d0b09",
      termBg: "#100e0c",
      userBg: "#1e1a16",
      fg: "#f5efe8",
      fg2: "#c0b3a5",
      fg3: "#8c8175",
      line: "rgba(255, 210, 170, 0.085)",
      line2: "rgba(255, 210, 170, 0.14)",
      hover: "rgba(255, 210, 170, 0.065)",
      press: "rgba(255, 210, 170, 0.12)",
    },
  },
  {
    id: "abyss",
    scheme: "dark",
    label: "极光",
    accent: "#8fbdb6",
    palette: {
      stops: ["#05090b", "#070c0f", "#0a1013", "#060a0d"],
      glow: "linear-gradient(180deg, rgba(190, 255, 245, 0.05), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(45, 212, 191, 0.13), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(56, 132, 255, 0.07), transparent 70%)",
      frame: "#05090b",
      glassBg: "rgba(12, 19, 22, 0.76)",
      glassStrong: "rgba(26, 48, 52, 0.60)",
      glassBorder: "rgba(120, 230, 215, 0.12)",
      glassHighlight: "rgba(200, 250, 245, 0.18)",
      cardBorder: "rgba(120, 230, 215, 0.09)",
      cardShadow: "0 2px 6px rgba(1, 4, 6, 0.46), 0 22px 56px rgba(1, 6, 8, 0.62)",
      bg: "#0c1316",
      bg1: "#10181c",
      bg2: "#151f23",
      bg3: "#1c282d",
      inputBg: "#080e10",
      termBg: "#0a1113",
      userBg: "#142024",
      fg: "#e9f6f4",
      fg2: "#a4c2be",
      fg3: "#758e8b",
      line: "rgba(150, 240, 225, 0.08)",
      line2: "rgba(150, 240, 225, 0.14)",
      hover: "rgba(150, 240, 225, 0.06)",
      press: "rgba(150, 240, 225, 0.11)",
    },
  },
  {
    id: "moss",
    scheme: "dark",
    label: "苔原",
    accent: "#9cb3a5",
    palette: {
      stops: ["#060907", "#080c0a", "#0a0f0c", "#070a08"],
      glow: "linear-gradient(180deg, rgba(200, 255, 220, 0.04), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(58, 190, 130, 0.11), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(140, 200, 60, 0.06), transparent 70%)",
      frame: "#060907",
      glassBg: "rgba(13, 18, 16, 0.76)",
      glassStrong: "rgba(30, 46, 38, 0.60)",
      glassBorder: "rgba(150, 220, 180, 0.11)",
      glassHighlight: "rgba(210, 245, 225, 0.16)",
      cardBorder: "rgba(150, 220, 180, 0.08)",
      cardShadow: "0 2px 6px rgba(2, 4, 3, 0.46), 0 22px 56px rgba(2, 6, 4, 0.62)",
      bg: "#0d1210",
      bg1: "#111714",
      bg2: "#161d19",
      bg3: "#1d2621",
      inputBg: "#090d0b",
      termBg: "#0b100e",
      userBg: "#151d19",
      fg: "#ecf3ef",
      fg2: "#aabcb2",
      fg3: "#7c8c83",
      line: "rgba(160, 230, 200, 0.08)",
      line2: "rgba(160, 230, 200, 0.14)",
      hover: "rgba(160, 230, 200, 0.06)",
      press: "rgba(160, 230, 200, 0.11)",
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
  petal: "ember",
  dusk: "ember",
  mist: "frost",
  tide: "abyss",
  meadow: "moss",
  aurora: "abyss",
  apricot: "ember",
  dune: "frost",
  paper: "obsidian",
  plain: "obsidian",
  // 改名前的两套（深蓝 / 紫），旧设置迁到近似的中性黑
  midnight: "obsidian",
  nebula: "frost",
};

export function normalizeLightWashTheme(value: unknown): LightWashThemeId {
  if (typeof value !== "string") return "sakura";
  if ((LIGHT_IDS as string[]).includes(value)) return value as LightWashThemeId;
  return LEGACY_LIGHT_MAP[value] ?? "sakura";
}

export function normalizeDarkWashTheme(value: unknown): DarkWashThemeId {
  if (typeof value !== "string") return "obsidian";
  if ((DARK_IDS as string[]).includes(value)) return value as DarkWashThemeId;
  return LEGACY_DARK_MAP[value] ?? "obsidian";
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
