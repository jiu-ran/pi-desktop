import { syntaxTree } from "@codemirror/language";
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { collectLiveSpans, type LiveSpan } from "./live-preview-rules.ts";
import { anchorOf, isAnchorLink, normalizeAnchor } from "../../shared/relative-path.ts";
import { mermaidRender } from "./markdown.ts";
import { highlightCode } from "./markdown-highlight.ts";

/**
 * 把 markdown 源码渲染成「Typora / Obsidian 的实时预览」：
 * 光标不在的那一行只留排版结果，语法标记收起来；进了哪一行，哪一行的标记就露出来。
 *
 * 规则本身在 `live-preview-rules.ts`（纯函数），这里只负责翻译成 CodeMirror 装饰，
 * 以及需要 DOM 的部分：代码块高亮、mermaid、图片、Ctrl+点击链接。
 */

export interface LivePreviewOptions {
  /** 把 markdown 里的图片地址解析成可直接放进 <img src> 的地址 */
  resolveImage?: (src: string) => Promise<string | null>;
  /** 打开外部链接（http / mailto / 工作区文件） */
  openLink?: (href: string) => void | Promise<void>;
  /** 当前是否是深色主题（代码高亮用） */
  isDark?: () => boolean;
}

/** 主题切换后要求重建装饰（代码高亮颜色跟着变） */
export const refreshLivePreview = StateEffect.define<null>();

/** 无序列表的项目符号（源码里的 `-` 换成圆点） */
class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-md-bullet";
    node.textContent = "•";
    return node;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 分割线（`---` 换成一条横线） */
class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const node = document.createElement("div");
    node.className = "cm-md-rule";
    return node;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 代码块：先给纯文本（不闪空白），高亮算好后再填色 */
class CodeWidget extends WidgetType {
  readonly text: string;
  readonly language: string;
  readonly dark: boolean;
  constructor(text: string, language: string, dark: boolean) {
    super();
    this.text = text;
    this.language = language;
    this.dark = dark;
  }
  eq(other: CodeWidget): boolean {
    return other.text === this.text && other.language === this.language && other.dark === this.dark;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-codeblock";
    if (this.language) {
      const label = document.createElement("span");
      label.className = "cm-md-codelang";
      label.textContent = this.language;
      wrap.appendChild(label);
    }
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.text;
    pre.appendChild(code);
    wrap.appendChild(pre);

    const language = this.language;
    if (language && language !== "text") {
      void highlightCode(this.text, language, this.dark)
        .then((lines) => {
          if (!code.isConnected) return;
          code.textContent = "";
          lines.forEach((tokens, index) => {
            if (index > 0) code.appendChild(document.createTextNode("\n"));
            for (const token of tokens) {
              if (!token.color) {
                code.appendChild(document.createTextNode(token.content));
                continue;
              }
              const span = document.createElement("span");
              span.style.color = token.color;
              span.textContent = token.content;
              code.appendChild(span);
            }
          });
        })
        .catch(() => {
          /* 高亮失败就保留纯文本 */
        });
    }
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 表格：收起时渲染成真正的表格 */
class TableWidget extends WidgetType {
  readonly source: string;
  constructor(source: string) {
    super();
    this.source = source;
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-tablewrap";
    const table = document.createElement("table");
    const rows = this.source
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parseRow = (line: string): string[] =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    const header = rows.length > 0 ? parseRow(rows[0]) : [];
    const body = rows.slice(2).map(parseRow);
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const cell of header) {
      const th = document.createElement("th");
      th.textContent = cell;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of body) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 图片：地址解析出来之前先占位，解析失败退回替代文字 */
class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  readonly resolve: LivePreviewOptions["resolveImage"];
  constructor(src: string, alt: string, resolve: LivePreviewOptions["resolveImage"]) {
    super();
    this.src = src;
    this.alt = alt;
    this.resolve = resolve;
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-imagewrap";
    wrap.dataset.state = "loading";
    const fallback = document.createElement("span");
    fallback.className = "cm-md-imgalt";
    fallback.textContent = this.alt || "图片";
    wrap.appendChild(fallback);
    const resolve = this.resolve;
    if (!resolve) {
      wrap.dataset.state = "error";
      return wrap;
    }
    void resolve(this.src)
      .then((url) => {
        if (!wrap.isConnected) return;
        if (!url) {
          wrap.dataset.state = "error";
          return;
        }
        const img = document.createElement("img");
        img.alt = this.alt;
        img.decoding = "async";
        img.src = url;
        img.addEventListener("load", () => {
          wrap.dataset.state = "ready";
        });
        img.addEventListener("error", () => {
          wrap.dataset.state = "error";
          img.remove();
        });
        wrap.appendChild(img);
      })
      .catch(() => {
        if (wrap.isConnected) wrap.dataset.state = "error";
      });
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** mermaid 图：光标不在代码块里时直接渲染成图 */
class MermaidWidget extends WidgetType {
  readonly code: string;
  constructor(code: string) {
    super();
    this.code = code;
  }
  eq(other: MermaidWidget): boolean {
    return other.code === this.code;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-mermaid";
    const body = document.createElement("pre");
    body.className = "cm-md-mermaid-source";
    body.textContent = this.code;
    wrap.appendChild(body);
    void renderMermaid(this.code, wrap);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

let mermaidSerial = 0;

/** 用应用统一的 mermaid 主题渲染；失败就把源码留着，不让整篇崩掉 */
async function renderMermaid(code: string, host: HTMLElement): Promise<void> {
  try {
    const [{ buildMermaidInitConfig }, mod] = await Promise.all([import("./mermaid-theme.ts"), import("mermaid")]);
    const mermaid = (mod as Record<string, any>).default ?? mod;
    const isDark = document.documentElement.dataset.theme !== "light";
    mermaid.initialize({ ...buildMermaidInitConfig(isDark), startOnLoad: false });
    const id = `cm-mermaid-${(mermaidSerial += 1)}`;
    const { svg } = await mermaid.render(id, code);
    if (!host.isConnected) return;
    host.innerHTML = svg;
    host.dataset.state = "ready";
  } catch (error) {
    if (!host.isConnected) return;
    host.dataset.state = "error";
    const tip = document.createElement("span");
    tip.className = "cm-md-mermaiderror";
    tip.textContent = `图表渲染失败：${error instanceof Error ? error.message : String(error)}`;
    host.prepend(tip);
  }
}

/** 代码块正文（去掉首尾围栏行） */
function codeBody(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  if (/^\s*(?:`{3,}|~{3,})/.test(lines[0] ?? "")) lines.shift();
  if (/^\s*(?:`{3,}|~{3,})\s*$/.test(lines[lines.length - 1] ?? "")) lines.pop();
  return lines.join("\n");
}

function widgetFor(span: LiveSpan, text: string, options: LivePreviewOptions): Decoration | null {
  if (span.block === "code") {
    const body = codeBody(text);
    if (span.lang === "mermaid" && mermaidRender.enabled) return Decoration.replace({ widget: new MermaidWidget(body), block: true });
    return Decoration.replace({ widget: new CodeWidget(body, span.lang, options.isDark?.() ?? true), block: true });
  }
  if (span.block === "table") return Decoration.replace({ widget: new TableWidget(text), block: true });
  if (span.block === "hr") return Decoration.replace({ widget: new RuleWidget(), block: true });
  if (span.widget === "bullet") return Decoration.replace({ widget: new BulletWidget() });
  if (span.widget === "image") return Decoration.replace({ widget: new ImageWidget(span.src, span.alt, options.resolveImage) });
  return null;
}

function buildDecorations(state: EditorState, options: LivePreviewOptions): DecorationSet {
  const ranges = state.selection.ranges;
  // 不整篇 toString：大文档里每次移动光标都复制一遍太浪费
  const doc = state.doc;
  const spans = collectLiveSpans(syntaxTree(state), {
    isActiveLine: (pos) => {
      const line = state.doc.lineAt(pos);
      return ranges.some((range) => range.from <= line.to && range.to >= line.from);
    },
    isActiveRange: (from, to) => ranges.some((range) => range.from <= to && range.to >= from),
    lineAt: (pos) => {
      const line = state.doc.lineAt(pos);
      return { from: line.from, to: line.to };
    },
    charAt: (pos) => (pos >= 0 && pos < doc.length ? doc.sliceString(pos, pos + 1) : ""),
    slice: (from, to) => doc.sliceString(from, to),
  });

  const decorations: Range<Decoration>[] = [];
  for (const span of spans) {
    if (span.block || span.widget) {
      const widget = widgetFor(span, doc.sliceString(span.from, span.to), options);
      if (widget) decorations.push(widget.range(span.from, span.to));
      continue;
    }
    if (span.line) {
      decorations.push(Decoration.line({ class: span.line }).range(span.from));
      continue;
    }
    if (span.hide) {
      if (span.to > span.from) decorations.push(Decoration.replace({}).range(span.from, span.to));
      continue;
    }
    if (span.cls && span.to > span.from) decorations.push(Decoration.mark({ class: span.cls }).range(span.from, span.to));
  }
  return Decoration.set(decorations, true);
}

/** 取 pos 处链接指向的地址（不在链接里返回空串） */
function linkAt(state: EditorState, pos: number): string {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name !== "Link") continue;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === "URL" && child.to > child.from) return state.doc.sliceString(child.from, child.to).trim();
    }
    return "";
  }
  return "";
}

/** 文档内锚点：滚到同名标题（忽略大小写、空格与标点） */
function jumpToAnchor(view: EditorView, href: string): boolean {
  const target = normalizeAnchor(anchorOf(href));
  if (!target) return false;
  const doc = view.state.doc;
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const text = line.text.replace(/^#{1,6}\s+/, "");
    if (normalizeAnchor(text) !== target) continue;
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
    return true;
  }
  return false;
}

/**
 * 实时预览扩展。
 * 装饰放在 StateField 里：块级 widget（代码块 / 表格 / 分割线）只能由 state 提供，
 * ViewPlugin 里给块级替换会被 CodeMirror 直接拒绝。
 */
export function livePreview(options: LivePreviewOptions = {}) {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, options),
    update: (decorations, transaction) => {
      const forced = transaction.effects.some((effect) => effect.is(refreshLivePreview));
      if (forced || transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)) {
        return buildDecorations(transaction.state, options);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Ctrl / Cmd + 点击链接：外部链接交给宿主打开，文档内锚点直接滚过去
  const links = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const href = linkAt(view.state, pos);
      if (!href) return false;
      event.preventDefault();
      if (isAnchorLink(href)) {
        if (!jumpToAnchor(view, href)) options.openLink?.(href);
        return true;
      }
      void options.openLink?.(href);
      return true;
    },
  });

  return [field, links];
}
