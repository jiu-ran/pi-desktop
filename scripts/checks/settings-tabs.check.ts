import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_TAB_IDS,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  findSettingsTab,
  searchSettings,
  sectionOfTab,
  sectionTabs,
} from "../../packages/ui/src/components/overlays/settings/settings-tabs.ts";
import { DEFAULT_SETTINGS, updateSettingsTab } from "../../packages/ui/src/services/settings.ts";

/**
 * 设置目录检查：分区 / 二级页 / 搜索。
 *
 * 目录是纯数据，拆出来后「新增一页要改哪几处」只剩一个文件，也因此值得单独测：
 * 漏登记、重复登记、分区指向不存在的页，都会在界面上表现为「点不到」或「空白页」。
 */

// ---- 1. 每个二级页只属于一个分区，且分区里的页都真的有定义 ----
const defined = new Set(SETTINGS_TABS.map((tab) => tab.id));
assert.equal(defined.size, SETTINGS_TABS.length, "二级页 id 不能重复");

for (const section of SETTINGS_SECTIONS) {
  assert.ok(section.tabs.length >= 1, `分区「${section.label}」至少要有一页`);
  for (const id of section.tabs) {
    assert.ok(defined.has(id), `分区「${section.label}」指向了不存在的页：${id}`);
  }
}

const ownership = new Map<string, string>();
for (const section of SETTINGS_SECTIONS) {
  for (const id of section.tabs) {
    assert.equal(ownership.get(id), undefined, `页「${id}」被登记到了两个分区`);
    ownership.set(id, section.id);
  }
}
assert.deepEqual(
  [...ownership.keys()].sort(),
  [...defined].sort(),
  `分区要覆盖全部二级页：${[...defined].filter((id) => !ownership.has(id)).join(", ")}`,
);
assert.deepEqual([...ALL_TAB_IDS].sort(), [...defined].sort(), "ALL_TAB_IDS 要和分区展开一致");

// ---- 2. 分区自身的字段 ----
for (const section of SETTINGS_SECTIONS) {
  assert.ok(section.label && section.desc && section.icon.includes("<svg"), `分区「${section.id}」缺少名称 / 说明 / 图标`);
}

// ---- 3. 每页都有标题、说明、图标与关键字 ----
for (const tab of SETTINGS_TABS) {
  assert.ok(tab.label.length >= 2, `页「${tab.id}」缺少名称`);
  assert.ok(tab.desc.length >= 8, `页「${tab.id}」的说明太短：${tab.desc}`);
  assert.ok(tab.icon.includes("<svg"), `页「${tab.id}」缺少图标`);
  // 关键字决定「搜设置项能不能搜到」：一页至少要举出几个用户会敲的词
  assert.ok(Array.isArray(tab.keywords) && tab.keywords.length >= 3, `页「${tab.id}」的关键字太少`);
  for (const word of tab.keywords) {
    assert.equal(typeof word, "string", `页「${tab.id}」的关键字必须是字符串`);
    assert.ok(word.length >= 1 && word.trim() === word, `页「${tab.id}」的关键字不能带空白：${JSON.stringify(word)}`);
  }
  assert.equal(new Set(tab.keywords).size, tab.keywords.length, `页「${tab.id}」的关键字有重复`);
}

// ---- 4. 查询 ----
assert.equal(findSettingsTab("logs").label, "运行日志", "按 id 找页");
assert.equal(findSettingsTab("nope" as any).id, SETTINGS_TABS[0]!.id, "找不到时退回第一页，界面不至于空白");
assert.equal(sectionOfTab("logs").id, "desktop", "运行日志属于「桌面」分区");
assert.equal(sectionOfTab("mcp").id, "power", "MCP 属于「扩展」分区");
// Pi CLI 与 Pi Desktop 是平级的一级分区（各自只有一页）
assert.equal(sectionOfTab("pi-cli").id, "pi-cli-section", "Pi CLI 自己是一个一级分区");
assert.equal(sectionOfTab("pi-desktop").id, "pi-desktop-section", "Pi Desktop 自己是一个一级分区");
assert.equal(findSettingsTab("pi-cli").label, "Pi CLI");
assert.equal(findSettingsTab("pi-desktop").label, "Pi Desktop");
assert.deepEqual(
  SETTINGS_SECTIONS.filter((section) => ["pi-cli-section", "pi-desktop-section"].includes(section.id)).map((section) => section.tabs.length),
  [1, 1],
  "两个 Pi 分区各自只放一页，不要塞别的",
);
assert.deepEqual(sectionTabs(SETTINGS_SECTIONS[0]!).map((tab) => tab.id), ["conversation", "agents"], "分区内的页保持登记顺序");

// 搜索：跨分区命中，并带上所属分区名
const logHits = searchSettings("日志");
assert.deepEqual(logHits.map((hit) => hit.id), ["logs"], `搜「日志」只应命中运行日志：${logHits.map((hit) => hit.id).join("/")}`);
assert.equal(logHits[0]!.sectionLabel, "系统", "命中结果要标出所属分区");

// 具体的设置项：旧的「只匹配页名/说明」搜不到这些
const darkHits = searchSettings("深色");
assert.equal(darkHits[0]?.id, "appearance", `搜「深色」应命中外观页：${darkHits.map((hit) => hit.id).join("/")}`);
assert.equal(darkHits[0]?.keyword, "深色", "命中关键字的结果要标出来，用户才知道为什么搜到这条");
const fontHits = searchSettings("字体");
assert.ok(fontHits.some((hit) => hit.id === "appearance"), "字号/字体属于外观页");
assert.ok(fontHits.some((hit) => hit.id === "terminal"), "终端也能调字体");
// 页名直接命中必须排在关键字命中前面
assert.equal(searchSettings("终端")[0]?.id, "terminal", "搜「终端」时终端页要排第一");
assert.deepEqual(searchSettings("zzzz"), [], "没有命中时返回空数组");
assert.ok(searchSettings("快捷键").some((hit) => hit.id === "environment"), "搜「快捷键」应能找到环境页");

const skillHits = searchSettings("SKILL");
assert.ok(skillHits.some((hit) => hit.id === "skills"), "搜索不区分大小写");
const bySection = searchSettings("扩展");
assert.ok(bySection.length >= 3, `按分区名搜索应命中该分区所有页，实际 ${bySection.length}`);
assert.ok(searchSettings("系统").some((hit) => hit.id === "logs"), "按分区名搜「系统」能命中运行日志");
assert.deepEqual(searchSettings("   "), [], "空查询不返回结果");

// ---- 5. 设置项字段与页面不脱节：至少这一页是「对话」相关的 ----
assert.ok("streamingMode" in DEFAULT_SETTINGS && "sendShortcut" in DEFAULT_SETTINGS, "对话页依赖的设置在默认值里都存在");


// ---- 6. 源码里打开设置页的调用必须指向存在的页 ----
// 之前标题栏的「有新版本」徽标传的是 'environment'（系统分区里的二级页），点一下跳到
// 环境与快捷键 —— 这类写错 id 的调用没有类型约束，只能扫源码兜住。
const uiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packages/ui/src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".vue")) out.push(full);
  }
  return out;
}
const misdirected: string[] = [];
for (const sourceFile of walk(uiRoot)) {
  const source = readFileSync(sourceFile, "utf8");
  for (const match of source.matchAll(/openSettingsModal\(\s*["']([\w-]+)["']/g)) {
    if (!ALL_TAB_IDS.includes(match[1] as (typeof ALL_TAB_IDS)[number])) {
      misdirected.push(`${path.relative(uiRoot, sourceFile)} → openSettingsModal('${match[1]}')`);
    }
  }
}
assert.deepEqual(misdirected, [], `打开了不存在的设置页：${misdirected.join(" / ")}`);

// ---- 7. 「有新版本」徽标要跳到对应的更新页（以前写死 environment，点了跟更新无关）----
assert.equal(updateSettingsTab("app"), "pi-desktop", "桌面应用有新版本时应该打开 Pi Desktop 页");
assert.equal(updateSettingsTab("pi"), "pi-cli", "Pi CLI 有新版本时应该打开 Pi CLI 页");
console.log(`settings-tabs OK ${SETTINGS_SECTIONS.length} 个分区 / ${SETTINGS_TABS.length} 个页面 / 搜索与归属`);
