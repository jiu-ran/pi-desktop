import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * CSS 变量守门：用了但从来没定义的 `var(--x)` 是**静默失效**的一类 bug。
 *
 * 浏览器对 `var(--x)` 取不到值有两条路：
 * - 普通属性 → 该声明在计算值阶段变成 invalid，直接不生效（颜色退回继承/初始值）；
 * - 简写属性（`font: 12px var(--sans)`）→ 整条声明作废，字号和行高一起丢掉。
 * 两者都不报错、不提示，只能靠人工比对，所以这里把「用到的变量都有定义」变成一条断言。
 *
 * 判定规则（宁可漏报，不要误报）：
 * - `var(--x, 兜底)` 写了兜底的跳过；
 * - 定义可以来自 CSS 声明、内联 style 绑定（`'--x': …`）、`style.setProperty("--x")`。
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const UI = path.join(ROOT, "packages/ui/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|vue|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(UI);
const defined = new Set<string>();
/** 变量 → 第一次出现的位置（报错用） */
const used = new Map<string, string>();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");

  // 定义：CSS 声明 / 内联绑定 / setProperty
  // CSS 声明与内联绑定里的 `'--x': v` 都算定义（引号可有可无）
  for (const match of text.matchAll(/["']?(--[a-zA-Z0-9-]+)["']?\s*:/g)) defined.add(match[1]!);
  for (const match of text.matchAll(/setProperty\(\s*["'`](--[a-zA-Z0-9-]+)/g)) defined.add(match[1]!);

  // 使用：不给兜底的才算
  for (const match of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
    const name = match[1]!;
    if (!used.has(name)) used.set(name, rel);
  }
}

const missing = [...used].filter(([name]) => !defined.has(name));

// 先自检：这套扫描真的能找到「用了没定义」的情况，否则永远是绿的
{
  const probe = "a { color: var(--definitely-not-a-token); }";
  const found = [...probe.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)].map((m) => m[1]!);
  assert.deepEqual(found, ["--definitely-not-a-token"], "扫描规则要能识别无兜底的 var()");
  assert.equal(defined.has("--definitely-not-a-token"), false);
  // 带兜底的写法必须被忽略（否则 git.css 里那批可选覆盖变量会全部误报）
  const withFallback = "a { color: var(--git-group-label, red); }";
  assert.equal([...withFallback.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)].length, 0, "有兜底的不算未定义");
}

assert.deepEqual(
  missing.map(([name, at]) => `${name} (${at})`),
  [],
  `这些 CSS 变量从来没定义过，相关声明会静默失效：\n${missing.map(([name, at]) => `  ${name} @ ${at}`).join("\n")}`,
);

console.log(`css-tokens OK ${defined.size} 个变量已定义 / ${used.size} 处无兜底引用都对得上`);
