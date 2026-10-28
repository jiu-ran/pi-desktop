import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从 IBM Carbon Icons（Apache-2.0）生成 `packages/ui/src/shared/icons.ts`。
 *
 * 为什么不用运行时依赖：图标要在离线环境、任意主题下都可用，且只要 currentColor；
 * 生成时把用到的图标内联成字符串，既不把 2000+ 图标打进包，也不用引入字体或 CDN。
 *
 * 尺寸沿用旧图标表的默认值（12–16px）：Carbon 的 32 网格图标缩到 16px 边缘仍然清楚，
 * 有 16px 专用画的版本优先用它。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const carbon = path.join(root, "packages", "ui", "node_modules", "@carbon", "icons", "svg");
const target = path.join(root, "packages", "ui", "src", "shared", "icons.ts");

/** 项目里的图标名 → Carbon 图标文件名（不带 .svg） */
const MAP = {
  sidebar: "side-panel--close",
  panel: "side-panel--open",
  plus: "add",
  attach: "attachment",
  image: "image",
  chat: "chat",
  /** 会话块用的气泡图标（与 chat 同一个字形） */
  message: "chat",
  folder: "folder",
  /** 「打开文件夹 / 克隆」入口：文件夹右下角带加号 */
  folderAdd: "folder--add",
  file: "document",
  code: "code",
  json: "data--1",
  archive: "archive",
  text: "text--align--left",
  wrap: "text--wrap",
  eye: "view",
  eyeOff: "view--off",
  diff: "file--diff",
  terminal: "terminal",
  events: "activity",
  puzzle: "apps",
  mcp: "logo--model-context-protocol",
  package: "package",
  globe: "earth",
  download: "download",
  gear: "settings",
  sliders: "settings--adjust",
  palette: "color-palette",
  search: "search",
  moon: "moon",
  sun: "sun",
  branch: "branch",
  check: "checkmark",
  checkCircle: "checkmark--filled",
  chevronDown: "chevron--down",
  chevronRight: "chevron--right",
  chevronLeft: "chevron--left",
  close: "close",
  refresh: "renew",
  model: "cube",
  brain: "idea",
  stop: "stop",
  send: "send",
  reveal: "launch",
  more: "overflow-menu--horizontal",
  trash: "trash-can",
  copy: "copy",
  upload: "upload",
  pull: "arrow--down",
  history: "time",
  minus: "subtract",
  /** 队列卡片：编辑 / 撤回 */
  edit: "edit",
  undo: "undo",
};

/** 每个图标在界面里的默认边长（沿用旧图标表，避免布局跳动） */
const SIZE = {
  image: 14,
  file: 15,
  code: 15,
  json: 15,
  archive: 15,
  text: 15,
  wrap: 14,
  eye: 14,
  eyeOff: 14,
  globe: 14,
  download: 14,
  branch: 14,
  check: 14,
  checkCircle: 14,
  chevronDown: 12,
  chevronRight: 12,
  chevronLeft: 12,
  close: 12,
  refresh: 14,
  model: 14,
  brain: 14,
  send: 13,
  reveal: 14,
  more: 14,
  trash: 14,
  copy: 14,
  upload: 14,
  pull: 14,
  history: 14,
  minus: 14,
  edit: 13,
  undo: 13,
};

function readIcon(name) {
  for (const size of ["16", "32"]) {
    const file = path.join(carbon, size, `${name}.svg`);
    try {
      return { size, text: readFileSync(file, "utf8") };
    } catch {
      // 没有 16px 专用版本时退回 32 网格版本
    }
  }
  throw new Error(`Carbon 里找不到图标：${name}`);
}

function toBody(text, name) {
  const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1];
  if (!viewBox) throw new Error(`图标缺少 viewBox：${name}`);
  const body = text
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/\s*\n\s*/g, "")
    .trim();
  if (!body) throw new Error(`图标没有内容：${name}`);
  return { viewBox, body };
}

const entries = [];
for (const [key, name] of Object.entries(MAP)) {
  const { text, size } = readIcon(name);
  const { viewBox, body } = toBody(text, name);
  const pixels = SIZE[key] ?? 16;
  entries.push({ key, name, size, viewBox, body, pixels });
}

const lines = entries.map(({ key, viewBox, body, pixels }) => {
  const svg = `<svg class="pi-icon" viewBox="${viewBox}" width="${pixels}" height="${pixels}" fill="currentColor" aria-hidden="true">${body}</svg>`;
  return `  ${key}: '${svg.replace(/'/g, "\\'")}',`;
});

const out = `/**
 * 图标表：IBM Carbon Icons（Apache-2.0）。
 *
 * 由 \`node scripts/build-icons.mjs\` 生成，不要手改；要加图标先改脚本里的 MAP 再重新生成。
 * 值为完整 SVG 字符串（fill 取 currentColor），模板里用 \`v-html="icons.xxx"\` 渲染。
 */
export const icons = {
${lines.join("\n")}
} as const;

export type IconName = keyof typeof icons;

/** 取一个图标（未知名字返回空串，方便可选图标的场景） */
export function icon(name: string): string {
  return (icons as Record<string, string>)[name] ?? "";
}
`;

writeFileSync(target, out);
console.log(`icons: ${entries.length} 个 → ${path.relative(root, target)}`);
const from16 = entries.filter((entry) => entry.size === "16").length;
console.log(`  16px 专用稿 ${from16} 个，32 网格缩放 ${entries.length - from16} 个`);
