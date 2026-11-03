/**
 * 文件树的排序。
 *
 * 两种模式，各两种方向：
 * - `folders-first`：文件夹在前、文件在后，各自按名字排（VS Code 默认的心智）；
 * - `mixed`：不分类型，纯按名字排。
 *
 * 名字比较走固定的自然排序（不依赖系统 locale）：
 * `file2` 要排在 `file10` 前面，大小写不敏感，中文按码点排在拉丁字母之后。
 * 名字相同时用路径收尾，保证每次渲染顺序稳定（否则 Vue 会无谓重排 DOM）。
 */

export type FileSortMode = "folders-first" | "mixed";
export type FileSortDirection = "asc" | "desc";

export interface FileSortSetting {
  mode: FileSortMode;
  direction: FileSortDirection;
}

export const FILE_SORT_DEFAULT: FileSortSetting = { mode: "folders-first", direction: "asc" };

export interface SortableEntry {
  name: string;
  kind: string;
  relative?: string;
  path?: string;
}

export function normalizeSortMode(value: unknown): FileSortMode {
  return value === "mixed" ? "mixed" : "folders-first";
}

export function normalizeSortDirection(value: unknown): FileSortDirection {
  return value === "desc" ? "desc" : "asc";
}

/**
 * 名字比较：固定规则的自然排序（不依赖系统 locale）。
 *
 * 用 `localeCompare` 会在不同机器上给出不同结果（平台/ICU/locale 都能变），
 * 文件树顺序飘忽很难察觉也会让测试两台机器对不上。所以这里自己拆段：
 * 数字按数值比（`file2` < `file10`）、其余按码点比（大小写不敏感，平局时再用原串定序）。
 */
function naturalCompare(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const parts = (value: string) => value.match(/\d+|\D+/g) ?? [];
  const as = parts(al);
  const bs = parts(bl);
  for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  // 忽略大小写后完全同名：用原串区分，保证每次渲染顺序稳定
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareName(a: SortableEntry, b: SortableEntry): number {
  const byName = naturalCompare(a.name, b.name);
  if (byName !== 0) return byName;
  return naturalCompare(String(a.relative ?? a.path ?? ""), String(b.relative ?? b.path ?? ""));
}

/** 排序后的副本（不改入参）。 */
export function sortEntries<T extends SortableEntry>(entries: readonly T[], setting: FileSortSetting = FILE_SORT_DEFAULT): T[] {
  const mode = normalizeSortMode(setting.mode);
  const direction = normalizeSortDirection(setting.direction);
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (mode === "folders-first") {
      const aFolder = a.kind === "folder" ? 0 : 1;
      const bFolder = b.kind === "folder" ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
    }
    const byName = compareName(a, b);
    return direction === "desc" ? -byName : byName;
  });
  return sorted;
}

/** 排序菜单里的一项：给 openMenu 用。 */
export interface FileSortOption extends FileSortSetting {
  label: string;
}

export const FILE_SORT_OPTIONS: readonly FileSortOption[] = [
  { mode: "folders-first", direction: "asc", label: "文件夹在前 · 名称 A→Z" },
  { mode: "mixed", direction: "asc", label: "混合显示 · 名称 A→Z" },
  { mode: "folders-first", direction: "desc", label: "文件夹在前 · 名称 Z→A" },
  { mode: "mixed", direction: "desc", label: "混合显示 · 名称 Z→A" },
];

export function sameSortSetting(a: FileSortSetting, b: FileSortSetting): boolean {
  return normalizeSortMode(a.mode) === normalizeSortMode(b.mode) && normalizeSortDirection(a.direction) === normalizeSortDirection(b.direction);
}
