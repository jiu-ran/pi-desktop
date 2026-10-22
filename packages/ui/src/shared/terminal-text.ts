/**
 * 终端输出的纯文本处理与安全 HTML 渲染。
 *
 * 宿主保留 ANSI 序列，渲染层只在这里解析 SGR（颜色/字重等）；其他 CSI / OSC
 * 控制序列（光标移动、窗口标题、超链接）一律丢弃，文本本身全部做 HTML 转义，
 * 因此可以用 `v-html` 渲染不可信的命令输出。
 */

const ANSI_OSC = "\\u001B\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)";
const ANSI_CSI = "\\u001B\\[[0-?]*[ -/]*[@-~]";
const ANSI_ESC = "\\u001B[@-_]";
const ANSI_PATTERN = new RegExp(`${ANSI_OSC}|${ANSI_CSI}|${ANSI_ESC}`, "g");
const ANSI_ESCAPE = new RegExp(`${ANSI_OSC}|${ANSI_CSI}|${ANSI_ESC}`, "g");
const SGR = new RegExp(`^\\u001B\\[([0-9;]*)m$`);
const OTHER_CONTROL = /[\u0000-\u0006\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;
const ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

export function stripTerminalAnsi(value: string): string {
  return String(value ?? "").replace(ANSI_ESCAPE, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[\u0007\u001B]/g, "").replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

/**
 * 把 `\r` 进度行折叠成最后一次输出，并处理退格。
 *
 * 真实终端在 `\r` 后覆盖当前行；这里选择保留最后一次完整内容，避免
 * `10%\r9%` 这类长度变化留下残影。换行仍按 `\n` 保留。
 * ANSI 序列不参与显示宽度，前序片段的转义会保留，以免颜色被截断。
 */
function collapseCarriageReturns(line: string): string {
  const parts = line.split("\r");
  let index = parts.length - 1;
  while (index >= 0 && parts[index] === "") index -= 1;
  if (index < 0) return "";
  let prefix = "";
  if (index > 0) {
    const matches = parts.slice(0, index).join("").match(ANSI_ESCAPE);
    prefix = matches ? matches.join("") : "";
  }
  return prefix + parts[index];
}

function applyBackspaces(line: string): string {
  let out = "";
  for (const char of line) {
    if (char === "\b") out = out.replace(/[\s\S]$/u, "");
    else out += char;
  }
  return out;
}

/** 规范化控制字符，保留 ANSI 供渲染使用；用于 `\r` 进度行和退格。 */
export function normalizeTerminalText(value: string): string {
  const lines = String(value ?? "").replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (line.includes("\r")) line = collapseCarriageReturns(line);
    if (line.includes("\b")) line = applyBackspaces(line);
    lines[index] = line;
  }
  return lines.join("\n").replace(OTHER_CONTROL, "");
}

/** 复制到剪贴板时使用的纯文本：去掉 ANSI、折叠进度行、清除控制字符。 */
export function terminalPlainText(value: string): string {
  return normalizeTerminalText(stripTerminalAnsi(value));
}

function hexByte(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
  return safe.toString(16).padStart(2, "0");
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

/** 0–15 使用主题变量，16–255 使用 xterm 256 色计算出的具体颜色。 */
function ansiColor(index: number): string {
  if (index >= 0 && index < 8) return `var(--ansi-${ANSI_NAMES[index]})`;
  if (index >= 8 && index < 16) return `var(--ansi-bright-${ANSI_NAMES[index - 8]})`;
  if (index >= 16 && index <= 231) {
    const value = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return rgbHex(
      levels[Math.floor(value / 36)],
      levels[Math.floor((value % 36) / 6)],
      levels[value % 6],
    );
  }
  if (index >= 232 && index <= 255) {
    const level = 8 + (index - 232) * 10;
    return rgbHex(level, level, level);
  }
  return "";
}

interface AnsiStyle {
  fg: string;
  bg: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  hidden: boolean;
  strike: boolean;
}

function emptyStyle(): AnsiStyle {
  return {
    fg: "",
    bg: "",
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    hidden: false,
    strike: false,
  };
}

function styleMarkup(style: AnsiStyle): { cls: string; css: string } {
  const classes: string[] = [];
  if (style.bold) classes.push("ansi-bold");
  if (style.dim) classes.push("ansi-dim");
  if (style.italic) classes.push("ansi-italic");
  if (style.underline) classes.push("ansi-underline");
  if (style.strike) classes.push("ansi-strike");
  if (style.hidden) classes.push("ansi-hidden");
  const declarations: string[] = [];
  let fg = style.fg;
  let bg = style.bg;
  if (style.inverse) {
    const nextFg = bg || "var(--term-bg)";
    const nextBg = fg || "var(--term-fg)";
    fg = nextFg;
    bg = nextBg;
  }
  if (fg) declarations.push(`color:${fg}`);
  if (bg) declarations.push(`background-color:${bg}`);
  return { cls: classes.join(" "), css: declarations.join(";") };
}

function applySgr(style: AnsiStyle, body: string): void {
  const params = (body === "" ? "0" : body).split(";").map((part) => {
    const value = Number(part);
    return Number.isFinite(value) ? value : 0;
  });
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (code === 0) {
      Object.assign(style, emptyStyle());
    } else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 7) style.inverse = true;
    else if (code === 8) style.hidden = true;
    else if (code === 9) style.strike = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code === 28) style.hidden = false;
    else if (code === 29) style.strike = false;
    else if (code === 39) style.fg = "";
    else if (code === 49) style.bg = "";
    else if (code >= 30 && code <= 37) style.fg = ansiColor(code - 30);
    else if (code >= 40 && code <= 47) style.bg = ansiColor(code - 40);
    else if (code >= 90 && code <= 97) style.fg = ansiColor(code - 90 + 8);
    else if (code >= 100 && code <= 107) style.bg = ansiColor(code - 100 + 8);
    else if (code === 38 || code === 48) {
      const mode = params[index + 1];
      if (mode === 5 && Number.isFinite(params[index + 2])) {
        const color = ansiColor(params[index + 2]);
        if (code === 38) style.fg = color;
        else style.bg = color;
        index += 2;
      } else if (mode === 2 && Number.isFinite(params[index + 2])) {
        const color = rgbHex(params[index + 2], params[index + 3], params[index + 4]);
        if (code === 38) style.fg = color;
        else style.bg = color;
        index += 4;
      }
    }
  }
}

/**
 * 将带 ANSI 序列的终端输出渲染成安全的 HTML。
 * 只生成 `span` 标签，颜色来自固定主题变量或计算出的十六进制值。
 */
export function renderTerminalHtml(value: string): string {
  const text = normalizeTerminalText(value);
  ANSI_PATTERN.lastIndex = 0;
  const style = emptyStyle();
  let html = "";
  let textBuffer = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  const flushText = (): void => {
    if (!textBuffer) return;
    const { cls, css } = styleMarkup(style);
    const attrs = `${cls ? ` class="${cls}"` : ""}${css ? ` style="${css}"` : ""}`;
    html += attrs ? `<span${attrs}>${escapeHtml(textBuffer)}</span>` : escapeHtml(textBuffer);
    textBuffer = "";
  };

  while ((match = ANSI_PATTERN.exec(text))) {
    textBuffer += text.slice(cursor, match.index);
    const sgr = SGR.exec(match[0]);
    if (sgr) {
      flushText();
      applySgr(style, sgr[1]);
    }
    cursor = match.index + match[0].length;
  }
  textBuffer += text.slice(cursor);
  flushText();
  return html;
}
