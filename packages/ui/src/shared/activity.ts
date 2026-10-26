// 连续工具 / 思考步骤的分组与摘要参考 ThinkRail（Apache-2.0）的 ActivityGroup，
// 见 THIRD-PARTY-NOTICES.md。这里只做纯数据推导，不依赖 Vue 或 pi 运行时。

export interface ActivityBlockLike {
  kind: string;
  id: string;
  name?: string;
  status?: string;
  text?: string;
  args?: Record<string, any>;
  streaming?: boolean;
  isError?: boolean;
  /** 工具结果里的图片数量；有图片时保留原卡片，避免折叠后看不到预览 */
  images?: number;
  /** 块的创建时间（毫秒）；历史会话可能没有，用来算这一轮花了多久 */
  ts?: number;
  /** 工具自己记录的耗时（毫秒）；思考块没有 */
  durationMs?: number | null;
}

export interface ActivityEntry<T extends ActivityBlockLike = ActivityBlockLike> {
  block: T;
  /** 在完整 blocks 数组中的下标，用于复制文本、折叠长消息等原有逻辑 */
  index: number;
}

const TOOL_VERBS: Record<string, string> = {
  read: "读取",
  bash: "运行",
  grep: "搜索",
  find: "查找",
  ls: "列出",
  web_search: "搜索网页",
  fetch: "抓取",
  fetch_content: "抓取",
  get_search_content: "读取网页",
  codemode: "运行脚本",
  glob: "匹配",
};

export function isLiveTool(block: ActivityBlockLike): boolean {
  return block.status === "pending" || block.status === "running" || Boolean(block.streaming);
}

function firstLine(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 命令只看第一行，并隐去重复的 cd 前缀，避免折叠头被长路径占满。 */
function cleanCommand(raw: string): string {
  const line = raw.split(/\r?\n/, 1)[0] ?? "";
  const parts = line
    .split(/&&|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^cd(\s|$)/.test(part));
  return firstLine(parts.at(-1) ?? line);
}

/** 路径只保留最后两级，例如 packages/ui/src/App.vue → ui/src/App.vue。 */
function shortPath(raw: string): string {
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || raw;
}

export function activityTarget(block: ActivityBlockLike): string {
  const args = block.args ?? {};
  const first = args.command ?? args.query ?? args.pattern ?? args.path ?? args.url ?? args.repo ?? args.code;
  if (typeof first === "string") {
    const line = block.name === "bash" ? cleanCommand(first) : firstLine(first);
    if (line) return block.name === "read" || block.name === "edit" || block.name === "write" ? shortPath(line) : line;
  }
  return "";
}

/** 工具动作类别，例如 读取 / 运行 / 搜索。 */
export function activityVerb(block: ActivityBlockLike): string {
  if (block.kind === "thinking") return "思考";
  const name = block.name ?? "";
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp ? mcp[2]!.replace(/_/g, " ") : (TOOL_VERBS[name] ?? name) || "工具";
}

/** 单个步骤的一行描述，例如「读取 util.ts」「运行 npm run check」。 */
export function describeActivityBlock(block: ActivityBlockLike): string {
  const verb = activityVerb(block);
  if (block.kind === "thinking") return verb;
  const target = activityTarget(block);
  return target ? clip(`${verb} ${target}`) : verb;
}

export const isFailed = (block: ActivityBlockLike): boolean => Boolean(block.isError) || block.status === "error";
export const isSettled = (block: ActivityBlockLike): boolean => block.status === "done" || block.status === "error";
