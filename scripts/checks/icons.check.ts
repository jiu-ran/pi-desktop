import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { icons } from "../../packages/ui/src/shared/icons.ts";

/**
 * 图标表检查（图标集：IBM Carbon，Apache-2.0）。
 *
 * 图标是生成出来的（`scripts/build-icons.mjs`），所以这里只守三件事：
 * 1. 表里的值都是能直接 `v-html` 的完整 SVG，靠 currentColor 跟随主题；
 * 2. 源码里引用的每个 `icons.xxx` 都真的存在（拼错时是静默空白，很难发现）；
 * 3. 同一字形不要挂太多名字，避免出现「长得一样点了效果不同」的图标。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = path.join(root, "packages", "ui", "src");

const names = Object.keys(icons);
assert.ok(names.length >= 40, `图标数量太少：${names.length}`);

for (const [name, markup] of Object.entries(icons)) {
  assert.match(markup, /^<svg class="pi-icon" viewBox="[\d\s.]+" width="\d+" height="\d+" fill="currentColor"/, `${name} 的 SVG 头不对：${markup.slice(0, 80)}`);
  assert.ok(markup.trim().endsWith("</svg>"), `${name} 的 SVG 没有闭合`);
  assert.equal((markup.match(/<svg/g) ?? []).length, 1, `${name} 里只能有一个 <svg>`);
  assert.ok(!/stroke="(?!none)/.test(markup), `${name} 不该自带 stroke（Carbon 用填充路径）`);
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(markup), `${name} 里出现了写死的颜色，会跟随不了主题`);
}

// 源码里引用的图标必须存在
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = await walk(sourceRoot);
/** `from "./icons.ts"` 这类导入会被正则误伤，按扩展名排掉 */
const FILE_WORDS = new Set(["ts", "js", "mjs", "vue", "css", "html"]);
const referenced = new Map<string, string[]>();
for (const file of files) {
  if (file.endsWith(path.join("shared", "icons.ts"))) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\bicons\.([A-Za-z]\w*)/g)) {
    const name = match[1]!;
    if (FILE_WORDS.has(name)) continue;
    const list = referenced.get(name) ?? [];
    list.push(path.relative(root, file));
    referenced.set(name, list);
  }
}

const missing = [...referenced.keys()].filter((name) => !(name in icons));
assert.deepEqual(missing, [], `源码里用了不存在的图标：${missing.join(", ")}`);

// 每个图标至少被引用一次（新加图标忘了用也是常见的漂移）
const unused = names.filter((name) => !referenced.has(name));
assert.deepEqual(unused, [], `图标表里有没被用到的图标：${unused.join(", ")}`);

// 同一字形不要挂太多名字（chat / message 是刻意复用）
const byBody = new Map<string, string[]>();
for (const [name, markup] of Object.entries(icons)) {
  const body = markup.replace(/^.*?aria-hidden="true">/, "");
  const list = byBody.get(body) ?? [];
  list.push(name);
  byBody.set(body, list);
}
for (const [body, group] of byBody) {
  if (group.length > 1) {
    assert.deepEqual(group.slice().sort(), ["chat", "message"], `这些图标字形完全一样：${group.join(", ")}`);
    void body;
  }
}

console.log(`icons OK Carbon 图标表 ${names.length} 个 / 源码引用 ${referenced.size} 个`);
