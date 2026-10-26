import {
  activityTarget,
  isSettled,
  activityVerb,
  describeActivityBlock,
  isFailed,
  isLiveTool,
  type ActivityBlockLike,
  type ActivityEntry,
} from "./activity.ts";

/**
 * 回合分组：一次用户请求 = 一条「执行记录」。
 *
 * 真实会话实测（108 块）：原来渲染 47 行 —— 阈值 4 步导致 15 个独立思考行各自成行、
 * edit/write 打断分组散出 16 张卡片、20 步上限又切出 6 个组头。
 * 这里改成「只要还在同一条用户消息里，活动就归到同一组」，组内再按
 * 思考 / 读取 / 运行 / 改动 做二级分组，收起时永远只占一行。
 */

/** 会打断回合分组、保持独立卡片的工具（要交互或代表一次完整子任务）。 */
const BREAK_TOOLS = new Set(["subagent", "parallel", "review", "request_review", "ask_user_question", "bg_wait"]);

/** 归到「改动」的工具 */
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"]);

/** 少于 2 步的片段不单独做组头（一次 read 直接显示卡片更省事）。 */
export const TURN_MIN_STEPS = 2;

/** 二级分组的固定文案；未列出的工具用 activityVerb。 */
const CATEGORY_LABEL: Record<string, string> = {
  thinking: "思考",
  edit: "改动",
  bash: "运行",
  read: "读取",
  grep: "搜索",
  find: "查找",
  glob: "匹配",
  ls: "列出",
  fetch: "抓取",
};

export interface ActivitySection<T extends ActivityBlockLike = ActivityBlockLike> {
  /** 二级分组的键：thinking / edit / bash / read … */
  key: string;
  kind: "thinking" | "tool";
  label: string;
  count: number;
  failedCount: number;
  /** 一行预览：「util.ts · session.ts +1」「npm run check · git status +24」 */
  preview: string;
  entries: ActivityEntry<T>[];
}

export interface TurnGroup<T extends ActivityBlockLike = ActivityBlockLike> {
  id: string;
  entries: ActivityEntry<T>[];
  sections: ActivitySection<T>[];
  toolCount: number;
  thinkingCount: number;
  /** 改动过的文件数（edit / write / apply_patch 去重后的路径数） */
  editCount: number;
  commandCount: number;
  readCount: number;
  failedCount: number;
  /** 以失败收尾（与旧的活动组同一口径：只看最后一个已结算的工具） */
  errored: boolean;
  live: boolean;
  /** 耗时；块没有时间戳或不足 1 秒时为 0（不显示） */
  durationMs: number;
  summary: string;
  detail: string;
}

export type TurnRenderItem<T extends ActivityBlockLike = ActivityBlockLike> =
  | { kind: "block"; block: T; index: number }
  | { kind: "turn"; group: TurnGroup<T> };

/** 这个块算「回合内的活动步骤」吗（edit / write 也算，会收进组里） */
export function isTurnStep(block: ActivityBlockLike): boolean {
  if (block.kind === "thinking") return true;
  if (block.kind !== "tool") return false;
  return !BREAK_TOOLS.has(block.name ?? "");
}

export function activityCategory(block: ActivityBlockLike): string {
  if (block.kind === "thinking") return "thinking";
  const name = block.name ?? "";
  if (EDIT_TOOLS.has(name)) return "edit";
  return name || "tool";
}

function sectionPreview<T extends ActivityBlockLike>(category: string, entries: ActivityEntry<T>[]): string {
  if (category === "thinking") return entries.length > 1 ? `${entries.length} 段` : "1 段";
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const entry of entries) {
    const target = activityTarget(entry.block);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  if (!targets.length) return "";
  const shown = targets.slice(0, 2).join(" · ");
  return targets.length > 2 ? `${shown} +${targets.length - 2}` : shown;
}

/** 把一轮活动拆成「思考 / 读取 / 运行 / 改动」等二级分组，顺序按首次出现 */
export function buildActivitySections<T extends ActivityBlockLike>(entries: ActivityEntry<T>[]): ActivitySection<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, ActivityEntry<T>[]>();
  for (const entry of entries) {
    const category = activityCategory(entry.block);
    if (!buckets.has(category)) {
      buckets.set(category, []);
      order.push(category);
    }
    buckets.get(category)!.push(entry);
  }
  return order.map((category) => {
    const items = buckets.get(category)!;
    const sample = items[0]!.block;
    const kind: "thinking" | "tool" = sample.kind === "thinking" ? "thinking" : "tool";
    return {
      key: category,
      kind,
      label: CATEGORY_LABEL[category] ?? (kind === "thinking" ? "思考" : activityVerb(sample)),
      count: items.length,
      failedCount: items.filter((entry) => isFailed(entry.block)).length,
      preview: sectionPreview(category, items),
      entries: items,
    };
  });
}

/** 耗时文案（不足 1 秒返回空串） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return "";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

export function turnDurationLabel(group: Pick<TurnGroup, "durationMs">): string {
  return formatDuration(group.durationMs);
}

/** 组头摘要：「执行了 N 步 · 改 N 个文件 · N 条命令 · 思考 N 段」 */
export function summarizeTurn<T extends ActivityBlockLike>(entries: ActivityEntry<T>[]): Pick<
  TurnGroup<T>,
  "toolCount" | "thinkingCount" | "editCount" | "commandCount" | "readCount" | "failedCount" | "errored" | "live" | "durationMs" | "summary" | "detail"
> {
  const tools = entries.filter((entry) => entry.block.kind === "tool");
  const thoughts = entries.filter((entry) => entry.block.kind === "thinking");
  const edits = tools.filter((entry) => EDIT_TOOLS.has(entry.block.name ?? ""));
  const files = new Set<string>();
  for (const entry of edits) {
    const target = activityTarget(entry.block);
    if (target) files.add(target);
  }
  const commands = tools.filter((entry) => entry.block.name === "bash");
  const reads = tools.filter((entry) => entry.block.name === "read");
  const failedCount = tools.filter((entry) => isFailed(entry.block)).length;
  const live = entries.some((entry) => isLiveTool(entry.block) || entry.block.streaming);
  // 只看最后一个已结算的工具：失败后重试成功就不算失败；仍在运行时先不报警
  const lastSettled = [...tools].reverse().find((entry) => isSettled(entry.block));
  const errored = !live && Boolean(lastSettled && isFailed(lastSettled.block));

  const stamps = entries.map((entry) => entry.block.ts).filter((ts): ts is number => typeof ts === "number" && ts > 0);
  const durationMs = stamps.length >= 2 ? Math.max(0, Math.max(...stamps) - Math.min(...stamps)) : 0;

  const parts: string[] = [];
  if (live) {
    const running = [...tools].reverse().find((entry) => isLiveTool(entry.block));
    parts.push(running ? `正在${describeActivityBlock(running.block)}` : "正在处理…");
    parts.push(`已完成 ${entries.length} 步`);
  } else {
    parts.push(`执行了 ${entries.length} 步`);
    if (files.size) parts.push(`改 ${files.size} 个文件`);
    if (commands.length) parts.push(`${commands.length} 条命令`);
    if (reads.length) parts.push(`读 ${reads.length} 个文件`);
    if (thoughts.length) parts.push(`思考 ${thoughts.length} 段`);
    if (failedCount) parts.push(`${failedCount} 处失败`);
  }

  const sections = buildActivitySections(entries);
  const detail = sections
    .map((section) => `${section.label} ${section.count}${section.preview ? `（${section.preview}）` : ""}`)
    .join(" · ");

  return {
    toolCount: tools.length,
    thinkingCount: thoughts.length,
    editCount: files.size,
    commandCount: commands.length,
    readCount: reads.length,
    failedCount,
    errored,
    live,
    durationMs,
    summary: parts.join(" · "),
    detail,
  };
}

/**
 * 按「一次用户请求」分组：对话区的主分组方式。
 * 文本、用户消息、通知与 subagent 这类需要交互的工具会断开分组并保持原样。
 */
export function deriveTurnItems<T extends ActivityBlockLike>(blocks: readonly T[]): TurnRenderItem<T>[] {
  const items: TurnRenderItem<T>[] = [];
  let run: ActivityEntry<T>[] = [];

  const flush = (): void => {
    if (run.length >= TURN_MIN_STEPS) {
      const first = run[0]!;
      items.push({
        kind: "turn",
        group: {
          id: `turn:${first.block.id}`,
          entries: run,
          sections: buildActivitySections(run),
          ...summarizeTurn(run),
        },
      });
    } else {
      for (const entry of run) items.push({ kind: "block", ...entry });
    }
    run = [];
  };

  blocks.forEach((block, index) => {
    if (isTurnStep(block)) {
      run.push({ block, index });
      return;
    }
    flush();
    items.push({ kind: "block", block, index });
  });
  flush();
  return items;
}
