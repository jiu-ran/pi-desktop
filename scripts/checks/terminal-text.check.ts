import {
  normalizeTerminalText,
  renderTerminalHtml,
  stripTerminalAnsi,
  terminalPlainText,
} from "../../packages/ui/src/shared/terminal-text.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(stripTerminalAnsi("\u001B[31m红色\u001B[0m \u001B]0;标题\u0007正常") === "红色 正常", "ANSI 清理错误");

assert(normalizeTerminalText("10%\r20%\r100%") === "100%", "进度行应只保留最后一次输出");
assert(normalizeTerminalText("a\rb\r") === "b", "结尾回车不应清空已有内容");
assert(normalizeTerminalText("foo\r") === "foo", "行尾回车不应丢失整行");
assert(normalizeTerminalText("abc\bX") === "abX", "退格处理错误");
assert(normalizeTerminalText("a\r\nb\r\n") === "a\nb\n", "CRLF 处理错误");
assert(normalizeTerminalText("\u001B[32m10%\r20%\u001B[0m") === "\u001B[32m20%\u001B[0m", "进度行应保留 ANSI 前缀");

const plain = terminalPlainText("\u001B[31m红色\u001B[0m\r\n\u001B[32m绿色\u001B[0m");
assert(plain === "红色\n绿色", `复制文本错误：${JSON.stringify(plain)}`);

const red = renderTerminalHtml("\u001B[31m红色\u001B[0m");
assert(red.includes(">红色</span>") && red.includes("color:var(--ansi-red)"), `红色渲染错误：${red}`);

const bold = renderTerminalHtml("\u001B[1;31m错误\u001B[22m普通");
assert(bold.includes("ansi-bold") && bold.includes("color:var(--ansi-red)"), `组合样式错误：${bold}`);
assert(bold.includes(">普通</span>") || bold.endsWith("普通"), `重置样式错误：${bold}`);

const color256 = renderTerminalHtml("\u001B[38;5;196mX\u001B[0m");
assert(color256.includes("color:#ff0000"), `256 色错误：${color256}`);

const trueColor = renderTerminalHtml("\u001B[38;2;18;52;86mX\u001B[0m");
assert(trueColor.includes("color:#123456"), `真彩色错误：${trueColor}`);

const background = renderTerminalHtml("\u001B[41mX\u001B[49m");
assert(background.includes("background-color:var(--ansi-red)"), `背景色错误：${background}`);

const inverse = renderTerminalHtml("\u001B[7mX\u001B[27m");
assert(inverse.includes("color:var(--term-bg)") && inverse.includes("background-color:var(--term-fg)"), `反色错误：${inverse}`);

const progress = renderTerminalHtml("\u001B[32m下载 10%\r下载 55%\u001B[0m");
assert(progress.includes("下载 55%") && !progress.includes("下载 10%"), `进度渲染错误：${progress}`);

const xss = renderTerminalHtml('<img src=x onerror="alert(1)">');
assert(!xss.includes("<img") && xss.includes("&lt;img"), `HTML 转义失败：${xss}`);

const osc = renderTerminalHtml("\u001B]8;;https://example.com\u0007链接\u001B]8;;\u0007");
assert(osc === "链接", `OSC 超链接应被丢弃：${JSON.stringify(osc)}`);

const newline = renderTerminalHtml("a\nb");
assert(newline === "a\nb", "换行应保留");

console.log("terminal-text OK");
