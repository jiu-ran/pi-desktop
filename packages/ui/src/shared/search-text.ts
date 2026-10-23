// 对话搜索使用的纯文本提取；AgentChat 的匹配计数与工具卡自动展开共用同一份规则。
export interface SearchableBlock {
  text?: unknown;
  output?: unknown;
  name?: unknown;
  args?: unknown;
}

export function searchableText(block: SearchableBlock): string {
  const args = block.args == null ? "" : (() => {
    try {
      return JSON.stringify(block.args);
    } catch {
      return "";
    }
  })();
  return [block.text, block.output, block.name, args]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

export function blockMatchesQuery(block: SearchableBlock, query?: string): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return false;
  return searchableText(block).toLowerCase().includes(needle);
}
