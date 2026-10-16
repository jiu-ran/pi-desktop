import { diagramBoxHeight, parseViewBox } from "../../packages/ui/src/plugins/markdown/mermaid-fit.ts";
import { fittedMermaidSize, getMermaidSvgSize } from "../../packages/ui/src/plugins/markdown/mermaid-normalize.ts";
import { buildMermaidInitDirective, injectMermaidTheme } from "../../packages/ui/src/plugins/markdown/mermaid-theme.ts";

const assert = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};

const size = (over: Partial<Parameters<typeof diagramBoxHeight>[0]> = {}) =>
  diagramBoxHeight({ viewWidth: 929, viewHeight: 181, renderedWidth: 182, maxHeight: 500, ...over });

// viewBox 允许负坐标，并同时接受空格与逗号分隔。
assert(JSON.stringify(parseViewBox("-50,-10 450 951")) === JSON.stringify({ width: 450, height: 951 }), "应正确解析带负坐标的 viewBox");
assert(parseViewBox("0 0 0 100") === null, "无效宽度不应产生尺寸");
assert(parseViewBox("not-a-viewbox") === null, "非法 viewBox 不应产生尺寸");

// 宽而扁的图：自然高度约 35px，应收到最小高度 120，而不是停在估算的 360
assert(size() === 120, `扁图应收到 120px，实际 ${size()}`);

// 高图：按宽高比算出中间值
assert(size({ viewWidth: 200, viewHeight: 400, renderedWidth: 100 }) === 200, "高图应按比例取高度");

// 超过最大高度时截断
assert(size({ viewWidth: 100, viewHeight: 900, renderedWidth: 100, maxHeight: 500 }) === 500, "应截断在最大高度");

// 尺寸不完整时不动高度
assert(size({ renderedWidth: 0 }) === null, "宽度为 0 时不应改高度");
assert(size({ viewHeight: 0 }) === null, "视图框无效时不应改高度");

// 归一化：从 svg 标签字符串读自然尺寸
assert(JSON.stringify(getMermaidSvgSize('<svg viewBox="0 0 800 1600" width="100%">')) === JSON.stringify({ width: 800, height: 1600 }), "应读出 viewBox 自然尺寸");
assert(getMermaidSvgSize("<svg><g></g></svg>") === null, "无 viewBox 应返回 null");
assert(getMermaidSvgSize("<svg viewBox=\"0 0 0 100\">") === null, "无效尺寸应返回 null");

// fit：只缩小不放大
const fit = fittedMermaidSize({ width: 800, height: 1600 }, 700);
assert(Math.abs(fit.fit - 0.875) < 1e-9 && Math.round(fit.width) === 700 && Math.round(fit.height) === 1400, `宽图应缩到容器宽，实际 ${JSON.stringify(fit)}`);
const narrow = fittedMermaidSize({ width: 400, height: 200 }, 700);
assert(narrow.fit === 1 && narrow.width === 400, "窄图不应放大");
const zero = fittedMermaidSize({ width: 800, height: 1600 }, 0);
assert(zero.fit === 1, "容器宽度无效时保持原尺寸");

// 主题指令：围栏首行注入，有 %%{ 开头的围栏不动
const themed = injectMermaidTheme("前言\n```mermaid\ngraph TD\nA-->B\n```\n```mermaid\n%%{title:x}%%\ngraph LR\n```\n", true);
assert(themed.includes('"theme":"base"'), "应注入 base 主题指令");
assert(themed.includes('"fontFamily"'), "应注入字体栈");
assert((themed.match(/%%\{init:/g) ?? []).length === 1, "已有指令的围栏不应重复注入");
const directive = buildMermaidInitDirective(false);
assert(directive.includes('"darkMode":false'), "浅色主题 darkMode 应为 false");
JSON.parse(directive.replace(/^%%\{init: /, "").replace(/\}%%$/, ""));

console.log("mermaid-fit OK");
