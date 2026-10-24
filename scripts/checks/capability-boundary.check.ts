import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 能力归属检查：Pi 自带功能留在核心，非 Pi 自带能力做成插件。
 *
 * 规则来自 docs/product-boundary.md：
 * - 核心（不可停用）：对话与工具、会话、@ 文件引用、斜杠命令、模型 / 思考等级、
 *   Skills / MCP / Packages / AGENTS.md
 * - 插件（可停用）：子代理、Mermaid、引用对话、项目文件、版本控制、终端、RPC 事件
 *
 * 把规则钉住：新增能力放错位置时这个检查会失败。
 */

const root = path.resolve(import.meta.dirname, "../..");

async function read(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

// 期望的插件清单：id → 是否必须核心
const EXPECTED: Record<string, { core: boolean; reason: string }> = {
  "plugin-manager": { core: true, reason: "插件管理是桌面端自身界面，必须常驻" },
  files: { core: false, reason: "项目文件树是桌面端能力，不是 Pi 功能" },
  git: { core: false, reason: "版本控制是桌面端能力" },
  events: { core: false, reason: "RPC 事件查看器是桌面端调试工具" },
  markdown: { core: false, reason: "文件区 Markdown 预览是桌面端能力（对话渲染在核心里）" },
  mermaid: { core: false, reason: "图表渲染不是 Pi 自带能力" },
  subagent: { core: false, reason: "子代理由 pi-subagents 扩展提供，不是 Pi 自带" },
  "session-quote": { core: false, reason: "引用对话是桌面端能力（Pi 的 @ 只做文件补全）" },
  terminal: { core: false, reason: "终端不是 Pi 自带能力" },
};

// 不从 plugins/index.ts import：它会拉进 .vue 组件，node 加载不了。
// 这里直接读源码里的定义（插件的元信息都是字面量）。
const registry = await read("packages/ui/src/plugins/index.ts");
const dirs = registry
  .split("\n")
  .map((line) => /^import \w+ from "\.\/([\w-]+)\/index\.ts";$/.exec(line.trim()))
  .filter((match): match is RegExpExecArray => Boolean(match))
  .map((match) => match[1]!);
assert.ok(dirs.length >= 5, "应从插件清单解析出插件目录，实际 " + dirs.length);

interface PluginMeta {
  id: string;
  core: boolean;
  area?: string;
}

const builtinPlugins: PluginMeta[] = [];
for (const dir of dirs) {
  const source = await read("packages/ui/src/plugins/" + dir + "/index.ts");
  const id = /id:\s*"([\w-]+)"/.exec(source)?.[1];
  if (!id) throw new Error(dir + "/index.ts 里找不到插件 id");
  const core = /core:\s*true/.test(source);
  // 未声明区域时默认是扩展工具区（sidebar）
  const area = /area:\s*"(\w+)"/.exec(source)?.[1] ?? "sidebar";
  builtinPlugins.push({ id, core, area });
}
const ids = builtinPlugins.map((plugin) => plugin.id).sort();
assert.deepEqual(ids, Object.keys(EXPECTED).sort(), "插件清单与能力归属表不一致：" + ids.join(","));

for (const plugin of builtinPlugins) {
  const expected = EXPECTED[plugin.id]!;
  assert.equal(Boolean(plugin.core), expected.core, plugin.id + " 的核心标记不对（" + expected.reason + "）");
  if (!expected.core) {
    assert.ok(plugin.area, plugin.id + " 是插件，必须声明归属区域");
  }
}

// 核心不能出现「对话引用」的实现：它已经属于 session-quote 插件
const composer = await read("packages/ui/src/components/chat/Composer.vue");
for (const forbidden of ["addSessionAttachment(", "sessionRows", "pickSession("]) {
  assert.ok(
    !composer.includes(forbidden),
    "核心输入框里还有对话引用实现（" + forbidden + "）：这类能力应放在 session-quote 插件里",
  );
}
assert.ok(composer.includes("completePaths"), "核心的 @ 应保留 Pi 自带的文件 / 文件夹补全");

// 对话里的 Markdown 渲染属于核心，不能被插件门控
const assistant = await read("packages/ui/src/components/chat/messages/AssistantText.vue");
assert.ok(
  !/plugins\.(records|mentionSources)/.test(assistant),
  "对话正文渲染属于 Pi 自带能力，不能由插件开关控制",
);

// 工具卡片：核心只查插件注册表，不 import 任何插件组件
const blockView = await read("packages/ui/src/components/chat/BlockView.vue");
assert.ok(
  blockView.includes("toolRenderers"),
  "核心分发器应从插件注册表取工具渲染器",
);
assert.ok(
  !/from "\.\.\/\.\.\/plugins\//.test(blockView),
  "核心分发器不应 import 插件目录里的组件",
);
for (const tool of ["read", "bash", "edit", "write"]) {
  assert.ok(
    new RegExp("block\.name === ['\"]" + tool + "['\"]").test(blockView),
    "核心工具 " + tool + " 的渲染应在核心里",
  );
}

// 子代理能力必须留在插件目录里，并通过贡献点注册
const subagentPlugin = await read("packages/ui/src/plugins/subagent/index.ts");
assert.ok(subagentPlugin.includes("definePlugin"), "子代理插件必须用 definePlugin 定义");
assert.ok(subagentPlugin.includes("registerToolRenderer"), "子代理卡片应通过 registerToolRenderer 注册");
assert.ok(subagentPlugin.includes("SubagentTool.vue"), "子代理组件应留在插件目录里");
await read("packages/ui/src/plugins/subagent/SubagentTool.vue");
await read("packages/ui/src/plugins/subagent/SubagentDialog.vue");
for (const tool of ["subagent", "parallel", "review", "bg_wait"]) {
  assert.ok(subagentPlugin.includes("SUBAGENT_TOOLS") || subagentPlugin.includes(tool), "子代理插件应声明接管的工具名");
}

// 文档必须写明这条规则，否则「边界」只是口头约定
const doc = await read("docs/product-boundary.md");
assert.ok(doc.includes("Pi 自带"), "边界文档应说明 Pi 自带功能的归属");
assert.ok(doc.includes("插件"), "边界文档应说明非 Pi 能力的归属");
for (const plugin of Object.keys(EXPECTED)) {
  assert.ok(doc.includes(plugin), "边界文档的能力表里缺少 " + plugin);
}

console.log(
  "capability-boundary.check ok 核心 " +
    builtinPlugins.filter((plugin) => plugin.core).length +
    " 个 / 插件 " +
    builtinPlugins.filter((plugin) => !plugin.core).length +
    " 个",
);
