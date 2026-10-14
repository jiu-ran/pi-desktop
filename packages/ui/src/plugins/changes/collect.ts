import { blockDiff, diffStat, type DiffLine } from "../../shared/diff.ts";

export interface ChangeFileItem {
  path: string;
  name: string;
  dir: string;
  kind: string;
  added: number;
  removed: number;
  hunks: Array<{ id: string; lines: DiffLine[] }>;
  pending: boolean;
}

/** 从工具块里汇总本任务改过的文件。纯函数，便于测试。 */
export function collectChanges(blocks: any[] = []): ChangeFileItem[] {
  const files = new Map<string, ChangeFileItem>();
  for (const block of blocks) {
    if (block.kind !== "tool" || (block.name !== "edit" && block.name !== "write")) continue;
    const path = block.args?.path;
    if (!path || block.isError) continue;

    const lines = blockDiff(block);
    const { added, removed } = diffStat(lines);
    const prev = files.get(path);
    files.set(path, {
      path,
      name: path.split(/[\\/]/).at(-1) ?? path,
      dir: path.split(/[\\/]/).slice(0, -1).join("/"),
      kind: prev?.kind ?? (block.name === "write" ? "新增" : "修改"),
      added: (prev?.added ?? 0) + added,
      removed: (prev?.removed ?? 0) + removed,
      hunks: [...(prev?.hunks ?? []), { id: block.id, lines }],
      pending: block.status !== "done",
    });
  }
  return [...files.values()];
}

export function totals(files: ChangeFileItem[]): { added: number; removed: number } {
  return files.reduce((acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }), { added: 0, removed: 0 });
}
