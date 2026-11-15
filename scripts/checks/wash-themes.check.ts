import assert from "node:assert/strict";
import {
  WASH_THEMES,
  normalizeWashTheme,
  washBackground,
  washGradient,
  washGlow,
  washTheme,
} from "../../packages/ui/src/shared/wash-themes.ts";
import { buildTheme } from "../../packages/ui/src/services/theme.ts";

/**
 * Kero wash 主题检查：10 套主题、浅深两套底、名称与缩略图渐变。
 *
 * 主题 id 会被写进 localStorage 与 settings 文件，改名 / 删主题要走迁移，
 * 所以这里把 id 和中文名都钉住。
 */
assert.equal(WASH_THEMES.length, 10, "应该有 10 套 wash 主题");
assert.deepEqual(
  WASH_THEMES.map((item) => item.id),
  ["petal", "mist", "meadow", "dusk", "tide", "apricot", "aurora", "dune", "paper", "plain"],
  "主题 id 和顺序不能随意改",
);
assert.deepEqual(
  WASH_THEMES.map((item) => item.label),
  ["花瓣", "薄雾", "草地", "黄昏", "潮汐", "杏子", "极光", "沙丘", "白纸", "纯色"],
  "主题名称要和设置页一致",
);

const unique = (values: string[]) => new Set(values).size === values.length;
assert.ok(unique(WASH_THEMES.map((item) => item.id)), "主题 id 不能重复");
assert.ok(unique(WASH_THEMES.map((item) => item.label)), "主题名称不能重复");

for (const theme of WASH_THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    const side = theme[scheme];
    assert.ok(side.stops.length >= 2, `${theme.label}/${scheme} 至少要两个渐变停靠点`);
    for (const stop of side.stops) {
      assert.match(stop, /^#[0-9a-f]{6}$/i, `${theme.label}/${scheme} 的色值不合法：${stop}`);
    }
    assert.match(side.frame, /^#[0-9a-f]{6}$/i, `${theme.label}/${scheme} 的 frame 不合法`);
    assert.equal(side.frame.toLowerCase(), side.stops[0].toLowerCase(), `${theme.label}/${scheme} 的 frame 应取第一站`);
    assert.match(theme.accent[scheme], /^(#[0-9a-f]{6}|oklch\(.+\))$/i, `${theme.label}/${scheme} 的强调色不合法`);
  }
}

// 归一化：旧设置没有字段 / 手改坏了都回花瓣
assert.equal(normalizeWashTheme("mist"), "mist");
assert.equal(normalizeWashTheme("petal"), "petal");
assert.equal(normalizeWashTheme("nope"), "petal");
assert.equal(normalizeWashTheme(undefined), "petal");
assert.equal(washTheme("nope").id, "petal", "未知主题回退到花瓣");

// 渐变与 Kero 的角度一致；缩略图先铺 glow 再铺 wash
assert.equal(washGradient("petal", "light"), "linear-gradient(172deg, #ebe0f3 0%, #f3e7f1 33%, #f7eee4 67%, #f6efcf 100%)");
assert.equal(washGradient("plain", "dark"), "linear-gradient(172deg, #141418 0%, #141418 100%)");
assert.match(washGlow("tide", "dark"), /^linear-gradient\(225deg, .+ 0%, transparent 50%\)$/);
assert.ok(washBackground("mist", "light").endsWith(washGradient("mist", "light")), "缩略图应把 glow 叠在渐变上");

// buildTheme：按当前明暗取对应的一套，并把 wash / frame / 用户气泡写进变量
const lightMist = buildTheme("light", "mist");
const darkTide = buildTheme("dark", "tide");
assert.equal(lightMist.scheme, "light");
assert.equal(lightMist.wash, "mist");
assert.equal(lightMist.vars["--frame"], "#e3e9f4");
assert.equal(lightMist.vars["--wash"], washGradient("mist", "light"));
assert.equal(darkTide.vars["--frame"], "#001b22");
assert.equal(darkTide.vars["--wash"], washGradient("tide", "dark"));
assert.match(lightMist.vars["--user-bg"], /^color-mix\(/);
assert.equal(lightMist.vars["--bg"], "#ffffff");
assert.equal(darkTide.vars["--bg"], "#232328");
