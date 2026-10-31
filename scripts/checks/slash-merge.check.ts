import assert from "node:assert/strict";
import {
  GROUPS,
  filterCommands,
  mergeCommands,
  parseSlash,
  scopeLabel,
  type LocalSlashCommand,
} from "../../packages/ui/src/services/slash-commands.ts";

/**
 * `/` 候选列表的合并规则。
 *
 * 最要紧的一条：**撞名时桌面端赢**。Pi 自带的扩展里就有 `mcp`，撞名时如果让扩展
 * 赢，桌面端敲 `/mcp` 会进扩展的流程（对话里还会多一条 `/mcp` 消息），而不是打开
 * MCP 设置页 —— 这是真实发生过的回归。
 */

const local = (name: string, order = 10): LocalSlashCommand => ({
  name,
  title: `${name} 标题`,
  description: `${name} 描述`,
  order,
  run: async () => {},
});

const remote = (name: string, source = "extension") => ({
  name,
  description: `${name} 来自 ${source}`,
  source,
  sourceInfo: { scope: "user" },
});

// 1. 撞名：保留桌面端实现，扩展那条不再出现
const shadowed = mergeCommands([local("mcp"), local("packages")], [remote("mcp"), remote("llama")]);
const names = shadowed.map((item) => item.name);
assert.deepEqual(names, ["mcp", "packages", "llama"], `撞名时应该保留桌面端实现：${JSON.stringify(names)}`);
const mcp = shadowed.find((item) => item.name === "mcp")!;
assert.equal(mcp.key, "d:mcp", "撞名后剩下的应该是桌面端那条");
assert.ok(mcp.local, "/mcp 必须带着本地实现，才能在回车时打开 MCP 设置");
assert.equal(shadowed.find((item) => item.name === "llama")?.local, null, "没有撞名的扩展命令照常保留");

// 2. 不撞名时两边都在，且扩展命令的分组/来源标记正确
const mixed = mergeCommands([local("trust")], [remote("review", "prompt"), remote("skill:skill:council-mode", "skill")]);
assert.deepEqual(
  mixed.map((item) => `${item.group}:${item.name}`),
  ["desktop:trust", "prompt:review", "skill:skill:skill:council-mode"],
  "分组要按来源归类",
);
assert.equal(mixed[1].scope, "全局", "prompt 命令要带作用域标记");
assert.equal(mixed[2].title, "skill:council-mode", "技能命令的标题去掉一层 skill: 前缀");

// 3. 过滤与排序：名字前缀优先，其次包含，最后是标题/描述命中
const list = mergeCommands(
  [local("model", 20), local("mcp", 77)],
  [remote("modular"), { name: "x", description: "里面提到 model 的扩展", source: "extension", sourceInfo: {} }],
);
assert.deepEqual(
  filterCommands(list, "mod").map((item) => item.name),
  ["model", "modular", "x"],
  "前缀命中排在包含命中前面，描述命中排最后",
);
assert.equal(filterCommands(list, "").length, 4, "空查询返回全部");
assert.equal(filterCommands(list, "找不到的东西").length, 0, "没有命中就是空");

// 4. 解析：只有「/命令 + 可选参数」才算，普通文字不算
assert.deepEqual(parseSlash("/model"), { name: "model", hasArg: false, arg: "" });
assert.deepEqual(parseSlash("/model anth"), { name: "model", hasArg: true, arg: "anth" });
assert.deepEqual(parseSlash("/compact  上下文太长  "), { name: "compact", hasArg: true, arg: "上下文太长" });
assert.equal(parseSlash("看看这个 /model"), null, "行内出现的斜杠不算命令");
// 多行不算「普通文字」：第一行是命令，后面的当参数（与粘贴多行命令的习惯一致）
assert.deepEqual(parseSlash("/model\n第二行"), { name: "model", hasArg: true, arg: "第二行" });
assert.equal(parseSlash(""), null);

// 5. 作用域文案
assert.equal(scopeLabel("user"), "全局");
assert.equal(scopeLabel("project"), "项目");
assert.equal(scopeLabel(undefined), "");
assert.equal(scopeLabel("temporary"), "", "temporary 是 Pi 内部作用域，桌面端不展示");
assert.deepEqual(GROUPS.map((group) => group.id), ["desktop", "extension", "prompt", "skill"]);

console.log("slash-merge OK 撞名让位 / 分组 / 过滤排序 / 解析 / 作用域");
