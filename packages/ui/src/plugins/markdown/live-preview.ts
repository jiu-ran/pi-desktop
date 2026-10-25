import { syntaxTree } from "@codemirror/language";
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { collectLiveSpans, type LiveSpan } from "./live-preview-rules.ts";
import { mermaidRender } from "./markdown.ts";

/**
 * 把 markdown 源码渲染成「Typora / Obsidian 的实时预览」：
 * 光标不在的那一行只留排版结果，语法标记收起来；进了哪一行，哪一行的标记就露出来。
 *
 * 规则本身在 `live-preview-rules.ts`（纯函数），这里只负责翻译成 CodeMirror 装饰。
 */

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

/** 代码块：收起时直接给出等宽代码面板（和源码模式的观感一致） */
class CodeWidget extends WidgetType {
  readonly text: string;
  readonly language: string;
  constructor(text: string, language: string) {
    super();
    this.text = text;
    this.language = language;
  }
  eq(other: CodeWidget): boolean {
    return other.text === this.text && other.language === this.language;
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

/** 代码块正文（去掉首尾围栏行） */
function codeBody(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  if (/^\s*(?:`{3,}|~{3,})/.test(lines[0] ?? "")) lines.shift();
  if (/^\s*(?:`{3,}|~{3,})\s*$/.test(lines[lines.length - 1] ?? "")) lines.pop();
  return lines.join("\n");
}

function widgetFor(span: LiveSpan, text: string): Decoration | null {
  if (span.block === "code") {
    const body = codeBody(text);
    if (span.lang === "mermaid" && mermaidRender.enabled) {
      return Decoration.replace({ widget: new MermaidWidget(body), block: true });
    }
    return Decoration.replace({ widget: new CodeWidget(body, span.lang), block: true });
  }
  if (span.block === "table") return Decoration.replace({ widget: new TableWidget(text), block: true });
  if (span.block === "hr") return Decoration.replace({ widget: new RuleWidget(), block: true });
  if (span.widget === "bullet") return Decoration.replace({ widget: new BulletWidget() });
  return null;
}

/** mermaid 图：光标不在代码块里时直接渲染成图（和 markstream 的观感一致） */
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

function buildDecorations(state: EditorState): DecorationSet {
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
      const widget = widgetFor(span, doc.sliceString(span.from, span.to));
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

/**
 * 装饰放在 StateField 里：块级 widget（代码块 / 表格 / 分割线）只能由 state 提供，
 * ViewPlugin 里给块级替换会被 CodeMirror 直接拒绝。
 */
const livePreviewField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (decorations, transaction) => {
    if (transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)) {
      return buildDecorations(transaction.state);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 实时预览扩展 */
export function livePreview() {
  return livePreviewField;
}
