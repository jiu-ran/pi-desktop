/**
 * 窗口 wash 主题：浅色 5 套 + 深色 5 套（共 10 套独立调色板）。
 *
 * 每套主题拥有独立的渐变窗框、双层氛围柔光、玻璃层参数与整套表面/文字色板，
 * 让主窗口、玻璃岛屿、设置弹窗、下拉浮层与终端在色温和层次上浑然一体。
 */

export type LightWashThemeId = "sakura" | "sky" | "matcha" | "twilight" | "alabaster";
export type DarkWashThemeId = "obsidian" | "ink" | "graphite" | "abyss" | "amethyst";
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
  // 纯黑：窗口底就是 #000，岛面压到 L* 3 附近，OLED 上最省电、最像「关灯」
  {
    id: "obsidian",
    scheme: "dark",
    label: "曜石",
    accent: "#c8c8cf",
    palette: {
      stops: ["#000000", "#050506", "#08080a", "#030304"],
      glow: "linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(226, 232, 240, 0.10), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(148, 163, 184, 0.06), transparent 70%)",
      frame: "#000000",
      glassBg: "rgba(12, 12, 13, 0.78)",
      glassStrong: "rgba(38, 38, 41, 0.62)",
      glassBorder: "rgba(255, 255, 255, 0.11)",
      glassHighlight: "rgba(255, 255, 255, 0.18)",
      cardBorder: "rgba(255, 255, 255, 0.09)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.50), 0 22px 56px rgba(0, 0, 0, 0.66)",
      bg: "#0a0a0b",
      bg1: "#111113",
      bg2: "#171719",
      bg3: "#202023",
      inputBg: "#050506",
      termBg: "#08080a",
      userBg: "#17171a",
      fg: "#f4f4f5",
      fg2: "#a9a9b0",
      fg3: "#77777f",
      line: "rgba(255, 255, 255, 0.08)",
      line2: "rgba(255, 255, 255, 0.14)",
      hover: "rgba(255, 255, 255, 0.06)",
      press: "rgba(255, 255, 255, 0.11)",
    },
  },
  // 灰黑：黑色打底，表面往上抬两档灰，比纯黑有层次但不带任何色偏
  {
    id: "ink",
    scheme: "dark",
    label: "墨玉",
    accent: "#b4b4bc",
    palette: {
      stops: ["#0b0b0d", "#0f0f12", "#131316", "#0c0c0e"],
      glow: "linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(214, 214, 222, 0.09), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(160, 160, 172, 0.05), transparent 70%)",
      frame: "#0b0b0d",
      glassBg: "rgba(22, 22, 25, 0.78)",
      glassStrong: "rgba(46, 46, 51, 0.64)",
      glassBorder: "rgba(255, 255, 255, 0.10)",
      glassHighlight: "rgba(255, 255, 255, 0.17)",
      cardBorder: "rgba(255, 255, 255, 0.085)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.48), 0 22px 56px rgba(0, 0, 0, 0.64)",
      bg: "#131316",
      bg1: "#1a1a1e",
      bg2: "#212126",
      bg3: "#2b2b31",
      inputBg: "#0e0e11",
      termBg: "#101013",
      userBg: "#212126",
      fg: "#ededf0",
      fg2: "#a7a7b0",
      fg3: "#78787f",
      line: "rgba(255, 255, 255, 0.075)",
      line2: "rgba(255, 255, 255, 0.135)",
      hover: "rgba(255, 255, 255, 0.055)",
      press: "rgba(255, 255, 255, 0.10)",
    },
  },
  // 纯灰：中性灰，取自 VS Code Dark Modern 的灰阶思路，不带色相
  {
    id: "graphite",
    scheme: "dark",
    label: "石墨",
    accent: "#b0b0b8",
    palette: {
      stops: ["#1c1c1f", "#202024", "#242428", "#1e1e21"],
      glow: "linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(220, 220, 228, 0.08), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(170, 170, 182, 0.05), transparent 70%)",
      frame: "#1c1c1f",
      glassBg: "rgba(37, 37, 41, 0.78)",
      glassStrong: "rgba(62, 62, 69, 0.70)",
      glassBorder: "rgba(255, 255, 255, 0.10)",
      glassHighlight: "rgba(255, 255, 255, 0.16)",
      cardBorder: "rgba(255, 255, 255, 0.085)",
      cardShadow: "0 2px 6px rgba(0, 0, 0, 0.40), 0 22px 56px rgba(0, 0, 0, 0.54)",
      bg: "#252529",
      bg1: "#2d2d32",
      bg2: "#35353b",
      bg3: "#3f3f46",
      inputBg: "#212125",
      termBg: "#232327",
      userBg: "#35353b",
      fg: "#e9e9ec",
      fg2: "#b0b0b8",
      fg3: "#83838c",
      line: "rgba(255, 255, 255, 0.085)",
      line2: "rgba(255, 255, 255, 0.145)",
      hover: "rgba(255, 255, 255, 0.065)",
      press: "rgba(255, 255, 255, 0.115)",
    },
  },
  // 参考 Tokyo Night：深靛蓝夜色，蓝紫点缀
  {
    id: "abyss",
    scheme: "dark",
    label: "极光",
    accent: "#8fa8e0",
    palette: {
      stops: ["#141420", "#16161e", "#1a1b26", "#13131b"],
      glow: "linear-gradient(180deg, rgba(200, 215, 255, 0.05), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(122, 162, 247, 0.12), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(157, 124, 255, 0.08), transparent 70%)",
      frame: "#141420",
      glassBg: "rgba(26, 27, 38, 0.78)",
      glassStrong: "rgba(41, 46, 66, 0.72)",
      glassBorder: "rgba(192, 202, 245, 0.14)",
      glassHighlight: "rgba(192, 202, 245, 0.20)",
      cardBorder: "rgba(192, 202, 245, 0.11)",
      cardShadow: "0 2px 6px rgba(8, 8, 14, 0.44), 0 22px 56px rgba(8, 8, 16, 0.60)",
      bg: "#1a1b26",
      bg1: "#1f2335",
      bg2: "#292e42",
      bg3: "#333a52",
      inputBg: "#15161f",
      termBg: "#171822",
      userBg: "#232a44",
      fg: "#cfd8f5",
      fg2: "#9aa5ce",
      fg3: "#737aa2",
      line: "rgba(192, 202, 245, 0.10)",
      line2: "rgba(192, 202, 245, 0.17)",
      hover: "rgba(192, 202, 245, 0.07)",
      press: "rgba(192, 202, 245, 0.13)",
    },
  },
  // 参考 Dracula：紫罗兰夜色，紫 / 粉点缀
  {
    id: "amethyst",
    scheme: "dark",
    label: "紫檀",
    accent: "#c9a3f5",
    palette: {
      stops: ["#181826", "#1e1c2c", "#242233", "#1a1826"],
      glow: "linear-gradient(180deg, rgba(222, 202, 255, 0.05), transparent 24%), radial-gradient(72% 60% at 86% 0%, rgba(189, 147, 249, 0.22), transparent 66%), radial-gradient(62% 52% at 12% 98%, rgba(255, 121, 198, 0.12), transparent 70%)",
      frame: "#181826",
      glassBg: "rgba(40, 38, 58, 0.78)",
      glassStrong: "rgba(92, 74, 132, 0.55)",
      glassBorder: "rgba(214, 190, 255, 0.15)",
      glassHighlight: "rgba(240, 230, 255, 0.20)",
      cardBorder: "rgba(214, 190, 255, 0.11)",
      cardShadow: "0 2px 6px rgba(10, 8, 16, 0.46), 0 22px 56px rgba(14, 10, 24, 0.62)",
      bg: "#29273b",
      bg1: "#322e47",
      bg2: "#3c3853",
      bg3: "#48425f",
      inputBg: "#232132",
      termBg: "#262434",
      userBg: "#3a3452",
      fg: "#f7f3ff",
      fg2: "#bfb6d8",
      fg3: "#918aa9",
      line: "rgba(214, 190, 255, 0.10)",
      line2: "rgba(214, 190, 255, 0.17)",
      hover: "rgba(214, 190, 255, 0.07)",
      press: "rgba(214, 190, 255, 0.13)",
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
  petal: "amethyst",
  dusk: "amethyst",
  mist: "abyss",
  tide: "abyss",
  meadow: "ink",
  aurora: "abyss",
  apricot: "amethyst",
  dune: "graphite",
  paper: "obsidian",
  plain: "obsidian",
  // 历史主题名（深蓝 / 紫 / 青 / 棕 / 绿 / 灰）都迁到最接近的一套
  midnight: "obsidian",
  nebula: "amethyst",
  frost: "ink",
  ember: "graphite",
  moss: "ink",
  slate: "graphite",
  ash: "graphite",
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
