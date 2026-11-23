import { WidgetType } from "@codemirror/view";
import { renderInlineMarkdown } from "../../shared/inline-markdown.ts";
import { codeFenceParts, parseMarkdownTable, replaceCodeFenceBody, serializeMarkdownTable } from "../../shared/markdown-block-edit.ts";
import { highlightCode, type HighlightToken } from "./markdown-highlight.ts";
import { appSettings } from "../../services/settings.ts";
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
    const line = document.createElement("div");
    line.className = "cm-md-ruleline";
    node.appendChild(line);
    return node;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 小的「源码」开关（代码块 / 表格 / 图表共用） */
function sourceToggle(host: LiveBlockHost, from: number | (() => number)): HTMLButtonElement {
  const initialFrom = typeof from === "function" ? from() : from;
  const open = host.isSourceMode(initialFrom);
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
    host.onToggleSource(typeof from === "function" ? from() : from);
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

/** 读取代码块里的纯文本（把浏览器偶发插入的末尾 <br> 也当作换行） */
function readCodeText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node instanceof HTMLBRElement) {
      out += "\n";
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

/** 读取 `root` 内当前选区相对于纯文本的 [anchor, focus] 字符偏移 */
function getCodeSelectionOffsets(root: HTMLElement): { anchor: number; focus: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  let total = 0;
  let anchor: number | null = null;
  let focus: number | null = null;
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.nodeValue ?? "").length;
      if (node === sel.anchorNode) anchor = total + Math.min(sel.anchorOffset, len);
      if (node === sel.focusNode) focus = total + Math.min(sel.focusOffset, len);
      total += len;
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (node === sel.anchorNode) anchor = total;
      if (node === sel.focusNode) focus = total;
      total += 1;
      return;
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      if (node === sel.anchorNode && sel.anchorOffset === i) anchor = total;
      if (node === sel.focusNode && sel.focusOffset === i) focus = total;
      walk(children[i]!);
    }
    if (node === sel.anchorNode && sel.anchorOffset >= children.length) anchor = total;
    if (node === sel.focusNode && sel.focusOffset >= children.length) focus = total;
  };
  walk(root);
  if (anchor === null || focus === null) return null;
  return { anchor, focus };
}

/** 根据纯文本字符偏移在重新渲染的高亮 DOM 上恢复光标/选区 */
function setCodeSelectionOffsets(root: HTMLElement, anchorOffset: number, focusOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const resolve = (target: number): { node: Node; offset: number } => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let passed = 0;
    let last: Text | null = null;
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const len = (text.nodeValue ?? "").length;
      last = text;
      if (passed + len >= target) {
        return { node: text, offset: Math.max(0, target - passed) };
      }
      passed += len;
    }
    if (last) return { node: last, offset: (last.nodeValue ?? "").length };
    return { node: root, offset: 0 };
  };
  const anchor = resolve(anchorOffset);
  const focus = resolve(focusOffset);
  sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

/** 把 Shiki 分词结果填入 `code`（保留已有光标/选区） */
function applyHighlightedTokens(code: HTMLElement, lines: HighlightToken[][]): void {
  const restore = document.activeElement === code ? getCodeSelectionOffsets(code) : null;
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
  if (restore) setCodeSelectionOffsets(code, restore.anchor, restore.focus);
}

interface CodeDomState {
  widget: CodeWidget;
  timer: ReturnType<typeof setTimeout> | null;
  highlightTimer: ReturnType<typeof setTimeout> | null;
  paintToken: number;
  composing: boolean;
}

type CodeDomElement = HTMLElement & { __piCodeState?: CodeDomState };

/** 代码块：渲染成带语言标签的代码面板，正文可以直接编辑 */
export class CodeWidget extends WidgetType {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly dark: boolean;
  readonly host: LiveBlockHost;
  /** 构造时「源码面板」是否打开：eq 据此判断要不要重建 DOM */
  readonly paneOpen: boolean;

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
    const slot = document.createElement("div") as CodeDomElement;
    // 外层只用 padding 撑间距，绝不用 margin：CodeMirror 测块高度不计 margin，
    // 用 margin 会让后面所有行坐标逐步向下漂移，点某行会落到下一行、上下键也会跳行。
    slot.className = "cm-md-blockslot cm-md-codeslot";
    slot.__piCodeState = {
      widget: this,
      timer: null,
      highlightTimer: null,
      paintToken: 0,
      composing: false,
    };
    this.paint(slot);
    return slot;
  }

  updateDOM(dom: HTMLElement): boolean {
    const wrap = dom as CodeDomElement;
    // 面板开关变了交给 CodeMirror 重建 DOM（返回 false = 我没法原地更新）：
    // 原地重绘容易和「正在编辑」的旧节点打架，直接重建最稳。
    if (wrap.dataset.sourcePane !== (this.paneOpen ? "1" : "0")) return false;
    const state = this.stateOf(wrap);
    state.widget = this;
    if (isEditing(wrap)) return true;
    // 内容、主题与源码开关都没变时（只是文档别处编辑或光标移动）不重绘，避免整块闪烁
    if (wrap.dataset.renderedSource === this.source && wrap.dataset.renderedDark === (this.dark ? "1" : "0")) {
      return true;
    }
    this.paint(wrap);
    return true;
  }

  destroy(dom: HTMLElement): void {
    const state = (dom as CodeDomElement).__piCodeState;
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.highlightTimer) clearTimeout(state.highlightTimer);
    state.highlightTimer = null;
  }

  private stateOf(dom: HTMLElement): CodeDomState {
    const wrap = dom as CodeDomElement;
    wrap.__piCodeState ??= {
      widget: this,
      timer: null,
      highlightTimer: null,
      paintToken: 0,
      composing: false,
    };
    return wrap.__piCodeState;
  }

  private paint(slot: HTMLElement): void {
    const state = this.stateOf(slot);
    const parts = codeFenceParts(this.source);
    const showSource = this.paneOpen;
    slot.dataset.sourcePane = showSource ? "1" : "0";
    slot.dataset.renderedSource = this.source;
    slot.dataset.renderedDark = this.dark ? "1" : "0";
    slot.textContent = "";
    const dom = document.createElement("div");
    dom.className = "cm-md-codeblock";
    slot.appendChild(dom);
    // 复制的是当前可见的正文（编辑中的临时纯文本也算），读不到时退回 widget 里的源码
    const readCode = (): string => {
      const el = dom.querySelector("code");
      return el ? readCodeText(el) : codeFenceParts(state.widget.source).body;
    };
    dom.appendChild(blockHead(parts.lang || "代码", [
      copyButton(readCode),
      sourceToggle(this.host, () => state.widget.from),
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
      // 保持语法高亮的 <span> 不被清空：点击代码块只进入编辑态，不把代码洗成全白
      code.dataset.editing = "1";
    });
    code.addEventListener("compositionstart", () => {
      state.composing = true;
      if (state.highlightTimer) {
        clearTimeout(state.highlightTimer);
        state.highlightTimer = null;
      }
    });
    code.addEventListener("compositionend", () => {
      state.composing = false;
      this.scheduleSync(slot, code);
      this.scheduleHighlight(slot, code);
    });
    code.addEventListener("input", () => {
      this.scheduleSync(slot, code);
      if (!state.composing) this.scheduleHighlight(slot, code);
    });
    code.addEventListener("blur", () => {
      if (code.dataset.editing !== "1") return;
      code.dataset.editing = "0";
      state.composing = false;
      if (state.timer) this.flushSync(slot, code);
      if (state.highlightTimer) {
        clearTimeout(state.highlightTimer);
        state.highlightTimer = null;
      }
      this.runHighlight(slot, code, readCodeText(code));
    });
    pre.appendChild(code);
    dom.appendChild(pre);

    // 源码面板：渲染结果保留在上面，源码贴在下面，两边同时可见
    if (showSource) {
      sourcePane(
        dom,
        this.source,
        (text) => state.widget.host.onEditBlock(state.widget.from, state.widget.to, text),
        () => state.widget.host.onToggleSource(state.widget.from),
      );
    }

    // 高亮：先给纯文本，算好再填色，避免整块闪一下空白
    this.runHighlight(slot, code, parts.body);
  }

  private runHighlight(dom: HTMLElement, code: HTMLElement, body: string): void {
    const state = this.stateOf(dom);
    const widget = state.widget;
    const lang = codeFenceParts(widget.source).lang;
    const token = ++state.paintToken;
    if (!lang || lang === "text") return;
    const dark = widget.dark;
    void highlightCode(body, lang, dark)
      .then((lines) => {
        if (token !== state.paintToken || !code.isConnected || state.composing) return;
        // 用户在异步高亮期间又输入了新内容：放弃这次过期结果，等最新一次重算
        if (readCodeText(code) !== body) return;
        applyHighlightedTokens(code, lines);
      })
      .catch(() => {
        /* 高亮失败保留纯文本 */
      });
  }

  private scheduleHighlight(dom: HTMLElement, code: HTMLElement): void {
    const state = this.stateOf(dom);
    if (state.highlightTimer) clearTimeout(state.highlightTimer);
    state.highlightTimer = setTimeout(() => {
      state.highlightTimer = null;
      if (state.composing || !code.isConnected) return;
      this.runHighlight(dom, code, readCodeText(code));
    }, 60);
  }

  private flushSync(dom: HTMLElement, code: HTMLElement): void {
    const state = this.stateOf(dom);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const widget = state.widget;
    const next = replaceCodeFenceBody(widget.source, readCodeText(code));
    dom.dataset.renderedSource = next;
    widget.host.onEditBlock(widget.from, widget.to, next);
  }

  private scheduleSync(dom: HTMLElement, code: HTMLElement): void {
    const state = this.stateOf(dom);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      const widget = state.widget;
      const next = replaceCodeFenceBody(widget.source, readCodeText(code));
      dom.dataset.renderedSource = next;
      widget.host.onEditBlock(widget.from, widget.to, next);
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
    if (dom.dataset.renderedSource === this.source) return true;
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
    dom.dataset.renderedSource = this.source;
    dom.textContent = "";
    const table = parseMarkdownTable(this.source);
    if (!table) {
      const pre = document.createElement("pre");
      pre.textContent = this.source;
      dom.appendChild(pre);
      return;
    }
    const widgetOf = (): TableWidget => (dom as unknown as { __piTable?: TableWidget }).__piTable ?? this;
    dom.appendChild(blockHead("表格", [copyButton(() => widgetOf().source), sourceToggle(this.host, () => widgetOf().from)]));

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
    cell.innerHTML = renderInlineMarkdown(value, {
      codeClass: "cm-md-inlinecode",
      allowRemoteImages: appSettings.autoLoadRemoteImages,
    });
    // 远程图片占位：点一下就地换成 <img>，并且不要进入「编辑源码」模式
    cell.addEventListener("click", (event) => this.onRemoteImageClick(event));
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
    const html = renderInlineMarkdown(raw, {
      codeClass: "cm-md-inlinecode",
      allowRemoteImages: appSettings.autoLoadRemoteImages,
    });
    if (cell.innerHTML !== html) cell.innerHTML = html;
  }

  /** 表格单元格里的「点击加载远程图片」：默认不加载，点了才换成真的图片。 */
  private onRemoteImageClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const placeholder = target.closest<HTMLElement>(".md-remote-image");
    if (!placeholder) return;
    const url = placeholder.dataset.remoteUrl ?? "";
    if (!url) return;
    event.preventDefault();
    if (/^http:\/\//i.test(url.trim())) {
      // CSP 只放行 https，明文 http 插进去只会是破图（见 index.html 的 img-src）
      placeholder.textContent = "明文 http 图片已阻止";
      placeholder.dataset.remoteBlocked = "http";
      delete placeholder.dataset.remoteUrl;
      return;
    }
    // 同一节点上还有「聚焦即编辑」的 click 监听，必须立刻停掉它，
    // 否则一点图片就切成源码，图片还没看见就没了。
    event.stopImmediatePropagation();
    const img = document.createElement("img");
    img.className = "md-cell-image";
    img.alt = placeholder.textContent ?? "";
    img.src = url;
    placeholder.replaceWith(img);
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
    const slot = document.createElement("div");
    slot.className = "cm-md-blockslot cm-md-mermaidslot";
    (slot as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    this.paint(slot);
    return slot;
  }
  updateDOM(dom: HTMLElement): boolean {
    (dom as unknown as { __piMermaid: MermaidWidget }).__piMermaid = this;
    if (dom.dataset.sourcePane !== (this.paneOpen ? "1" : "0")) return false;
    if (isEditing(dom)) return true;
    if (dom.dataset.renderedSource === this.source) return true;
    this.paint(dom);
    return true;
  }
  private paint(slot: HTMLElement): void {
    const showSource = this.paneOpen;
    slot.dataset.sourcePane = showSource ? "1" : "0";
    slot.dataset.renderedSource = this.source;
    slot.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "cm-md-mermaid";
    slot.appendChild(wrap);
    wrap.appendChild(blockHead("图表", [sourceToggle(this.host, () => ((slot as unknown as { __piMermaid?: MermaidWidget }).__piMermaid ?? this).from)]));
    const canvas = document.createElement("div");
    canvas.className = "cm-md-mermaid-canvas";
    wrap.appendChild(canvas);
    void renderMermaid(this.code(), canvas);
    if (showSource) {
      sourcePane(
        wrap,
        this.source,
        (text) => {
          const widget = (slot as unknown as { __piMermaid?: MermaidWidget }).__piMermaid ?? this;
          widget.host.onEditBlock(widget.from, widget.to, text);
        },
        () => {
          const widget = (slot as unknown as { __piMermaid?: MermaidWidget }).__piMermaid ?? this;
          widget.host.onToggleSource(widget.from);
        },
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
