import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 命令面板 / 快速打开的样式守门。
 *
 * 这类「组件还在、样式没了」的事故已经发生过一次：设置面板重写时整段切掉了
 * components.css 末尾的通用 overlay 区块，把 `.palette input`、`.palette-item`
 * 和全部 `.quick-open-*` 一起带走了。界面不会报错，只是退回浏览器原生外观：
 * 深色主题下输入框是白底细边、按 20 字符截断占位文字，条目不换行也不高亮。
 *
 * 所以这里把「这几条规则必须存在，且关键声明不许丢」变成断言。
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const UI = path.join(ROOT, "packages/ui/src");

const css = readdirSync(path.join(UI, "styles"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(path.join(UI, "styles", name), "utf8"))
  .join("\n");

/** 取某个选择器的声明块（第一个匹配到的） */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return match ? match[1] : "";
}

function has(selector: string, declaration: string): boolean {
  return ruleBody(selector).replace(/\s+/g, " ").includes(declaration);
}

// 1. 输入行：不许露出浏览器原生输入框
assert.ok(ruleBody(".palette input"), "缺少 .palette input 规则：输入框会退回原生外观（白底细边）");
assert.ok(has(".palette input", "width: 100%"), ".palette input 必须占满宽度（否则按 20 字符截断占位文字）");
assert.ok(has(".palette input", "border: 0"), ".palette input 必须去掉原生边框");
assert.ok(has(".palette input", "outline: none"), ".palette input 必须去掉聚焦描边");
assert.ok(ruleBody(".palette input::placeholder"), "缺少占位文字颜色，深色主题下会偏亮");

// 2. 条目行：命令面板与快速打开共用的按钮外壳
assert.ok(ruleBody(".palette-item"), "缺少 .palette-item 规则：条目会变成没有内边距的原生按钮");
assert.ok(has(".palette-item", "display: flex"), ".palette-item 必须是 flex 行");

// 3. 快速打开自己的类名：模板里用到的都得有样式
//    只做「用了就要有」这一条，且限定在 quick-open 前缀上，避免把布局用的语义类误判。
/** 只是语义标记，视觉上完全交给 .palette-list */
const UNSTYLED = new Set(["quick-open-list"]);

const quickOpen = readFileSync(path.join(UI, "components/overlays/QuickOpen.vue"), "utf8");
const used = new Set<string>();
for (const [, value] of quickOpen.matchAll(/\bclass="([^"]+)"/g)) {
  for (const token of value.split(/\s+/)) {
    if (token.startsWith("quick-open")) used.add(token);
  }
}
assert.ok(used.size >= 6, `QuickOpen.vue 里应有多个 quick-open-* 类，实际识别到 ${used.size} 个`);

const missing = [...used].filter((token) => !UNSTYLED.has(token) && !css.includes(`.${token}`));
assert.deepEqual(missing, [], `这些类名在模板里用到但 CSS 里没有定义，界面会缺样式：\n${missing.map((name) => `  .${name}`).join("\n")}`);

// 4. 页脚与空状态的排布（没有它们时提示文字会紧贴列表、没有分隔线）
for (const selector of [".quick-open-state", ".quick-open-foot", ".quick-open-foot kbd"]) {
  assert.ok(ruleBody(selector), `缺少 ${selector} 规则`);
}

console.log(`palette-css OK 输入行 / 条目 / ${used.size} 个 quick-open 类都有样式`);
