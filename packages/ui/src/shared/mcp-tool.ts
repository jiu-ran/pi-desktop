/**
 * MCP 工具名的解析。
 *
 * Pi 把 MCP 服务提供的工具命名成 `mcp__<服务>__<工具>`（例如
 * `mcp__github__search_repositories`）。对话界面要能一眼看出来「这一下不是本地工具，
 * 是某个外部服务在跑」，所以服务名与工具名得拆开单独展示。
 */

export interface McpToolRef {
  /** 服务名（mcp.json 里配置的那个 key） */
  server: string;
  /** 工具名（原样，下划线保留） */
  tool: string;
  /** 展示用：把下划线换成空格，长名字不换行 */
  label: string;
}

/** 解析 MCP 工具名；不是 MCP 工具返回 null。 */
export function parseMcpTool(name: string | null | undefined): McpToolRef | null {
  const raw = String(name ?? "");
  if (!raw.startsWith("mcp__")) return null;
  const parts = raw.split("__");
  // mcp__<服务>__<工具>：工具名里本身可能带 __，所以只按前两段切
  if (parts.length < 3) return null;
  const server = parts[1] ?? "";
  const tool = parts.slice(2).join("__");
  if (!server || !tool) return null;
  return { server, tool, label: tool.replace(/_/g, " ") };
}

/** 卡片 / 行内徽标文案 */
export function mcpBadge(ref: McpToolRef): string {
  return `MCP · ${ref.server}`;
}

/** 是不是 MCP 工具 */
export function isMcpTool(name: string | null | undefined): boolean {
  return parseMcpTool(name) !== null;
}
