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
