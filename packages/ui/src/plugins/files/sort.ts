import { reactive, watch } from "vue";
import {
  FILE_SORT_DEFAULT,
  normalizeSortDirection,
  normalizeSortMode,
  sameSortSetting,
  sortEntries,
  type FileSortSetting,
} from "../../shared/file-sort.ts";
import { readStorage, writeStorage } from "../../shared/storage.ts";

/**
 * 文件树的排序设置（本地保存，全项目共用）。
 *
 * 根目录与每一层子目录都用同一份设置：用户选「文件夹在前」是希望整棵树都这样，
 * 不是只对顶层生效。
 */
const STORAGE_KEY = "pi-desktop:files:sort";

function loadSort(): FileSortSetting {
  const raw = readStorage(STORAGE_KEY);
  if (!raw) return { ...FILE_SORT_DEFAULT };
  try {
    const parsed = JSON.parse(raw);
    return { mode: normalizeSortMode(parsed?.mode), direction: normalizeSortDirection(parsed?.direction) };
  } catch {
    return { ...FILE_SORT_DEFAULT };
  }
}

export const fileSort = reactive<FileSortSetting>(loadSort());

watch(
  fileSort,
  () => {
    writeStorage(STORAGE_KEY, JSON.stringify({ mode: fileSort.mode, direction: fileSort.direction }));
  },
  { deep: true },
);

export function applySort<T extends { name: string; kind: string; relative?: string; path?: string }>(entries: readonly T[]): T[] {
  return sortEntries(entries, fileSort);
}

export function setFileSort(next: FileSortSetting): void {
  if (sameSortSetting(fileSort, next)) return;
  fileSort.mode = normalizeSortMode(next.mode);
  fileSort.direction = normalizeSortDirection(next.direction);
}
