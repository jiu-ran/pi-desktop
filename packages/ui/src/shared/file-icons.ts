import {
  DEFAULT_ICON,
  EXT,
  FOLDER,
  NAME,
  materialFileIcons,
  type MaterialFileIcon,
} from "./material-file-icons.ts";

/**
 * 文件类型图标：文件名 → Material Icon Theme 图标（+ 主题）。
 *
 * 图标本身来自 Material Icon Theme（https://github.com/PKief/vscode-material-icon-theme，MIT），
 * 由 `scripts/build-material-file-icons.mjs` 从上游的映射表里挑出我们用的键、把图形内联进来；
 * 这个文件只负责「认类型」「决定着色方式」「没有图标时兜底」。
 *
 * 三种主题共用同一套形状，只换着色：
 * - `material`（默认）：Material 原色（保留它的多色，比如 Vue 的绿+深灰）；
 * - `mono`：全部换成正文颜色，适合极简；
 * - `block`：图标主色的方块 + 反白图形。
 *
 * Material 覆盖不到的冷门类型不做特殊处理：直接退回默认样式（文件用 `document`，
 * 文件夹用 `folder`），不为每个扩展名造一个「徽标」——那样整棵树反而更花。
 */
export type FileIconThemeId = "material" | "mono" | "block";

export const FILE_ICON_THEMES: Array<{ id: FileIconThemeId; label: string; hint: string }> = [
  { id: "material", label: "Material", hint: "Material 原色（默认）" },
  { id: "mono", label: "单色", hint: "只有形状，跟随正文颜色" },
  { id: "block", label: "填充", hint: "品牌色方块 + 反白图标" },
];

export interface FileIconView {
  theme: FileIconThemeId;
  /** 命中的 Material 图标名（徽标兜底时是 "unknown"） */
  icon: string;
  /** 给人看的类型名 */
  label: string;
  /** 图标主色 */
  color: string;
  /** 图形实际颜色：Material=原色、单色=正文色、填充=黑/白 */
  inkColor: string;
  /** SVG 的 viewBox（上游网格不统一，必须照搬） */
  viewBox: string;
  /** SVG 内容 */
  body: string;
  isFolder: boolean;
}

/** 取扩展名：`a.d.ts` → `ts`；`.gitignore` → `""`（点开头的算特殊文件名） */
export function fileExtension(name: string): string {
  const base = String(name ?? "").trim().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** 文件名（去掉目录部分），用于特殊文件名匹配 */
export function fileName(name: string): string {
  return String(name ?? "").trim().split(/[\\/]/).pop() ?? "";
}

/** 图标名 → 展示用类型名（`folder-src` → `Folder src`） */
export function iconLabel(icon: string): string {
  const text = String(icon ?? "").replace(/[-_]/g, " ").trim();
  if (!text) return "文件";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * 命中的图标名；`null` 表示「上游也没这个类型」，由调用方走徽标兜底。
 * 优先级：文件夹 → 特殊文件名 → `.env.local` 这类前缀回退 → 扩展名 → 点开头当配置。
 */
export function fileIconName(name: string, options: { isFolder?: boolean } = {}): string | null {
  if (options.isFolder) return FOLDER[fileName(name).toLowerCase()] ?? "folder";
  const base = fileName(name).toLowerCase();
  if (!base) return null;
  const special = NAME[base];
  if (special) return special;
  if (base.startsWith(".")) {
    for (let index = base.length - 1; index > 1; index -= 1) {
      if (base[index] !== ".") continue;
      const hit = NAME[base.slice(0, index)];
      if (hit) return hit;
    }
  }
  const ext = fileExtension(base);
  if (ext && EXT[ext]) return EXT[ext]!;
  if (base.startsWith(".")) return DEFAULT_ICON;
  return null;
}

/**
 * 品牌色上该用黑字还是白字（填充主题用）。
 *
 * 按 WCAG 相对亮度挑，阈值 0.32：浅色（黄、青）走黑字，深色走白字。
 */
export function contrastInk(color: string): string {
  const hex = String(color ?? "").replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.32 ? "#12141a" : "#ffffff";
}

/** 解析成界面要用的视图 */
export function resolveFileIcon(
  name: string,
  options: { theme?: FileIconThemeId; isFolder?: boolean; open?: boolean } = {},
): FileIconView {
  const theme: FileIconThemeId = options.theme ?? "material";
  const iconName = fileIconName(name, { isFolder: options.isFolder });
  const icon: MaterialFileIcon | undefined = iconName ? materialFileIcons[iconName] : undefined;

  if (iconName && icon) {
    const mono = theme !== "material";
    return {
      theme,
      icon: iconName,
      label: iconLabel(iconName),
      color: icon.color,
      viewBox: icon.viewBox,
      inkColor: theme === "block" ? contrastInk(icon.color) : theme === "mono" ? "var(--fg-2)" : icon.color,
      // Material 的多色图标在单色/填充主题下统一成 currentColor
      body: mono ? icon.mono : icon.body,
      isFolder: Boolean(options.isFolder),
    };
  }

  // 没有专属图标：文件用 document，文件夹用 folder（默认样式，不造徽标）
  const fallbackName = options.isFolder ? "folder" : DEFAULT_ICON;
  const fallback = materialFileIcons[fallbackName] ?? materialFileIcons[DEFAULT_ICON]!;
  const mono = theme !== "material";
  return {
    theme,
    icon: fallbackName,
    label: options.isFolder ? "文件夹" : "文件",
    color: fallback.color,
    viewBox: fallback.viewBox,
    inkColor:
      theme === "block" ? contrastInk(fallback.color) : theme === "mono" ? "var(--fg-2)" : fallback.color,
    body: mono ? fallback.mono : fallback.body,
    isFolder: Boolean(options.isFolder),
  };
}

/** 设置页预览用的固定样例 */
export const FILE_ICON_SAMPLES = [
  "src/app.ts",
  "src/App.vue",
  "src/styles.css",
  "package.json",
  "README.md",
  "assets/logo.png",
  "bundle.tar.gz",
] as const;
