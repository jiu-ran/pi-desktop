/**
 * 把 markdown 源码切成「顶层块」，用于 Typora 式的「预览里点一行就地编辑」。
 *
 * 关键约束：切出来的块数量必须和渲染器给出的顶层节点数量一致
 * （markstream 每渲染一个顶层节点就输出一个 `.node-slot`）。
 * 对齐不上就退化成纯预览，绝不让用户点到错位的行。
 *
 * 处理这些容易切歪的情况：
 * - 围栏代码块里的空行不能当块分隔；
 * - setext 标题（下一行是 === / ---）属于上一个块；
 * - 列表/引用中间的单个空行不算新块（loose list、多段引用）；
 * - 链接引用定义（`[标签]: url`）渲染出来是**空**的，单独一种 kind，对齐时跳过；
 * - 不特殊对待 YAML front matter：markstream 不支持，`---` 会渲染成分割线，
 *   这里也照同样规则切（否则文档一开头就错位）。
 */

export type MarkdownBlockKind =
  | "linkref"
  | "heading"
  | "code"
  | "table"
  | "list"
  | "quote"
  | "hr"
  | "paragraph";

export interface MarkdownBlock {
  /** 在原文里的起始偏移（含） */
  start: number;
  /** 结束偏移（不含） */
  end: number;
  /** 块内原文（保持原始换行） */
  text: string;
  kind: MarkdownBlockKind;
}

const LIST_MARKER = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}\s+/;
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]{3,}\|?\s*$/;
/** 链接引用定义：`[标签]: url "标题"`（脚注 `[^1]: 内容` 不算） */
const LINK_REF = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*\S/;

/** 计算每一行的起止偏移 */
function lineSpans(source: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  let index = 0;
  while (index <= source.length) {
    let next = source.indexOf("\n", index);
    if (next < 0) next = source.length;
    const raw = source.slice(index, next);
    spans.push({ start: index, end: next, text: raw.replace(/\r$/, "") });
    if (next >= source.length) break;
    index = next + 1;
  }
  return spans;
}

function kindOf(lines: string[], _isFirst: boolean): MarkdownBlockKind {
  const first = lines[0] ?? "";
  if (LINK_REF.test(first)) return "linkref";
  if (FENCE.test(first)) return "code";
  if (HEADING.test(first)) return "heading";
  if (HR.test(first)) return "hr";
  if (LIST_MARKER.test(first)) return "list";
  if (/^\s{0,3}>/.test(first)) return "quote";
  if (lines.length >= 2 && first.includes("|") && TABLE_SEPARATOR.test(lines[1] ?? "")) return "table";
  return "paragraph";
}

/** 判断某一行是否「延续当前块」（用来处理 loose list / 多段引用） */
/** 有些块在渲染结果里不占节点（目前只有链接引用定义），对齐时要跳过。 */
export function rendersBlock(block: MarkdownBlock): boolean {
  return block.kind !== "linkref";
}

function continuesBlock(kind: MarkdownBlockKind, line: string): boolean {
  if (!line.trim()) return false;
  if (kind === "list") return LIST_MARKER.test(line) || /^\s{2,}\S/.test(line);
  if (kind === "quote") return /^\s{0,3}>/.test(line);
  if (kind === "table") return line.includes("|");
  return false;
}

/** 把源码切成顶层块；返回顺序与 markdown 顶层节点一致。 */
export function splitMarkdownBlocks(source: string): MarkdownBlock[] {
  const text = String(source ?? "");
  if (!text.trim()) return [];
  const spans = lineSpans(text);
  const blocks: MarkdownBlock[] = [];

  let index = 0;
  let isFirst = true;
  while (index < spans.length) {
    // 跳过块之间的空行
    if (!spans[index].text.trim()) {
      index += 1;
      continue;
    }
    const startLine = index;
    const first = spans[index].text;

    // 链接引用定义：连续的几条算一块，渲染结果里看不到它们
    if (LINK_REF.test(first)) {
      let end = index + 1;
      while (end < spans.length && LINK_REF.test(spans[end].text)) end += 1;
      blocks.push(makeBlock(spans, startLine, end, "linkref"));
      index = end;
      isFirst = false;
      continue;
    }

    // 围栏代码块：一直吃到同种围栏结束
    const fence = FENCE.exec(first);
    if (fence) {
      const marker = fence[1][0];
      let end = index + 1;
      while (end < spans.length) {
        const line = spans[end].text;
        if (new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).test(line)) {
          end += 1;
          break;
        }
        end += 1;
      }
      blocks.push(makeBlock(spans, startLine, end, "code"));
      index = end;
      isFirst = false;
      continue;
    }

    let kind = kindOf(spans.slice(index).map((s) => s.text), isFirst);
    let end = index + 1;

    if (kind === "hr") {
      // --- 紧跟段落时是 setext 标题的一部分，交给下面的逻辑
      blocks.push(makeBlock(spans, startLine, end, "hr"));
      index = end;
      isFirst = false;
      continue;
    }

    if (kind === "heading") {
      // ATX 标题只占一行
      blocks.push(makeBlock(spans, startLine, end, "heading"));
      index = end;
      isFirst = false;
      continue;
    }

    if (kind === "table") {
      end = index + 2;
      while (end < spans.length && spans[end].text.trim() && spans[end].text.includes("|")) end += 1;
      blocks.push(makeBlock(spans, startLine, end, "table"));
      index = end;
      isFirst = false;
      continue;
    }

    // 段落 / 列表 / 引用：吃到空行（列表与引用允许中间空行继续）
    while (end < spans.length) {
      const line = spans[end].text;
      if (!line.trim()) {
        // 空行后如果还是同一列表/引用的续行，就继续并入这个块
        let probe = end + 1;
        while (probe < spans.length && !spans[probe].text.trim()) probe += 1;
        if (probe < spans.length && continuesBlock(kind, spans[probe].text)) {
          end = probe;
          continue;
        }
        break;
      }
      if (kind === "paragraph") {
        // setext 标题：段落下一行是 === 或 ---
        if (/^\s{0,3}(?:={2,}|-{2,})\s*$/.test(line)) {
          end += 1;
          kind = "heading";
          break;
        }
        // 列表/标题/围栏/引用直接接在段落后面，说明上一段结束
        if (FENCE.test(line) || HEADING.test(line) || LIST_MARKER.test(line) || /^\s{0,3}>/.test(line)) break;
        end += 1;
        continue;
      }
      if (continuesBlock(kind, line)) {
        end += 1;
        continue;
      }
      // 列表后面跟标题/围栏/表格等，结束当前块
      break;
    }

    // 别把尾部的空行算进块里
    let trimmedEnd = end;
    while (trimmedEnd > startLine + 1 && !spans[trimmedEnd - 1].text.trim()) trimmedEnd -= 1;
    blocks.push(makeBlock(spans, startLine, trimmedEnd, kind));
    index = Math.max(end, startLine + 1);
    isFirst = false;
  }

  return blocks;
}

function makeBlock(
  spans: Array<{ start: number; end: number; text: string }>,
  from: number,
  to: number,
  kind: MarkdownBlockKind,
): MarkdownBlock {
  const start = spans[from].start;
  const end = spans[Math.max(from, to - 1)].end;
  return { start, end, text: spans.slice(from, to).map((span) => span.text).join("\n"), kind };
}

/**
 * 用新文本替换某个块，返回新的整篇源码（保留块外的内容）。
 *
 * 换行统一成文档本来的那种：块的边界可能正好落在 CRLF 的 \r 上，
 * 直接拼接会把那一处变成 LF，混排之后 diff 会很难看。
 */
export function replaceMarkdownBlock(source: string, block: MarkdownBlock, nextText: string): string {
  const text = String(source ?? "");
  if (!block) return text;
  const before = text.slice(0, block.start);
  const after = text.slice(block.end);
  const joined = `${before}${nextText}${after}`;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return eol === "\r\n" ? joined.replace(/\r?\n/g, "\r\n") : joined.replace(/\r\n/g, "\n");
}
