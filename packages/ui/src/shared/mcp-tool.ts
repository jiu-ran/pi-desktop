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

/** 一段代码里出现的 MCP 调用汇总 */
export interface McpCallSummary {
  /** 涉及的服务（去重、按首次出现排序） */
  servers: string[];
  /** 调用次数（同一工具调两次算两次） */
  calls: number;
}

/**
 * 从 codemode 脚本里找出 MCP 调用。
 *
 * MCP 服务默认是 `codemode` 暴露：模型写的是一段脚本，里面用
 * `tools.mcp__<服务>__<工具>({...})` 调用外部服务 —— 对话记录里只有一条
 * `codemode`（运行脚本），看不到 MCP。这里把脚本里的调用认出来，
 * 才能像 direct 暴露那样标出「这一下走了外部服务」。
 *
 * 注意：脚本里的工具名是 JS 标识符，非法字符会被换成 `_`
 * （配置里叫 `dev-radius` 的服务，脚本里是 `tools.mcp__dev_radius__search`）。
 * 所以拿到的就是脚本里的写法，展示按原文，不做猜测性还原。
 *
 * 只认字面量：`tools["mcp__x__y"]` 与 `tools.mcp__x__y` 都算；
 * 拼接出来的名字（`tools["mcp__" + name]`）认不出来，就当没有 —— 宁可不标，不要错标。
 */
export function mcpCallsInCode(code: string | null | undefined): McpCallSummary | null {
  const source = String(code ?? "");
  if (!source.includes("mcp__")) return null;
  const found: string[] = [];
  // tools.mcp__server__tool
  const dotted = /\btools\s*\.\s*(mcp__[A-Za-z0-9_$]+?)__([A-Za-z0-9_$]+)/g;
  // tools["mcp__server__tool"] / tools['mcp__server__tool']
  const bracketed = /\btools\s*\[\s*(["'])(mcp__[^"']+)\1\s*\]/g;
  for (const match of source.matchAll(dotted)) found.push(`${match[1]}__${match[2]}`);
  for (const match of source.matchAll(bracketed)) found.push(match[2] ?? "");
  if (!found.length) return null;
  const servers: string[] = [];
  let calls = 0;
  for (const name of found) {
    const ref = parseMcpTool(name);
    if (!ref) continue;
    calls += 1;
    if (!servers.includes(ref.server)) servers.push(ref.server);
  }
  return calls ? { servers, calls } : null;
}

/** 行内 / 组头用的 MCP 文案：`MCP · github` / `MCP · github ×2` / `MCP · github +1 ×3` */
export function mcpChipLabel(summary: McpCallSummary | null | undefined): string {
  if (!summary || !summary.calls) return "";
  const first = summary.servers[0] ?? "";
  const extra = summary.servers.length - 1;
  const head = extra > 0 ? `${first} +${extra}` : first;
  return summary.calls > 1 ? `MCP · ${head} ×${summary.calls}` : `MCP · ${head}`;
}
