import { diagramBoxHeight, parseViewBox } from "../../packages/ui/src/plugins/markdown/mermaid-fit.ts";

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

console.log("mermaid-fit OK");
