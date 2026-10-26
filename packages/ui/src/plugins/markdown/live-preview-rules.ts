import type { SyntaxNode } from "@lezer/common";
import type { Tree } from "@lezer/common";

/**
 * Typora / Obsidian 式「实时预览」的判定规则（纯函数，不碰 DOM，可在 node 里直接测）。
 *
 * 思路：拿到 markdown 语法树后，把「语法标记」和「要套样式的正文」分别标出来：
 * - 标记（`#`、`**`、`` ` ``、`[`、`>`、`-`…）只在光标所在的那一行显示，
 *   其它行收起来，于是看起来就是排版好的文档；
 * - 正文按结构套 CSS 类（标题字号、加粗、行内代码、链接…）；
 * - 代码块、表格、分割线这类必须整块渲染的，交给块级 widget 替换。
 *
 * 输出与编辑器无关的描述，`live-preview.ts` 再翻译成 CodeMirror 的装饰。
 */

export type LiveBlockRenderer = "" | "code" | "table" | "hr";
export type LiveWidget = "" | "bullet" | "image";

export interface LiveSpan {
  from: number;
  to: number;
  /** 收起这段源码（不显示标记本身） */
  hide: boolean;
  /** 套在这段内容上的 CSS 类（空格分隔） */
  cls: string;
  /** 套在整行上的 CSS 类（此时 from/to 是该行首尾） */
  line: string;
  /** 整块交给 widget 渲染（代码块 / 表格 / 分割线） */
  block: LiveBlockRenderer;
  /** 代码块的语言（决定渲染成 mermaid 图还是普通代码） */
  lang: string;
  /** 行内 widget（无序列表圆点 / 图片） */
  widget: LiveWidget;
  /** 图片地址（widget 为 image 时有效） */
  src: string;
  /** 图片替代文字 */
  alt: string;
}

export interface LiveRulesContext {
  /** 光标（或选区）是否落在 pos 所在的那一行 */
  isActiveLine(pos: number): boolean;
  /** 选区是否与 [from, to] 相交（代码块 / 表格用） */
  isActiveRange(from: number, to: number): boolean;
  /** pos 所在行的范围 */
  lineAt(pos: number): { from: number; to: number };
  /** 取某个位置的字符（为空串表示越界） */
  charAt(pos: number): string;
  /** 取一段原文（代码块语言用） */
  slice(from: number, to: number): string;
}

/** 这些节点的源码标记在非活动行上要收起来 */
const HIDDEN_MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "URL",
]);

/** 包在内容外面的标记节点：写样式时要避开它们 */
const WRAP_MARKS = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark", "URL"]);

const HEADING_LEVEL: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

function span(part: Partial<LiveSpan> & { from: number; to: number }): LiveSpan {
  return { hide: false, cls: "", line: "", block: "", widget: "", lang: "", src: "", alt: "", ...part };
}

/** 链接/图片指向的地址；没解析到地址时返回空串（[0.3.2] 这种引用要按普通文字显示） */
function targetUrl(node: SyntaxNode, ctx: LiveRulesContext): string {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL" && child.to > child.from) return ctx.slice(child.from, child.to).trim();
  }
  return "";
}

/** 图片的替代文字（![这里](src) 里的「这里」） */
function labelOf(node: SyntaxNode, ctx: LiveRulesContext): string {
  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (WRAP_MARKS.has(child.name)) {
      marks.push(child);
      if (marks.length === 2) return ctx.slice(marks[0].to, child.from).trim();
    }
  }
  return "";
}

/**
 * 去掉首尾包裹标记后的内容范围（给加粗/斜体/链接这类套样式用）。
 * 只取「非标记子节点」的首尾，避免样式范围和收起装饰重叠。
 */
function innerRange(node: SyntaxNode, name: string): { from: number; to: number } {
  const marks: SyntaxNode[] = [];
  const content: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (WRAP_MARKS.has(child.name)) marks.push(child);
    else content.push(child);
  }
  if (content.length > 0) return { from: content[0].from, to: content[content.length - 1].to };
  // 链接 / 图片：标签在开头标记和紧跟着的 `]` 之间
  if (name === "Link" || name === "Image") {
    if (marks.length >= 2) return { from: marks[0].to, to: marks[1].from };
    return { from: node.from, to: node.to };
  }
  // 强调 / 行内代码 / 删除线：内容不会解析成子节点，取首尾标记之间
  if (marks.length >= 2) return { from: marks[0].to, to: marks[marks.length - 1].from };
  return { from: node.from, to: node.to };
}

/** 标记后面紧跟的空格一并收起，避免行首留白 */
function widenOverSpace(ctx: LiveRulesContext, from: number, to: number): number {
  if (ctx.charAt(to) !== " ") return to;
  if (ctx.charAt(to + 1) === " ") return to + 2;
  return to + 1;
}

/**
 * 收集一整个语法树的装饰描述。
 * `isActiveLine` / `isActiveRange` 决定「光标在不在这里」，即标记是显示还是收起。
 */
export function collectLiveSpans(tree: Tree, ctx: LiveRulesContext): LiveSpan[] {
  const spans: LiveSpan[] = [];
  const parents: string[] = [];
  const seenLine = new Set<string>();

  /** 给 [from, to] 覆盖到的每一行加行级类 */
  const pushLines = (from: number, to: number, cls: string): void => {
    let pos = from;
    for (let guard = 0; guard < 4000; guard += 1) {
      const line = ctx.lineAt(pos);
      const key = `${line.from}:${cls}`;
      if (!seenLine.has(key)) {
        seenLine.add(key);
        spans.push(span({ from: line.from, to: line.from, line: cls }));
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  };

  tree.iterate({
    enter: (ref) => {
      const name = ref.name;
      const node = ref.node;
      const parent = parents[parents.length - 1] ?? "";
      parents.push(name);

      // ---- 整行样式：标题 / 引用 / 列表 / 任务 ----
      const level = HEADING_LEVEL[name];
      if (level) pushLines(ref.from, ref.to, `cm-md-h${level}`);
      if (name === "Blockquote") pushLines(ref.from, ref.to, "cm-md-quote");
      if (name === "BulletList" || name === "OrderedList") pushLines(ref.from, ref.to, "cm-md-listline");
      if (name === "Task") spans.push(span({ from: ref.from, to: ref.to, cls: "cm-md-tasklabel" }));

      // ---- 必须整块渲染的结构 ----
      if (name === "FencedCode" || name === "CodeBlock") {
        if (!ctx.isActiveRange(ref.from, ref.to)) {
          const fenceLine = ctx.slice(ref.from, ctx.lineAt(ref.from).to);
          const lang = /^\s*(?:`{3,}|~{3,})\s*(\S*)/.exec(fenceLine)?.[1] ?? "";
          spans.push(span({ from: ref.from, to: ref.to, block: "code", lang }));
        }
        else pushLines(ref.from, ref.to, "cm-md-coderaw");
        return false;
      }
      if (name === "Table") {
        if (!ctx.isActiveRange(ref.from, ref.to)) spans.push(span({ from: ref.from, to: ref.to, block: "table" }));
        else pushLines(ref.from, ref.to, "cm-md-tableraw");
        return false;
      }
      if (name === "HorizontalRule") {
        if (!ctx.isActiveLine(ref.from)) {
          const line = ctx.lineAt(ref.from);
          spans.push(span({ from: line.from, to: line.to, block: "hr" }));
          return false;
        }
        return undefined;
      }

      // ---- 行内内容样式（避开首尾标记，免得和收起装饰打架） ----
      const styled: Record<string, string> = {
        StrongEmphasis: "cm-md-strong",
        Emphasis: "cm-md-em",
        Strikethrough: "cm-md-strike",
        InlineCode: "cm-md-inlinecode",
        Link: "cm-md-link",
      };
      // 图片：光标不在这一行时直接显示图（地址为空的按普通文字处理）
      if (name === "Image") {
        const src = targetUrl(node, ctx);
        if (!src) return false;
        if (!ctx.isActiveLine(ref.from)) {
          spans.push(span({ from: ref.from, to: ref.to, widget: "image", src, alt: labelOf(node, ctx) }));
          return false;
        }
        const innerImage = innerRange(node, name);
        if (innerImage.to > innerImage.from) spans.push(span({ from: innerImage.from, to: innerImage.to, cls: "cm-md-image" }));
        return false;
      }
      // 没解析到地址的 [xxx] 是普通文字：既不变蓝、也不收方括号
      if (name === "Link" && !targetUrl(node, ctx)) return false;
      if (styled[name]) {
        const inner = innerRange(node, name);
        if (inner.to > inner.from) spans.push(span({ from: inner.from, to: inner.to, cls: styled[name] }));
      }

      // ---- 语法标记：光标不在这一行时收起 ----
      if (HIDDEN_MARKS.has(name)) {
        // 裸链接（自动链接）本身就是正文，不能当标记收起
        if (name === "URL" && parent !== "Link" && parent !== "Image") return undefined;
        // setext 标题的 === / --- 单独占一行，收起来会留下空行，改成变淡
        const setextUnderline = name === "HeaderMark" && parent.startsWith("SetextHeading");
        const ordered = name === "ListMark" && /\d/.test(ctx.charAt(ref.from));
        const active = ctx.isActiveLine(ref.from);

        if (name === "ListMark" && !ordered) {
          if (!active) spans.push(span({ from: ref.from, to: ref.to, widget: "bullet" }));
          else spans.push(span({ from: ref.from, to: ref.to, cls: "cm-md-mark" }));
          return undefined;
        }
        if (ordered || setextUnderline || active) {
          spans.push(span({ from: ref.from, to: ref.to, cls: "cm-md-mark" }));
          return undefined;
        }
        // 行首标记（#、>、-）后面的空格一并收起，避免行首留白；
        // 行内收尾标记后面的空格要留着，否则「粗体 斜体」会粘成一个词
        const leading = name === "HeaderMark" || name === "QuoteMark" || name === "ListMark";
        spans.push(span({ from: ref.from, to: leading ? widenOverSpace(ctx, ref.from, ref.to) : ref.to, hide: true }));
      }
      return undefined;
    },
    leave: () => {
      parents.pop();
    },
  });

  return spans;
}
