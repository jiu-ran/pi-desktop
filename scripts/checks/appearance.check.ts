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
  emphasisColor,
  normalizeEmphasisMode,
  normalizeHex,
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
  accentCustom: "#123456",
  emphasis: "follow",
  emphasisCustom: "#abcdef",
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
  emphasis: "follow",
  radius: "round",
  column: "wide",
  themeMode: "system",
});
const quiet = appearanceStyle({
  themeMode: "dark",
  accent: "default",
  accentCustom: "",
  emphasis: "follow",
  emphasisCustom: "",
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

// 自定义强调色：`accent: "custom"` 时用用户挑的颜色；非法值退回预设
{
  const custom = appearanceStyle({
    themeMode: "dark",
    accent: "custom",
    accentCustom: "#12ab34",
    emphasis: "follow",
    emphasisCustom: "",
    radius: "default",
    columnWidth: "default",
    reduceMotion: false,
    scheme: "dark",
  });
  assert.equal(custom.vars["--accent"], "#12ab34", "自定义强调色要直接生效");
  assert.equal(custom.vars["--emphasis"], "#12ab34", "跟随模式：对话强调色等于强调色");
  assert.match(custom.vars["--accent-soft"], /18, 171, 52, 0.18/, `自定义色也要推 soft：${custom.vars["--accent-soft"]}`);

  const broken = appearanceStyle({
    themeMode: "dark",
    accent: "custom",
    accentCustom: "not-a-color",
    emphasis: "custom",
    emphasisCustom: "also bad",
    radius: "default",
    columnWidth: "default",
    reduceMotion: false,
    scheme: "dark",
  });
  assert.equal(broken.vars["--accent"], "#2a7deb", "非法自定义色退回默认强调色");
  assert.equal(broken.vars["--emphasis"], "#2a7deb", "对话强调色也一起退回");

  // 对话强调色单独设置：两者互不影响
  const split = appearanceStyle({
    themeMode: "dark",
    accent: "violet",
    accentCustom: "",
    emphasis: "custom",
    emphasisCustom: "#ff8800",
    radius: "default",
    columnWidth: "default",
    reduceMotion: false,
    scheme: "dark",
  });
  assert.equal(split.vars["--accent"], "#8b5cf6", "界面强调色还是紫罗兰");
  assert.equal(split.vars["--emphasis"], "#ff8800", "对话强调色用单独挑的颜色");
  assert.equal(split.dataset.emphasis, "custom", "data 属性要标出独立设置");
}

// 取值归一化：只接受 #rrggbb，其余退回默认
assert.equal(normalizeHex("#AABBCC"), "#aabbcc", "大小写统一");
assert.equal(normalizeHex("red", "#000000"), "#000000", "非 #rrggbb 一律退回");
assert.equal(normalizeHex("", "#123456"), "#123456");
assert.equal(normalizeAccent("custom"), "custom", "自定义是合法取值");
assert.equal(normalizeAccent("rainbow"), "default", "未知名还是回默认");
assert.equal(normalizeEmphasisMode("custom"), "custom");
assert.equal(normalizeEmphasisMode("nope"), "follow");
assert.equal(emphasisColor("custom", "#00ff88", "violet", ""), "#00ff88", "单独设置时用自己的颜色");
assert.equal(emphasisColor("follow", "#00ff88", "violet", ""), "#8b5cf6", "跟随模式忽略自定义值");
assert.equal(emphasisColor("custom", "bad", "violet", ""), "#8b5cf6", "非法自定义值退回强调色");
assert.equal(emphasisColor("follow", "", "custom", "#101010"), "#101010", "跟随模式要跟随自定义强调色");

console.log("appearance.check 通过");
