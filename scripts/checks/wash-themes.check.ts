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
assert.equal(darkMidnight.vars["--frame"], "#090e1c");
assert.equal(darkMidnight.vars["--bg"], "#11192e");
assert.equal(darkMidnight.vars["--fg"], "#edf2ff");
