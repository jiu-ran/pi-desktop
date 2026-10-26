import { syntaxTree } from "@codemirror/language";
import { EditorView, Decoration, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { collectLiveSpans, type LiveSpan } from "./live-preview-rules.ts";
import { anchorOf, isAnchorLink, normalizeAnchor } from "../../shared/relative-path.ts";
import { CodeWidget, MermaidWidget, RuleWidget, TableWidget, codeBody, mermaidEnabled, type LiveBlockHost } from "./live-preview-blocks.ts";

/**
 * 把 markdown 源码渲染成「Typora / Obsidian 的实时预览」：
 * 光标不在的那一行只留排版结果，语法标记收起来；进了哪一行，哪一行的标记就露出来。
 *
 * 规则本身在 `live-preview-rules.ts`（纯函数），widget 在 `live-preview-blocks.ts`
 * （代码块 / 表格可就地编辑），这里只负责把它们接到 CodeMirror 上。
 */

export interface LivePreviewOptions {
  /** 把 markdown 里的图片地址解析成可直接放进 <img src> 的地址 */
  resolveImage?: (src: string) => Promise<string | null>;
  /** 打开外部链接（http / mailto / 工作区文件） */
  openLink?: (href: string) => void | Promise<void>;
  /** 当前是否是深色主题（代码高亮用） */
  isDark?: () => boolean;
}

/** 主题切换 / 切换源码态后要求重建装饰 */
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

function widgetFor(span: LiveSpan, from: number, to: number, text: string, options: LivePreviewOptions, host: LiveBlockHost): Decoration | null {
  if (span.block === "code") {
    const body = codeBody(text);
    if (span.lang === "mermaid" && mermaidEnabled()) return Decoration.replace({ widget: new MermaidWidget(from, to, text, host), block: true });
    return Decoration.replace({ widget: new CodeWidget(from, to, text, options.isDark?.() ?? true, host), block: true });
  }
  if (span.block === "table") return Decoration.replace({ widget: new TableWidget(from, to, text, host), block: true });
  if (span.block === "hr") return Decoration.replace({ widget: new RuleWidget(), block: true });
  if (span.widget === "bullet") return Decoration.replace({ widget: new BulletWidget() });
  if (span.widget === "image") return Decoration.replace({ widget: new ImageWidget(span.src, span.alt, options.resolveImage) });
  return null;
}

function buildDecorations(state: EditorState, options: LivePreviewOptions, host: LiveBlockHost): DecorationSet {
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
      const widget = widgetFor(span, span.from, span.to, doc.sliceString(span.from, span.to), options, host);
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
 *
 * 装饰放在 StateField 里：块级 widget（代码块 / 表格 / 分割线）只能由 state 提供，
 * ViewPlugin 里给块级替换会被 CodeMirror 直接拒绝。
 */
export function livePreview(options: LivePreviewOptions = {}) {
  let currentView: EditorView | null = null;
  /** 这些块被用户切成了「显示源码」：起始位置 → 结束位置（文档一改就清空，避免位置漂移） */
  const sourceMode = new Map<number, number>();

  const host: LiveBlockHost = {
    isSourceMode: (from) => sourceMode.has(from),
    onToggleSource: (from) => {
      if (sourceMode.has(from)) sourceMode.delete(from);
      else {
        const view = currentView;
        const line = view ? view.state.doc.lineAt(from) : null;
        // 记录块的结束位置：Esc 退出源码态要用它判断光标在不在块里
        sourceMode.set(from, line ? line.from + (view ? view.state.doc.lineAt(from).to - line.from : 0) : from);
        if (view) {
          // 结束位置取 syntaxTree 里这个块的 to；拿不到就退化成「文档末尾」
          const tree = syntaxTree(view.state);
          let end = view.state.doc.length;
          tree.iterate({
            enter: (node) => {
              if (node.from !== from) return undefined;
              if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table") end = node.to;
              return false;
            },
          });
          sourceMode.set(from, end);
        }
      }
      currentView?.dispatch({ effects: refreshLivePreview.of(null) });
    },
    onEditBlock: (from, to, next) => {
      const view = currentView;
      if (!view) return;
      const length = view.state.doc.length;
      const end = Math.min(to, length);
      if (view.state.doc.sliceString(from, end) === next) return;
      view.dispatch({ changes: { from, to: end, insert: next } });
    },
  };

  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, options, host),
    update: (decorations, transaction) => {
      // 源码面板里的编辑也会改动文档：把「显示源码」的位置跟着映射过去，
      // 否则改一个字面板就自己消失了（用户以为按钮坏了）。
      if (transaction.docChanged) {
        for (const [from, to] of [...sourceMode]) {
          sourceMode.delete(from);
          const nextFrom = transaction.changes.mapPos(from, -1);
          const nextTo = Math.max(nextFrom, transaction.changes.mapPos(to, 1));
          sourceMode.set(nextFrom, nextTo);
        }
      }
      const forced = transaction.effects.some((effect) => effect.is(refreshLivePreview));
      if (forced || transaction.docChanged || transaction.selection || syntaxTree(transaction.state) !== syntaxTree(transaction.startState)) {
        return buildDecorations(transaction.state, options, host);
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Ctrl / Cmd + 点击链接：外部链接交给宿主打开，文档内锚点直接滚过去
  const links = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      // widget（表格单元格等）里的链接在源码上搜不到，直接看点到的是不是 <a>
      const anchorEl = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (anchorEl && view.contentDOM.contains(anchorEl)) {
        event.preventDefault();
        const href = anchorEl.getAttribute("href") ?? "";
        if (!href) return false;
        if (isAnchorLink(href)) {
          if (!jumpToAnchor(view, href)) options.openLink?.(href);
          return true;
        }
        void options.openLink?.(href);
        return true;
      }
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

  // widget 里编辑时要拿到视图来派发变更（toDOM 拿不到 view）
  const tracker = EditorView.updateListener.of((update) => {
    currentView = update.view;
  });

  return [field, links, tracker];
}
