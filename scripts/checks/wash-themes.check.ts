import assert from "node:assert/strict";
import {
  DARK_WASH_THEMES,
  LIGHT_WASH_THEMES,
  normalizeDarkWashTheme,
  normalizeLightWashTheme,
  washBackground,
  washEntry,
  washGradient,
} from "../../packages/ui/src/shared/wash-themes.ts";
import { buildTheme } from "../../packages/ui/src/services/theme.ts";

/**
 * wash 主题检查：浅色 5 套 + 深色 5 套，独立色板、旧值迁移与完整变量产出。
 */
assert.equal(LIGHT_WASH_THEMES.length, 5, "浅色窗口应提供 5 套主题");
assert.equal(DARK_WASH_THEMES.length, 5, "深色窗口应提供 5 套主题");

assert.deepEqual(
  LIGHT_WASH_THEMES.map((item) => item.id),
  ["sakura", "sky", "matcha", "twilight", "alabaster"],
);
assert.deepEqual(
  LIGHT_WASH_THEMES.map((item) => item.label),
  ["云樱", "晴空", "青岚", "琉璃", "素雪"],
);
assert.deepEqual(
  DARK_WASH_THEMES.map((item) => item.id),
  ["midnight", "nebula", "abyss", "frost", "obsidian"],
);
assert.deepEqual(
  DARK_WASH_THEMES.map((item) => item.label),
  ["星夜", "星云", "极光", "霜夜", "曜石"],
);

const unique = (values: string[]) => new Set(values).size === values.length;
assert.ok(unique([...LIGHT_WASH_THEMES, ...DARK_WASH_THEMES].map((item) => item.id)), "主题 id 不能冲突");

for (const theme of [...LIGHT_WASH_THEMES, ...DARK_WASH_THEMES]) {
  const { palette } = theme;
  assert.ok(palette.stops.length >= 2, `${theme.label} 至少需要两个渐变停靠点`);
  for (const stop of palette.stops) {
    assert.match(stop, /^#[0-9a-f]{6}$/i, `${theme.label} 色值不合法：${stop}`);
  }
  assert.equal(palette.frame.toLowerCase(), palette.stops[0].toLowerCase(), `${theme.label} 的 frame 应取首站`);
  assert.match(theme.accent, /^#[0-9a-f]{6}$/i, `${theme.label} 代表色不合法`);
  assert.ok(palette.bg && palette.bg1 && palette.bg2 && palette.bg3, `${theme.label} 缺少表面色阶`);
  assert.ok(palette.glassBg && palette.glassBorder && palette.glassHighlight, `${theme.label} 缺少玻璃变量`);
}

// 归一化与旧主题 id 迁移
assert.equal(normalizeLightWashTheme("sky"), "sky");
assert.equal(normalizeLightWashTheme("petal"), "sakura");
assert.equal(normalizeLightWashTheme("nope"), "sakura");
assert.equal(normalizeLightWashTheme(undefined), "sakura");

assert.equal(normalizeDarkWashTheme("abyss"), "abyss");
assert.equal(normalizeDarkWashTheme("tide"), "abyss");
assert.equal(normalizeDarkWashTheme("mist"), "midnight");
assert.equal(normalizeDarkWashTheme("nope"), "midnight");
assert.equal(normalizeDarkWashTheme(undefined), "midnight");

assert.equal(washEntry("unknown", "light").id, "sakura");
assert.equal(washEntry("unknown", "dark").id, "midnight");

// 渐变与缩略图
assert.match(washGradient("sakura", "light"), /^linear-gradient\(165deg, /);
assert.ok(washBackground("midnight", "dark").endsWith(washGradient("midnight", "dark")));

// buildTheme：输出完整色板，深色主题不应再退化成中性死灰 #232328
const lightSky = buildTheme("light", "sky");
const darkMidnight = buildTheme("dark", "midnight");
assert.equal(lightSky.scheme, "light");
assert.equal(lightSky.wash, "sky");
assert.equal(lightSky.vars["--frame"], "#d6e6fd");
assert.equal(lightSky.vars["--bg"], "#fafcff");
assert.equal(darkMidnight.scheme, "dark");
assert.equal(darkMidnight.wash, "midnight");
assert.equal(darkMidnight.vars["--frame"], "#0a1122");
assert.equal(darkMidnight.vars["--bg"], "#121b33");
assert.equal(darkMidnight.vars["--fg"], "#eef3ff");
// wash 光晕必须叠三段：顶部镜面高光 + 两个对象光，否则深色窗口看起来是一块死平色
assert.equal(darkMidnight.vars["--wash-glow"].split("gradient(").length - 1, 3);

// 深色配色守门：正文 / 次要 / 三级文字的对比度，以及表面色阶的层次差
const luminance = (color: string): number => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const rgba = /rgba?(([^)]+))/.exec(color);
  const [r, g, b] = hex
    ? [1, 3, 5].map((i) => parseInt(hex[1]!.slice(i - 1, i + 1), 16))
    : rgba![1]!.split(",").slice(0, 3).map((part) => Number(part.trim()));
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
};
const contrast = (fg: string, bg: string): number => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
};

for (const theme of [...LIGHT_WASH_THEMES, ...DARK_WASH_THEMES]) {
  const { palette, label } = theme;
  assert.ok(contrast(palette.fg, palette.bg) >= 10, `${label} 正文对比度偏低`);
  assert.ok(contrast(palette.fg2, palette.bg1) >= 4.6, `${label} 次要文字对比度偏低`);
  assert.ok(contrast(palette.fg3, palette.bg2) >= 2.2, `${label} 三级文字对比度偏低`);
  // 表面色阶必须一级比一级亮（深色）/ 一级比一级暗（浅色），且相邻两档差得出来
  const steps = [palette.bg, palette.bg1, palette.bg2, palette.bg3];
  for (let index = 1; index < steps.length; index += 1) {
    const [prev, next] = [steps[index - 1]!, steps[index]!];
    const gap = contrast(prev, next);
    const rising = luminance(next) > luminance(prev);
    assert.equal(rising, theme.scheme === "dark", `${label} 的表面色阶方向不对：bg${index} → bg${index + 1}`);
    assert.ok(gap >= 1.05, `${label} 的表面色阶 bg${index} 与 bg${index + 1} 层次不清`);
  }
}
