import { WidgetType } from "@codemirror/view";
import { renderInlineMarkdown } from "../../shared/inline-markdown.ts";
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

/** 小的「源码」开关（代码块 / 表格 / 图表共用） */
function sourceToggle(host: LiveBlockHost, from: number): HTMLButtonElement {
  const open = host.isSourceMode(from);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-blocktool";
  button.dataset.action = "source";
  button.textContent = open ? "隐藏源码" : "源码";
  button.title = open ? "收起下面的源码，只看渲染结果" : "在渲染结果下面同时显示 markdown 源码";
  button.setAttribute("aria-pressed", open ? "true" : "false");
  // 别让点击冒泡到编辑器（否则会把光标塞进块里、又切回渲染态）
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    host.onToggleSource(from);
  });
  return button;
}

/**
 * 源码面板：和渲染结果同时显示，改源码立刻反映到上面的渲染。
 *
 * 这里**不再**把整块换成 CodeMirror 的原始行：那样渲染结果会消失，
 * 用户没法一边看结果一边改标记。面板内容是整块源码（含 ``` 围栏 / 表格竖线）。
 */
function sourcePane(dom: HTMLElement, source: string, onChange: (text: string) => void, onClose: () => void): HTMLElement {
  const pane = document.createElement("pre");
  pane.className = "cm-md-sourcepane";
  pane.spellcheck = false;
  pane.contentEditable = "plaintext-only";
  pane.textContent = source;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    onChange(pane.textContent ?? "");
  };
  pane.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange(pane.textContent ?? "");
    }, 160);
  });
  // 失焦前把最后一次输入派发出去（否则最后一个字可能没写回）
  pane.addEventListener("blur", () => {
    if (timer) flush();
  });
  pane.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (timer) flush();
    onClose();
  });
  dom.appendChild(pane);
  return pane;
}

/** 「复制」按钮：点一下把代码正文写进剪贴板，短暂显示「已复制」 */
function copyButton(read: () => string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-blocktool";
  button.dataset.action = "copy";
  button.textContent = "复制";
  button.title = "复制这段正文";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = (): void => {
    button.dataset.done = "0";
    button.textContent = "复制";
  };
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = read();
    void navigator.clipboard?.writeText(text).then(
      () => {
        button.dataset.done = "1";
        button.textContent = "已复制";
        if (timer) clearTimeout(timer);
        timer = setTimeout(reset, 1200);
      },
      () => {
        button.textContent = "复制失败";
        if (timer) clearTimeout(timer);
        timer = setTimeout(reset, 1500);
      },
    );
  });
  return button;
}

/**
 * 每个块统一的头部：左边是类型标签（js / 表格 / 图表 / 源码），右边是操作按钮。
 *
 * 以前这些按钮是绝对定位浮在块上的（表格的「源码」压在表头上、
 * 源码态的「渲染」另起一行），看起来乱。现在所有块都用同一条正常流的头部，
 * 永远不会盖住正文，位置也对得上。
 */
function blockHead(labelText: string, actions: HTMLElement[]): HTMLElement {
  const head = document.createElement("div");
  head.className = "cm-md-blockhead";
  const label = document.createElement("span");
  label.className = "cm-md-blocklabel";
  label.textContent = labelText;
  head.appendChild(label);
  if (actions.length) {
    const box = document.createElement("span");
    box.className = "cm-md-blockactions";
    for (const action of actions) box.appendChild(action);
    head.appendChild(box);
  }
  return head;
}

/** 代码块：渲染成带语言标签的代码面板，正文可以直接编辑 */
export class CodeWidget extends WidgetType {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly dark: boolean;
  readonly host: LiveBlockHost;
  /** 构造时「源码面板」是否打开：eq 据此判断要不要重建 DOM */
  readonly paneOpen: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paintToken = 0;

  constructor(from: number, to: number, source: string, dark: boolean, host: LiveBlockHost) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.dark = dark;
    this.host = host;
    this.paneOpen = host.isSourceMode(from);
  }

  eq(other: CodeWidget): boolean {
    // 面板开关变了必须重建（CodeMirror 认为 widget 相同时不会调 updateDOM）；
    // 其余情况一律复用同一个 DOM：编辑过程中重建节点会丢焦点与选中的文字
    return other.paneOpen === this.paneOpen;
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
    // 面板开关变了交给 CodeMirror 重建 DOM（返回 false = 我没法原地更新）：
    // 原地重绘容易和「正在编辑」的旧节点打架，直接重建最稳。
    if (dom.dataset.sourcePane !== (this.paneOpen ? "1" : "0")) return false;
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
    const showSource = this.paneOpen;
    dom.dataset.sourcePane = showSource ? "1" : "0";
    dom.textContent = "";
    // 复制的是当前可见的正文（编辑中的临时纯文本也算），读不到时退回 widget 里的源码
    const readCode = (): string => dom.querySelector("code")?.textContent ?? codeFenceParts(this.source).body;
    dom.appendChild(blockHead(parts.lang || "代码", [
      copyButton(readCode),
      sourceToggle(this.host, this.from),
    ]));

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = parts.body;
    code.spellcheck = false;
    // 源码面板打开时正文只读：两处同时可编辑会互相覆盖
    code.contentEditable = showSource ? "false" : "plaintext-only";
    code.dataset.editing = "0";
    code.addEventListener("focus", () => {
      if (code.contentEditable === "false") return;
      code.dataset.editing = "1";
      code.textContent = parts.body;
    });
    code.addEventListener("input", () => this.scheduleSync(dom, code));
    code.addEventListener("blur", () => {
      if (code.dataset.editing !== "1") return;
      code.dataset.editing = "0";
      this.paint(dom);
    });
    pre.appendChild(code);
    dom.appendChild(pre);

    // 源码面板：渲染结果保留在上面，源码贴在下面，两边同时可见
    if (showSource) {
      sourcePane(
        dom,
        this.source,
        (text) => this.host.onEditBlock(this.from, this.to, text),
        () => this.host.onToggleSource(this.from),
      );
    }

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
  /** 构造时「源码面板」是否打开：eq 据此判断要不要重建 DOM */
  readonly paneOpen: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(from: number, to: number, source: string, host: LiveBlockHost) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.host = host;
    this.paneOpen = host.isSourceMode(from);
  }

  eq(other: TableWidget): boolean {
    // 面板开关变了要重建；其余情况复用 DOM，避免丢输入焦点
    return other.paneOpen === this.paneOpen;
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
    // 同上：面板开关变了让 CodeMirror 重建，其余情况编辑中保持 DOM
    if (dom.dataset.sourcePane !== (this.paneOpen ? "1" : "0")) return false;
    if (isEditing(dom)) return true;
    this.paint(dom);
    return true;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private paint(dom: HTMLElement): void {
    const showSource = this.paneOpen;
    dom.dataset.sourcePane = showSource ? "1" : "0";
    dom.textContent = "";
    const table = parseMarkdownTable(this.source);
    if (!table) {
      const pre = document.createElement("pre");
      pre.textContent = this.source;
      dom.appendChild(pre);
      return;
    }
    dom.appendChild(blockHead("表格", [copyButton(() => this.source), sourceToggle(this.host, this.from)]));

    const scroller = document.createElement("div");
    scroller.className = "cm-md-tablescroll";
    const el = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    table.header.forEach((cell, col) => {
      const th = document.createElement("th");
      this.fillCell(th, -1, col, cell, !showSource);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    el.appendChild(head);
    const body = document.createElement("tbody");
    table.rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      row.forEach((cell, col) => {
        const td = document.createElement("td");
        this.fillCell(td, index, col, cell, !showSource);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    el.appendChild(body);
    scroller.appendChild(el);
    dom.appendChild(scroller);

    // 源码面板：表格在上面、源码在下面，同时可见
    if (showSource) {
      sourcePane(
        dom,
        this.source,
        (text) => this.host.onEditBlock(this.from, this.to, text),
        () => this.host.onToggleSource(this.from),
      );
    }
  }

  private fillCell(cell: HTMLElement, row: number, col: number, value: string, editable = true): void {
    // 源码面板打开时单元格只读：两处同时能改会互相覆盖
    if (editable) cell.contentEditable = "plaintext-only";
    else cell.contentEditable = "false";
    cell.spellcheck = false;
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    cell.dataset.raw = value;
    // "1" = 当前显示的是 markdown 源码（正在编辑），"0" = 显示渲染结果
    cell.dataset.source = "0";
    // 单元格里的 **加粗**、`代码`、[链接] 要显示成渲染结果，不能把标记原样露出来
    cell.innerHTML = renderInlineMarkdown(value, { codeClass: "cm-md-inlinecode" });
    if (!editable) return;
    cell.addEventListener("input", () => {
      // 编辑期间 DOM 是纯文本（plaintext-only），把用户敲的 markdown 记到 raw 上
      cell.dataset.raw = cell.textContent ?? "";
      this.scheduleSync(cell);
    });
    // 聚焦后补一次点击兜底：已经聚焦过的单元格再点不会有 focus 事件，
    // 那时内容已经是源码，showSource 是空操作（不会打乱光标）
    cell.addEventListener("click", () => this.showSource(cell));
    cell.addEventListener("focus", () => this.showSource(cell));
    cell.addEventListener("blur", () => this.showRendered(cell));
    cell.addEventListener("keydown", (event) => this.onCellKey(event, cell));
  }

  /** 聚焦时露出 markdown 源码：要改的是标记本身，不是加粗后的文字 */
  private showSource(cell: HTMLElement): void {
    const raw = cell.dataset.raw ?? "";
    cell.dataset.source = "1";
    if ((cell.textContent ?? "") !== raw) cell.textContent = raw;
  }

  /**
   * 失焦后重新渲染。
   *
   * 只有确实处于「源码态」时才把 DOM 文本写回 raw —— 否则（重绘后失焦、
   * 程序化 blur 等）会把渲染结果当成源码写回去，`**加粗**` 的标记就丢了。
   */
  private showRendered(cell: HTMLElement): void {
    if (cell.dataset.source === "1") cell.dataset.raw = cell.textContent ?? "";
    cell.dataset.source = "0";
    const raw = cell.dataset.raw ?? "";
    const html = renderInlineMarkdown(raw, { codeClass: "cm-md-inlinecode" });
    if (cell.innerHTML !== html) cell.innerHTML = html;
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
        // raw 是 markdown 源码；textContent 是渲染后的纯文本，不能用它写回
        const value = node.dataset.raw ?? node.textContent ?? "";
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
    // 只替换图表这块内容：widget 的头部与源码面板要留着
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
  readonly from: number;
  readonly to: number;
  /** 整块源码（含 ``` 围栏）：源码面板要原样显示/写回 */
  readonly source: string;
  readonly host: LiveBlockHost;
  readonly paneOpen: boolean;
  constructor(from: number, to: number, source: string, host: LiveBlockHost) {
    super();
    this.from = from;
    this.to = to;
    this.source = source;
    this.host = host;
    this.paneOpen = host.isSourceMode(from);
  }
  eq(other: MermaidWidget): boolean {
    // 面板开关变了要重建，其余复用（避免重新渲染图表）
    return other.paneOpen === this.paneOpen;
  }
  private code(): string {
    return codeFenceParts(this.source).body;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-mermaid";
    (wrap as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    this.paint(wrap);
    return wrap;
  }
  updateDOM(dom: HTMLElement): boolean {
    (dom as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    if (dom.dataset.sourcePane !== (this.paneOpen ? "1" : "0")) return false;
    if (isEditing(dom)) return true;
    this.paint(dom);
    return true;
  }
  private paint(wrap: HTMLElement): void {
    const showSource = this.paneOpen;
    wrap.dataset.sourcePane = showSource ? "1" : "0";
    wrap.textContent = "";
    wrap.appendChild(blockHead("图表", [sourceToggle(this.host, this.from)]));
    const canvas = document.createElement("div");
    canvas.className = "cm-md-mermaid-canvas";
    wrap.appendChild(canvas);
    void renderMermaid(this.code(), canvas);
    if (showSource) {
      sourcePane(
        wrap,
        this.source,
        (text) => this.host.onEditBlock(this.from, this.to, text),
        () => this.host.onToggleSource(this.from),
      );
    }
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
