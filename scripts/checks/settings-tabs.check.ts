import assert from "node:assert/strict";
import {
  ALL_TAB_IDS,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  findSettingsTab,
  searchSettings,
  sectionOfTab,
  sectionTabs,
} from "../../packages/ui/src/components/overlays/settings/settings-tabs.ts";
import { DEFAULT_SETTINGS } from "../../packages/ui/src/services/settings.ts";

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

// ---- 3. 每页都有标题、说明与图标 ----
for (const tab of SETTINGS_TABS) {
  assert.ok(tab.label.length >= 2, `页「${tab.id}」缺少名称`);
  assert.ok(tab.desc.length >= 8, `页「${tab.id}」的说明太短：${tab.desc}`);
  assert.ok(tab.icon.includes("<svg"), `页「${tab.id}」缺少图标`);
}

// ---- 4. 查询 ----
assert.equal(findSettingsTab("logs").label, "运行日志", "按 id 找页");
assert.equal(findSettingsTab("nope" as any).id, SETTINGS_TABS[0]!.id, "找不到时退回第一页，界面不至于空白");
assert.equal(sectionOfTab("logs").id, "desktop", "运行日志属于「桌面」分区");
assert.equal(sectionOfTab("mcp").id, "power", "MCP 属于「能力」分区");
assert.deepEqual(sectionTabs(SETTINGS_SECTIONS[0]!).map((tab) => tab.id), ["conversation", "agents"], "分区内的页保持登记顺序");

// 搜索：跨分区命中，并带上所属分区名
const logHits = searchSettings("日志");
assert.deepEqual(logHits.map((hit) => hit.id), ["logs"], `搜「日志」只应命中运行日志：${logHits.map((hit) => hit.id).join("/")}`);
assert.equal(logHits[0]!.sectionLabel, "桌面", "命中结果要标出所属分区");

const skillHits = searchSettings("SKILL");
assert.ok(skillHits.some((hit) => hit.id === "skills"), "搜索不区分大小写");
const bySection = searchSettings("能力");
assert.ok(bySection.length >= 4, `按分区名搜索应命中该分区所有页，实际 ${bySection.length}`);
assert.deepEqual(searchSettings("   "), [], "空查询不返回结果");

// ---- 5. 设置项字段与页面不脱节：至少这一页是「对话」相关的 ----
assert.ok("streamingMode" in DEFAULT_SETTINGS && "sendShortcut" in DEFAULT_SETTINGS, "对话页依赖的设置在默认值里都存在");

console.log(`settings-tabs OK ${SETTINGS_SECTIONS.length} 个分区 / ${SETTINGS_TABS.length} 个页面 / 搜索与归属`);
