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
}

export interface ActivityEntry<T extends ActivityBlockLike = ActivityBlockLike> {
  block: T;
  /** 在完整 blocks 数组中的下标，用于复制文本、折叠长消息等原有逻辑 */
  index: number;
}

export interface ActivityGroup<T extends ActivityBlockLike = ActivityBlockLike> {
  id: string;
  entries: ActivityEntry<T>[];
  toolCount: number;
  thinkingCount: number;
  live: boolean;
  errored: boolean;
  /** 折叠头的一行摘要 */
  summary: string;
  /** 完整摘要，放在 title 里 */
  detail: string;
}

export type ActivityRenderItem<T extends ActivityBlockLike = ActivityBlockLike> =
  | { kind: "block"; block: T; index: number }
  | { kind: "activity"; group: ActivityGroup<T> };

/** 少于 4 步的零散工具保持原样，避免为两次 read 也加一条折叠头。 */
export const ACTIVITY_MIN_STEPS = 4;

/** 单个活动组最多收 20 步；超长工具链拆成多组，搜索展开时不会一次挂载几十张卡片。 */
export const ACTIVITY_MAX_STEPS = 20;

/** 这些工具本身是主要产物或需要用户交互，不放进折叠的活动组。 */
const PRIMARY_TOOLS = new Set(["edit", "write", "apply_patch", "request_review", "ask_user_question"]);

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

/** 主要工具（diff、写文件、需要用户回答）保持独立卡片。 */
export function isPrimaryToolName(name = ""): boolean {
  return PRIMARY_TOOLS.has(name);
}

export function isLiveTool(block: ActivityBlockLike): boolean {
  return block.status === "pending" || block.status === "running" || Boolean(block.streaming);
}

/** 可以作为活动步骤的块：思考，以及非主要、无图片的工具调用。 */
export function isActivityStep(block: ActivityBlockLike): boolean {
  if (block.kind === "thinking") return true;
  if (block.kind !== "tool") return false;
  if (isPrimaryToolName(block.name)) return false;
  return !(block.images && block.images > 0);
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

function targetOf(block: ActivityBlockLike): string {
  const args = block.args ?? {};
  const first = args.command ?? args.query ?? args.pattern ?? args.path ?? args.url ?? args.repo ?? args.code;
  if (typeof first === "string") {
    const line = block.name === "bash" ? cleanCommand(first) : firstLine(first);
    if (line) return block.name === "read" || block.name === "edit" || block.name === "write" ? shortPath(line) : line;
  }
  return "";
}

/** 工具动作类别，例如 读取 / 运行 / 搜索；折叠头用它做计数摘要。 */
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
  const target = targetOf(block);
  return target ? clip(`${verb} ${target}`) : verb;
}

function uniqueActions(entries: ActivityEntry[]): string[] {
  const seen = new Set<string>();
  const actions: string[] = [];
  for (const entry of entries) {
    if (entry.block.kind !== "tool") continue;
    const action = describeActivityBlock(entry.block);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    actions.push(action);
  }
  return actions;
}

export function summarizeActivity(entries: ActivityEntry[]): Pick<ActivityGroup, "toolCount" | "thinkingCount" | "live" | "errored" | "summary" | "detail"> {
  const tools = entries.filter((entry) => entry.block.kind === "tool");
  const thoughts = entries.filter((entry) => entry.block.kind === "thinking");
  const errored = tools.some((entry) => entry.block.isError || entry.block.status === "error");
  const live = entries.some((entry) => isLiveTool(entry.block) || entry.block.streaming);
  const actions = uniqueActions(entries);
  const detail = actions.length
    ? clip(actions.slice(0, 8).join(" · ") + (actions.length > 8 ? ` · +${actions.length - 8}` : ""), 240)
    : thoughts.length
      ? `${thoughts.length} 段思考`
      : "";

  // 折叠头显示去重后的具体动作，比「运行 ×18」更能说明这一组做了什么；
  // 完整数量由左侧的「N 工具 · N 思考」承担。
  const shown = actions.slice(0, 3).join(" · ");
  const more = actions.length - 3;
  let summary = shown ? `${shown}${more > 0 ? ` · +${more}` : ""}` : thoughts.length ? `${thoughts.length} 段思考` : "活动";

  if (live) {
    const running = [...tools].reverse().find((entry) => isLiveTool(entry.block));
    const thinking = [...thoughts].reverse().find((entry) => entry.block.streaming);
    if (running) summary = `正在${describeActivityBlock(running.block)}`;
    else if (thinking) summary = "正在思考…";
    else summary = "正在处理…";
  } else if (errored) {
    const failed = tools.find((entry) => entry.block.isError || entry.block.status === "error");
    summary = failed ? `失败 · ${describeActivityBlock(failed.block)}` : "有工具执行失败";
  }

  return {
    toolCount: tools.length,
    thinkingCount: thoughts.length,
    live,
    errored,
    summary: clip(summary || "活动", 96),
    detail,
  };
}

/**
 * 把连续的思考 / 常规工具合并成活动组；文本、用户消息、错误提示和主要工具会打断分组。
 * 少于 ACTIVITY_MIN_STEPS 步的连续片段仍按原样逐块渲染。
 */
export function deriveActivityItems<T extends ActivityBlockLike>(blocks: readonly T[]): ActivityRenderItem<T>[] {
  const items: ActivityRenderItem<T>[] = [];
  let run: ActivityEntry<T>[] = [];

  const flush = (): void => {
    if (run.length >= ACTIVITY_MIN_STEPS) {
      const first = run[0]!;
      items.push({
        kind: "activity",
        group: {
          id: `activity:${first.block.id}`,
          entries: run,
          ...summarizeActivity(run),
        },
      });
    } else {
      for (const entry of run) items.push({ kind: "block", ...entry });
    }
    run = [];
  };

  blocks.forEach((block, index) => {
    if (isActivityStep(block)) {
      run.push({ block, index });
      if (run.length >= ACTIVITY_MAX_STEPS) flush();
      return;
    }
    flush();
    items.push({ kind: "block", block, index });
  });
  flush();
  return items;
}

/** 活动组里的工具数量与思考数量，用于折叠头右侧的计数。 */
export function activityCountLabel(group: Pick<ActivityGroup, "toolCount" | "thinkingCount">): string {
  if (group.toolCount && group.thinkingCount) return `${group.toolCount} 工具 · ${group.thinkingCount} 思考`;
  if (group.toolCount) return `${group.toolCount} 个工具`;
  if (group.thinkingCount) return `${group.thinkingCount} 段思考`;
  return "活动";
}
