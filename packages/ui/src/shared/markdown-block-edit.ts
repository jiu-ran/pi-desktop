/**
 * 表格与围栏代码块的「就地编辑」辅助（纯函数）。
 *
 * Typora / Obsidian 点表格单元格、点代码块时**不会**把源码露出来，而是就地编辑
 * 渲染结果。要这么做就得能把「改某个单元格 / 改代码正文」翻译成对原文的最小替换，
 * 这块逻辑放在这里，可以脱离 DOM 直接测。
 */

export type TableAlign = "none" | "left" | "center" | "right";

export interface MarkdownTable {
  header: string[];
  aligns: TableAlign[];
  /** 数据行（不含表头与分隔行） */
  rows: string[][];
}

/** 拆一行表格：去掉首尾竖线，`\\|` 视为内容里的竖线（不切分） */
export function splitTableRow(line: string): string[] {
  const text = String(line ?? "").trim();
  const withoutEdges = text.replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return withoutEdges
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/** 单元格内容写回时要转义的竖线（`|` → `\|`），换行压成空格 */
export function escapeTableCell(value: string): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim()
    // 已经是 \| 的不要重复转义
    .replace(/(?<!\\)\|/g, "\\|");
}

function parseAlign(cell: string): TableAlign {
  const text = cell.trim();
  const left = text.startsWith(":");
  const right = text.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

function alignCell(align: TableAlign): string {
  if (align === "center") return ":---:";
  if (align === "left") return ":---";
  if (align === "right") return "---:";
  return "---";
}

/** 解析 GFM 表格；不是表格返回 null */
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = String(source ?? "").replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitTableRow(lines[0]!);
  const delimiter = splitTableRow(lines[1]!);
  if (!header.length || delimiter.length !== header.length) return null;
  if (!delimiter.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) return null;
  const aligns = delimiter.map(parseAlign);
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    // 行宽不足时补齐，避免渲染层拿到 undefined
    while (cells.length < header.length) cells.push("");
    return cells.slice(0, header.length);
  });
  return { header, aligns, rows };
}

/** 序列化回 markdown（列宽按内容对齐，肉眼可读） */
export function serializeMarkdownTable(table: MarkdownTable): string {
  const columns = table.header.length;
  const escape = (value: string): string => escapeTableCell(value);
  const all = [table.header.map(escape), ...table.rows.map((row) => Array.from({ length: columns }, (_, i) => escape(row[i] ?? "")))];
  const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...all.map((row) => (row[i] ?? "").length)));
  const renderRow = (cells: string[]): string =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i]!)).join(" | ")} |`.replace(/\s+\|$/, " |");
  const lines = [renderRow(all[0]!), `| ${table.aligns.map((align) => alignCell(align).padEnd(3)).join(" | ")} |`, ...all.slice(1).map(renderRow)];
  return lines.join("\n");
}

/**
 * 改某个单元格，返回新的表格源码。
 * `row` 用 -1 表示表头；越界或解析失败时原样返回。
 */
export function setTableCell(source: string, row: number, col: number, value: string): string {
  const table = parseMarkdownTable(source);
  if (!table) return source;
  if (col < 0 || col >= table.header.length) return source;
  if (row === -1) table.header[col] = value;
  else if (row >= 0 && row < table.rows.length) table.rows[row]![col] = value;
  else return source;
  return serializeMarkdownTable(table);
}

/** 追加一行（Tab 走到最后一行时用），返回 { source, row } */
export function appendTableRow(source: string): { source: string; row: number } {
  const table = parseMarkdownTable(source);
  if (!table) return { source, row: -1 };
  table.rows.push(Array.from({ length: table.header.length }, () => ""));
  return { source: serializeMarkdownTable(table), row: table.rows.length - 1 };
}

/** 围栏代码块拆成「围栏行 + 语言 + 正文」 */
export interface FenceParts {
  /** 起始围栏，例如 ``` 或 ```` */
  fence: string;
  /** 语言标识（可能为空） */
  lang: string;
  /** 正文（不含首尾围栏行） */
  body: string;
}

export function codeFenceParts(source: string): FenceParts {
  const lines = String(source ?? "").replace(/\r/g, "").split("\n");
  const first = lines[0] ?? "";
  const match = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(first);
  if (!match) return { fence: "```", lang: "", body: lines.join("\n") };
  const fence = match[1]!;
  const lang = match[2] ?? "";
  const rest = lines.slice(1);
  const last = rest[rest.length - 1] ?? "";
  if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(last)) rest.pop();
  return { fence, lang, body: rest.join("\n") };
}

/** 只替换围栏代码块的正文，围栏与语言标识原样保留 */
export function replaceCodeFenceBody(source: string, body: string): string {
  const parts = codeFenceParts(source);
  const text = String(body ?? "").replace(/\r/g, "").replace(/\n+$/, "");
  const open = `${parts.fence}${parts.lang}`;
  return `${open}\n${text ? `${text}\n` : ""}${parts.fence}`;
}
