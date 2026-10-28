// 对话搜索使用的纯文本提取；AgentChat 的匹配计数与工具卡自动展开共用同一份规则。
//
// 只搜「正文」：用户消息与助手回复的文字。以下内容不参与搜索，也不高亮：
// - 思考（thinking）：它是过程记录，命中后会把整段思考撑开，反而盖住要找的正文；
// - 工具调用与输出（tool）：参数是一大坨 JSON，`read` 的输出常常上千行，搜一次命中几十处；
// - 提示块（notice）：错误提示属于系统信息，不是对话内容。
// 正在生成 / 正在运行的内容同样跳过：一边流式变化一边命中，匹配数和位置会不停跳。

export interface SearchableBlock {
  kind?: unknown;
  text?: unknown;
  streaming?: unknown;
  status?: unknown;
  output?: unknown;
  name?: unknown;
  args?: unknown;
}

/** 参与搜索的块类型 */
const BODY_KINDS = new Set(["user", "text"]);

/** 工具块在跑（pending / running）时不算稳定内容 */
function isRunning(block: SearchableBlock): boolean {
  return block.status === "running" || block.status === "pending";
}

/** 正文块的纯文本；不属于正文或还没跑完的块返回空串 */
export function searchableText(block: SearchableBlock): string {
  if (typeof block.kind === "string" && !BODY_KINDS.has(block.kind)) return "";
  if (block.streaming === true || isRunning(block)) return "";
  return typeof block.text === "string" ? block.text : "";
}

export function blockMatchesQuery(block: SearchableBlock, query?: string): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return false;
  return searchableText(block).toLowerCase().includes(needle);
}
