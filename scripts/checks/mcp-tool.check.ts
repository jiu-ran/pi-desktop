import assert from "node:assert/strict";
import { activityVerb, mcpCallsOf, type ActivityBlockLike, type ActivityEntry } from "../../packages/ui/src/shared/activity.ts";
import { buildTurnSteps, summarizeTurn } from "../../packages/ui/src/shared/activity-turns.ts";
import { isMcpTool, mcpBadge, mcpCallsInCode, mcpChipLabel, parseMcpTool } from "../../packages/ui/src/shared/mcp-tool.ts";

/**
 * MCP 工具的识别与展示。
 *
 * Pi 把外部 MCP 服务提供的工具命名成 `mcp__<服务>__<工具>`。对话界面要能看出来
 * 「这一下不是本地工具，是某个外部服务在跑」——所以服务名要单独拆出来标在行内
 * 与卡片徽标上，而不是把 `mcp__github__search_repositories` 原样糊在标题里。
 */

// 1. 解析
assert.deepEqual(parseMcpTool("mcp__github__search_repositories"), {
  server: "github",
  tool: "search_repositories",
  label: "search repositories",
});
// 工具名里可能还有 __：只按前两段切，后面的原样保留
assert.deepEqual(parseMcpTool("mcp__linkup__search__deep"), {
  server: "linkup",
  tool: "search__deep",
  label: "search  deep",
});
// 不是 MCP 工具 / 名字不完整：一律返回 null，交给普通工具路径
assert.equal(parseMcpTool("read"), null);
assert.equal(parseMcpTool("mcp__github"), null, "没有工具名不算 MCP 调用");
assert.equal(parseMcpTool("mcp____tool"), null, "服务名为空不算");
assert.equal(parseMcpTool(""), null);
assert.equal(parseMcpTool(undefined), null);
assert.equal(parseMcpTool("mcp__server__"), null, "工具名为空不算");
assert.equal(isMcpTool("mcp__github__x"), true);
assert.equal(isMcpTool("bash"), false);
assert.equal(mcpBadge({ server: "github", tool: "x", label: "x" }), "MCP · github");

// 2. 时间线：动词用可读的工具名，服务名单独给出
const tool = (id: string, name: string, args: Record<string, any> = {}): ActivityBlockLike => ({
  kind: "tool",
  id,
  name,
  args,
  status: "done",
  ts: 1_000,
});
const entry = (block: ActivityBlockLike): ActivityEntry => ({ block, index: 0 });

const mcpBlock = tool("t1", "mcp__github__search_repositories", { query: "pi" });
assert.equal(activityVerb(mcpBlock), "search repositories", "动词是工具名（下划线换空格）");
assert.deepEqual(mcpCallsOf(mcpBlock), { servers: ["github"], calls: 1 });
assert.equal(mcpCallsOf(tool("t2", "bash", { command: "ls" })), null, "普通工具没有 MCP 调用");

const steps = buildTurnSteps([entry(mcpBlock), entry(tool("t2", "read", { path: "a.ts" }))]);
assert.deepEqual(steps[0].mcp, { servers: ["github"], calls: 1 }, "步骤上要带 MCP 汇总，行内才能标");
assert.equal(steps[1].mcp, null);

// 3. 组头摘要：一次执行里调用了几次外部服务
const summary = summarizeTurn([entry(mcpBlock), entry(tool("t3", "mcp__linkup__search")), entry(tool("t4", "read", { path: "a.ts" }))]);
assert.equal(summary.mcpCount, 2);
assert.ok(summary.summary.includes("MCP 2 次"), `组头要标出 MCP 次数：${summary.summary}`);

const noMcp = summarizeTurn([entry(tool("t5", "read", { path: "a.ts" }))]);
assert.equal(noMcp.mcpCount, 0);
assert.ok(!noMcp.summary.includes("MCP"), `没有 MCP 调用时不该出现这几个字：${noMcp.summary}`);

// 4. codemode（默认暴露）：MCP 调用藏在脚本里，也必须认出来
assert.deepEqual(
  mcpCallsInCode('const r = await tools.mcp__linkup__linkup_search({ query: "pi" });\nawait tools.mcp__linkup__linkup_fetch({ url: r[0].url });'),
  { servers: ["linkup"], calls: 2 },
  "同一条脚本里调同一个服务的两个工具：2 次",
);
assert.deepEqual(
  mcpCallsInCode('await tools["mcp__github__search_issues"]({}); await tools.mcp__github__get_me({});'),
  { servers: ["github"], calls: 2 },
  "方括号写法也要认（名字里的 - 只在方括号里活着）",
);
assert.deepEqual(
  mcpCallsInCode("await tools.mcp__github__get_me({}); await tools.mcp__linkup__linkup_search({});"),
  { servers: ["github", "linkup"], calls: 2 },
  "多个服务按出现顺序去重",
);
assert.equal(mcpCallsInCode('await tools["mcp__" + name]({})'), null, "拼接出来的名字认不出：宁可不标，不要错标");
assert.equal(mcpCallsInCode("await tools.read({ path: 'a' })"), null, "没有 MCP 调用");
assert.equal(mcpCallsInCode(""), null);

const codemode = tool("c1", "codemode", {
  code: 'const a = await tools.mcp__github__search_repositories({ query: "pi" });\nconst b = await tools.mcp__github__get_me({});\nreturn text([a, b]);',
});
assert.deepEqual(mcpCallsOf(codemode), { servers: ["github"], calls: 2 }, "codemode 块要按脚本里的调用次数算");

const codemodeSummary = summarizeTurn([entry(codemode), entry(tool("c2", "read", { path: "a.ts" }))]);
assert.equal(codemodeSummary.mcpCount, 2, "组头按调用次数统计（一条脚本算 2 次）");
assert.ok(codemodeSummary.summary.includes("MCP 2 次"), `组头要标出 MCP 次数：${codemodeSummary.summary}`);
assert.deepEqual(codemodeSummary.steps[0].mcp, { servers: ["github"], calls: 2 });

// 5. chip 文案
assert.equal(mcpChipLabel({ servers: ["github"], calls: 1 }), "MCP · github");
assert.equal(mcpChipLabel({ servers: ["github"], calls: 2 }), "MCP · github ×2");
assert.equal(mcpChipLabel({ servers: ["github", "linkup"], calls: 3 }), "MCP · github +1 ×3");
assert.equal(mcpChipLabel(null), "");

console.log("mcp-tool OK 解析 / 服务名 / 动词 / 行标 / 组头计数 / codemode 脚本 / chip 文案");
