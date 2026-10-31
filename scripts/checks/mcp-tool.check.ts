import assert from "node:assert/strict";
import { activityVerb, mcpServerOf, type ActivityBlockLike, type ActivityEntry } from "../../packages/ui/src/shared/activity.ts";
import { buildTurnSteps, summarizeTurn } from "../../packages/ui/src/shared/activity-turns.ts";
import { isMcpTool, mcpBadge, parseMcpTool } from "../../packages/ui/src/shared/mcp-tool.ts";

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
assert.equal(mcpServerOf(mcpBlock), "github");
assert.equal(mcpServerOf(tool("t2", "bash", { command: "ls" })), null, "普通工具没有 MCP 服务名");

const steps = buildTurnSteps([entry(mcpBlock), entry(tool("t2", "read", { path: "a.ts" }))]);
assert.equal(steps[0].mcpServer, "github", "步骤上要带服务名，行内才能标 MCP");
assert.equal(steps[1].mcpServer, null);

// 3. 组头摘要：一次执行里调用了几次外部服务
const summary = summarizeTurn([entry(mcpBlock), entry(tool("t3", "mcp__linkup__search")), entry(tool("t4", "read", { path: "a.ts" }))]);
assert.equal(summary.mcpCount, 2);
assert.ok(summary.summary.includes("MCP 2 次"), `组头要标出 MCP 次数：${summary.summary}`);

const noMcp = summarizeTurn([entry(tool("t5", "read", { path: "a.ts" }))]);
assert.equal(noMcp.mcpCount, 0);
assert.ok(!noMcp.summary.includes("MCP"), `没有 MCP 调用时不该出现这几个字：${noMcp.summary}`);

console.log("mcp-tool OK 解析 / 服务名 / 动词 / 行标 / 组头计数");
