export interface DiffLine {
  type: "add" | "del" | "ctx" | "gap";
  num: string;
  text: string;
}

/**
 * 解析 Pi edit 工具在 details.diff 里返回的显示用 diff。
 * 行格式：`+NNN text` / `-NNN text` / ` NNN text` / `    ...`（省略段）。
 */
export function parseDiff(diff = ""): DiffLine[] {
  return String(diff).split("\n").map((raw): DiffLine => {
    const sign = raw[0];
    const body = raw.slice(1);
    if (body.trim() === "...") return { type: "gap", num: "", text: "" };
    const match = body.match(/^(\s*\d*)\s(.*)$/);
    return {
      type: sign === "+" ? "add" : sign === "-" ? "del" : "ctx",
      num: match ? match[1].trim() : "",
      text: match ? match[2] : body,
    };
  });
}

/** 把一个 edit/write 工具块转成可显示的 diff 行 */
export function blockDiff(block: Record<string, any>, limit = 400): DiffLine[] {
  if (block.details?.diff) return parseDiff(block.details.diff);
  if (block.name === "write") {
    return String(block.args?.content ?? "").split(/\r?\n/).slice(0, limit)
      .map((text, i): DiffLine => ({ type: "add", num: String(i + 1), text }));
  }
  const out: DiffLine[] = [];
  for (const edit of block.args?.edits ?? []) {
    for (const text of String(edit.oldText ?? "").split(/\r?\n/)) out.push({ type: "del", num: "", text });
    for (const text of String(edit.newText ?? "").split(/\r?\n/)) out.push({ type: "add", num: "", text });
    out.push({ type: "gap", num: "", text: "" });
  }
  if (out.at(-1)?.type === "gap") out.pop();
  return out;
}

export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += 1;
    else if (line.type === "del") removed += 1;
  }
  return { added, removed };
}

export interface UnifiedFileDiff {
  file: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** 解析标准 git unified diff 为按文件分组的 DiffLine[] */
export function parseUnifiedDiff(patch = ""): UnifiedFileDiff[] {
  const files: UnifiedFileDiff[] = [];
  let current: UnifiedFileDiff | null = null;
  let oldLine = 1;
  let newLine = 1;

  for (const raw of String(patch).split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = { file: m ? m[2] : raw.slice(11), added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (raw.startsWith("+++ b/")) {
      const name = raw.slice(6).trim();
      if (!current) {
        current = { file: name, added: 0, removed: 0, lines: [] };
        files.push(current);
      } else {
        current.file = name;
      }
      continue;
    }
    if (
      raw.startsWith("--- ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file ") ||
      raw.startsWith("deleted file ") ||
      raw.startsWith("similarity index ") ||
      raw.startsWith("rename ")
    ) {
      continue;
    }
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      if (!current) {
        current = { file: "变更", added: 0, removed: 0, lines: [] };
        files.push(current);
      }
      if (current.lines.length > 0) {
        current.lines.push({ type: "gap", num: "", text: "" });
      }
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+")) {
      current.lines.push({ type: "add", num: String(newLine++), text: raw.slice(1) });
      current.added += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ type: "del", num: String(oldLine++), text: raw.slice(1) });
      current.removed += 1;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ type: "ctx", num: String(newLine++), text: raw.slice(1) });
      oldLine += 1;
    }
  }
  return files;
}

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

/** 从工具块里汇总本任务改过的文件。纯函数，便于复用。 */
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
  return files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  );
}
