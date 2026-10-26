import assert from "node:assert/strict";
import {
  ACCENTS,
  COLUMN_WIDTHS,
  RADIUS_PRESETS,
  THEME_MODES,
  accentVars,
  appearanceStyle,
  columnWidthVars,
  normalizeAccent,
  normalizeColumnWidth,
  normalizeRadius,
  normalizeThemeMode,
  radiusVars,
  resolveScheme,
  dimmedColor,
  withAlpha,
} from "../../packages/ui/src/shared/appearance.ts";

// 取值归一化：非法值一律回默认，别把 "systemm" 这类拼写写进 <html>
assert.equal(normalizeThemeMode("system"), "system");
assert.equal(normalizeThemeMode("light"), "light");
assert.equal(normalizeThemeMode("dark"), "dark");
assert.equal(normalizeThemeMode("systemm"), "system");
assert.equal(normalizeThemeMode(undefined), "system");
assert.equal(normalizeAccent("violet"), "violet");
assert.equal(normalizeAccent("neon"), "default");
assert.equal(normalizeRadius("round"), "round");
assert.equal(normalizeRadius(7), "default");
assert.equal(normalizeColumnWidth("full"), "full");
assert.equal(normalizeColumnWidth("huge"), "default");

// 预设集合本身要自洽：id 唯一、颜色/尺寸都能解析
const unique = (list: string[]) => new Set(list).size === list.length;
assert.ok(unique(THEME_MODES.map((item) => item.id)), "主题模式 id 不能重复");
assert.ok(unique(ACCENTS.map((item) => item.id)), "强调色 id 不能重复");
assert.ok(unique(RADIUS_PRESETS.map((item) => item.id)), "圆角 id 不能重复");
assert.ok(unique(COLUMN_WIDTHS.map((item) => item.id)), "列宽 id 不能重复");
for (const accent of ACCENTS) {
  assert.match(accent.color, /^#[0-9a-f]{6}$/, `强调色 ${accent.id} 颜色格式不对：${accent.color}`);
}
for (const preset of RADIUS_PRESETS) {
  assert.ok(preset.radius > 0 && preset.small > 0, "圆角必须是正数");
  assert.ok(preset.radius >= preset.small, `圆角 ${preset.id} 的主圆角应不小于小圆角`);
}
for (const width of COLUMN_WIDTHS) {
  assert.match(width.max, /^(\d+px|100%)$/, `列宽 ${width.id} 取值不对：${width.max}`);
}

// dimmedColor：弹窗遮罩压暗（原生窗口按钮区要跟着遮罩一起变暗）
assert.equal(dimmedColor("#e9eaee"), "#808183", "浅色标题栏压暗 45% 后应接近遮罩后的灰");
assert.equal(dimmedColor("#000000"), "#000000", "纯黑压暗还是黑");
assert.equal(dimmedColor("#ffffff", 0), "#ffffff", "alpha 为 0 表示不压暗");
assert.equal(dimmedColor("#2a7deb", 0.45), dimmedColor("#2a7deb"), "默认 alpha 就是遮罩的 0.45");
assert.equal(dimmedColor("not-a-color"), "", "非法颜色返回空串，调用方保留原色");

// withAlpha：只接受 6 位十六进制
assert.equal(withAlpha("#2a7deb", 0.16), "rgba(42, 125, 235, 0.16)");
assert.equal(withAlpha("2a7deb", 0.5), "rgba(42, 125, 235, 0.5)");
assert.equal(withAlpha("#2a7d", 0.5), "");
assert.equal(withAlpha("rebeccapurple", 0.5), "");

// 强调色：深浅色下 soft 不同，主色一致
const darkAccent = accentVars("violet", "dark");
const lightAccent = accentVars("violet", "light");
assert.equal(darkAccent["--accent"], "#8b5cf6");
assert.equal(lightAccent["--accent"], "#8b5cf6");
assert.match(darkAccent["--accent-soft"], /0\.18\)$/);
assert.match(lightAccent["--accent-soft"], /0\.12\)$/);
assert.ok(darkAccent["--accent-soft"] !== lightAccent["--accent-soft"], "深浅色的淡底应不同");
assert.equal(accentVars("default", "dark")["--accent"], "#2a7deb", "默认强调色应保持原样");

// 圆角与列宽
assert.deepEqual(radiusVars("sharp"), { "--radius": "4px", "--radius-sm": "3px" });
assert.deepEqual(radiusVars("round"), { "--radius": "12px", "--radius-sm": "9px" });
assert.deepEqual(columnWidthVars("full"), { "--chat-column": "100%" });
assert.deepEqual(columnWidthVars("default"), { "--chat-column": "760px" });

// appearanceStyle：变量与 data 属性一次给全
const style = appearanceStyle({
  themeMode: "system",
  accent: "teal",
  radius: "round",
  columnWidth: "wide",
  reduceMotion: true,
  scheme: "dark",
});
assert.equal(style.vars["--accent"], "#0d9aa8");
assert.equal(style.vars["--radius"], "12px");
assert.equal(style.vars["--chat-column"], "980px");
assert.deepEqual(style.dataset, {
  motion: "off",
  accent: "teal",
  radius: "round",
  column: "wide",
  themeMode: "system",
});
const quiet = appearanceStyle({
  themeMode: "dark",
  accent: "default",
  radius: "default",
  columnWidth: "default",
  reduceMotion: false,
  scheme: "dark",
});
assert.equal(quiet.dataset.motion, "on");

// 主题模式解析
assert.equal(resolveScheme("dark", false), "dark");
assert.equal(resolveScheme("light", true), "light");
assert.equal(resolveScheme("system", true), "dark");
assert.equal(resolveScheme("system", false), "light");

console.log("appearance.check 通过");
