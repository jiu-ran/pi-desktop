import { WidgetType } from "@codemirror/view";
import { codeFenceParts, parseMarkdownTable, replaceCodeFenceBody, serializeMarkdownTable } from "../../shared/markdown-block-edit.ts";
import { highlightCode } from "./markdown-highlight.ts";
import { mermaidRender } from "./markdown.ts";

/**
 * 文档里那些「必须整块渲染」的结构：代码块 / 表格 / 分割线 / mermaid。
 *
 * Typora / Obsidian 点这些块时**不会**把源码露出来（不显示 ``` 围栏、不显示 `| --- |`），
 * 而是就地改渲染结果。所以这里的 widget 自带编辑能力：
 * - 表格：每个单元格 contenteditable，Tab / Shift+Tab 换格，改完把整张表序列化写回；
 * - 代码块：正文 contenteditable，编辑时切成纯文本、失焦后重新高亮；
 * - 两者右上角都有「源码」按钮，需要手写围栏/对齐时再切回去。
 *
 * 关键点：doc 一变，CodeMirror 会重建装饰。要让输入焦点不丢，`eq()` 一律返回 true，
 * 让 CodeMirror 复用同一个 DOM，再用 `updateDOM` 决定要不要重绘（正在编辑就不重绘）。
 */

export interface LiveBlockHost {
  /** 把 [from, to) 这一块替换成新源码（由编辑器派发，保证撤销栈正确） */
  onEditBlock(from: number, to: number, next: string): void;
  /** 在当前块显示源码 / 回到渲染结果 */
  onToggleSource(from: number): void;
  /** 当前块是否处于「显示源码」状态 */
  isSourceMode(from: number): boolean;
}

/** 分割线（`---` 换成一条横线） */
export class RuleWidget extends WidgetType {
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

/** 小的「源码」开关（代码块 / 表格共用） */
function sourceToggle(host: LiveBlockHost, from: number, label = "源码"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-blocktool";
  button.textContent = label;
  button.title = "显示这段的 markdown 源码";
  // 别让点击冒泡到编辑器（否则会把光标塞进块里、又切回渲染态）
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    host.onToggleSource(from);
  });
  return button;
}

/** 源码态下贴在块前的「渲染」按钮：点一下回到渲染结果 */
export class SourceToggleWidget extends WidgetType {
  readonly from: number;
  readonly host: LiveBlockHost;
  constructor(from: number, host: LiveBlockHost) {
    super();
    this.from = from;
    this.host = host;
  }
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = "cm-md-sourcebar";
    box.appendChild(sourceToggle(this.host, this.from, "渲染"));
    // 默认可见：源码态没有别的入口能回去
    const button = box.firstElementChild as HTMLElement | null;
    if (button) button.style.opacity = "1";
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 代码块：渲染成带语言标签的代码面板，正文可以直接编辑 */
export class CodeWidget extends WidgetType {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly dark: boolean;
  readonly host: LiveBlockHost;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paintToken = 0;

  constructor(from: number, to: number, source: string, dark: boolean, host: LiveBlockHost) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.dark = dark;
    this.host = host;
  }

  eq(): boolean {
    // 始终复用同一个 DOM：编辑过程中重建节点会丢焦点与选中的文字
    return true;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-codeblock";
    (wrap as unknown as { __piCode: CodeWidget }).__piCode = this;
    this.paint(wrap);
    return wrap;
  }

  updateDOM(dom: HTMLElement): boolean {
    (dom as unknown as { __piCode: CodeWidget }).__piCode = this;
    if (isEditing(dom)) return true;
    this.paint(dom);
    return true;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private paint(dom: HTMLElement): void {
    const parts = codeFenceParts(this.source);
    dom.textContent = "";
    const bar = document.createElement("div");
    bar.className = "cm-md-codebar";
    const label = document.createElement("span");
    label.className = "cm-md-codelang";
    label.textContent = parts.lang || "代码";
    bar.appendChild(label);
    bar.appendChild(sourceToggle(this.host, this.from));
    dom.appendChild(bar);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = parts.body;
    code.spellcheck = false;
    code.contentEditable = "plaintext-only";
    code.dataset.editing = "0";
    code.addEventListener("focus", () => {
      code.dataset.editing = "1";
      code.textContent = parts.body;
    });
    code.addEventListener("input", () => this.scheduleSync(dom, code));
    code.addEventListener("blur", () => {
      code.dataset.editing = "0";
      this.paint(dom);
    });
    pre.appendChild(code);
    dom.appendChild(pre);

    // 高亮：先给纯文本，算好再填色，避免整块闪一下空白
    const token = ++this.paintToken;
    if (!parts.lang || parts.lang === "text") return;
    void highlightCode(parts.body, parts.lang, this.dark)
      .then((lines) => {
        if (token !== this.paintToken || !code.isConnected || code.dataset.editing === "1") return;
        code.textContent = "";
        lines.forEach((tokens, index) => {
          if (index > 0) code.appendChild(document.createTextNode("\n"));
          for (const item of tokens) {
            if (!item.color) {
              code.appendChild(document.createTextNode(item.content));
              continue;
            }
            const span = document.createElement("span");
            span.style.color = item.color;
            span.textContent = item.content;
            code.appendChild(span);
          }
        });
      })
      .catch(() => {
        /* 高亮失败保留纯文本 */
      });
  }

  private scheduleSync(dom: HTMLElement, code: HTMLElement): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const widget = (dom as unknown as { __piCode?: CodeWidget }).__piCode ?? this;
      widget.host.onEditBlock(widget.from, widget.to, replaceCodeFenceBody(widget.source, code.textContent ?? ""));
    }, 120);
  }
}

function isEditing(dom: HTMLElement): boolean {
  const active = document.activeElement;
  return Boolean(active && dom.contains(active) && (active as HTMLElement).isContentEditable);
}

/** 表格：渲染成真表格，单元格可以直接改 */
export class TableWidget extends WidgetType {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly host: LiveBlockHost;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(from: number, to: number, source: string, host: LiveBlockHost) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.host = host;
  }

  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-tablewrap";
    (wrap as unknown as { __piTable: TableWidget }).__piTable = this;
    this.paint(wrap);
    return wrap;
  }

  updateDOM(dom: HTMLElement): boolean {
    (dom as unknown as { __piTable: TableWidget }).__piTable = this;
    if (isEditing(dom)) return true;
    this.paint(dom);
    return true;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private paint(dom: HTMLElement): void {
    dom.textContent = "";
    const table = parseMarkdownTable(this.source);
    if (!table) {
      const pre = document.createElement("pre");
      pre.textContent = this.source;
      dom.appendChild(pre);
      return;
    }
    const tools = document.createElement("div");
    tools.className = "cm-md-tabletools";
    tools.appendChild(sourceToggle(this.host, this.from));
    dom.appendChild(tools);

    const el = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.header.forEach((cell, col) => {
      const th = document.createElement("th");
      this.fillCell(th, -1, col, cell);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    el.appendChild(head);
    const body = document.createElement("tbody");
    table.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      row.forEach((cell, col) => {
        const td = document.createElement("td");
        this.fillCell(td, index, col, cell);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    el.appendChild(body);
    dom.appendChild(el);
  }

  private fillCell(cell: HTMLElement, row: number, col: number, value: string): void {
    cell.contentEditable = "plaintext-only";
    cell.spellcheck = false;
    cell.textContent = value;
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    cell.addEventListener("input", () => this.scheduleSync(cell));
    cell.addEventListener("keydown", (event) => this.onCellKey(event, cell));
  }

  private onCellKey(event: KeyboardEvent, cell: HTMLElement): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cell.blur();
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      const wrap = cell.closest(".cm-md-tablewrap") as HTMLElement | null;
      const cells = wrap ? [...wrap.querySelectorAll<HTMLElement>("[contenteditable]")] : [];
      const index = cells.indexOf(cell);
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      if (next) next.focus();
      else cell.blur();
    }
  }

  /** 改单元格后把整张表写回：以 DOM 里的文字为准，避免和源码漂移 */
  private scheduleSync(cell: HTMLElement): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const wrap = cell.closest(".cm-md-tablewrap") as HTMLElement | null;
      const widget = (wrap as unknown as { __piTable?: TableWidget } | null)?.__piTable ?? this;
      if (!wrap) return;
      const table = parseMarkdownTable(widget.source);
      if (!table) return;
      for (const node of wrap.querySelectorAll<HTMLElement>("[data-row][data-col]")) {
        const row = Number(node.dataset.row);
        const col = Number(node.dataset.col);
        const value = node.textContent ?? "";
        if (row === -1) table.header[col] = value;
        else if (table.rows[row]) table.rows[row]![col] = value;
      }
      widget.host.onEditBlock(widget.from, widget.to, serializeMarkdownTable(table));
    }, 120);
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

/** mermaid 图：光标不在代码块里时直接渲染成图，右上角可以切回源码 */
export class MermaidWidget extends WidgetType {
  readonly code: string;
  readonly from: number;
  readonly host: LiveBlockHost;
  constructor(code: string, from: number, host: LiveBlockHost) {
    super();
    this.code = code;
    this.from = from;
    this.host = host;
  }
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-mermaid";
    (wrap as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    const tools = document.createElement("div");
    tools.className = "cm-md-tabletools";
    tools.appendChild(sourceToggle(this.host, this.from));
    wrap.appendChild(tools);
    const body = document.createElement("pre");
    body.className = "cm-md-mermaid-source";
    body.textContent = this.code;
    wrap.appendChild(body);
    void renderMermaid(this.code, wrap);
    return wrap;
  }
  updateDOM(dom: HTMLElement): boolean {
    (dom as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    return true;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 代码块正文（去掉首尾围栏行） */
export function codeBody(source: string): string {
  return codeFenceParts(source).body;
}

/** mermaid 是否启用（禁用时按普通代码块渲染） */
export function mermaidEnabled(): boolean {
  return mermaidRender.enabled;
}
