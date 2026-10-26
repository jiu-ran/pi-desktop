import {
  activityTarget,
  activityVerb,
  describeActivityBlock,
  isFailed,
  isLiveTool,
  isSettled,
  type ActivityBlockLike,
  type ActivityEntry,
} from "./activity.ts";
import { blockDiff, diffStat } from "./diff.ts";

/**
 * 回合分组：一次用户请求 = 一条「执行记录」。
 *
 * 真实会话实测（108 块）：原来渲染 47 行 —— 阈值 4 步导致 15 个独立思考行各自成行、
 * edit/write 打断分组散出 16 张卡片、20 步上限又切出 6 个组头。
 * 这里改成「只要还在同一条用户消息里，活动就归到同一组」，收起时只占一行；
 * 展开后**按时间顺序**列出每一步（思考、读取、运行、改动混排），
 * 而不是按类别归并 —— 归并后看不出「先跑测试、看到失败、再改代码」这种真实顺序。
 */

/** 会打断回合分组、保持独立卡片的工具（要交互或代表一次完整子任务）。 */
const BREAK_TOOLS = new Set(["subagent", "parallel", "review", "request_review", "ask_user_question", "bg_wait"]);

/** 归到「改动」的工具 */
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"]);

/** 少于 2 步的片段不单独做组头（一次 read 直接显示卡片更省事）。 */
export const TURN_MIN_STEPS = 2;

/** 时间线上的动作名；未列出的工具用 activityVerb。 */
const STEP_LABEL: Record<string, string> = {
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

/** 时间线上的一步：块的原文 + 展示用的派生字段 */
export interface TurnStep<T extends ActivityBlockLike = ActivityBlockLike> {
  block: T;
  /** 在完整 blocks 数组中的下标 */
  index: number;
  /** 分类键：thinking / edit / bash / read …（只用来上色和统计） */
  key: string;
  kind: "thinking" | "tool";
  /** 动作名：思考 / 改动 / 运行 / 读取 … */
  label: string;
  /** 一行摘要：命令、文件名，思考步骤取推理开头 */
  target: string;
  failed: boolean;
  live: boolean;
  /** 改动新增行数；非改动步骤为 null */
  added: number | null;
  /** 改动删除行数；写入（write）或非改动步骤为 null */
  removed: number | null;
  /** 这一步自己花了多久（毫秒）；拿不到时间戳时 -1 */
  elapsedMs: number;
  /** 「0.4 秒」/「12 秒」/「1 分 5 秒」；拿不到时间时为空串 */
  elapsedLabel: string;
}

export interface TurnGroup<T extends ActivityBlockLike = ActivityBlockLike> {
  id: string;
  entries: ActivityEntry<T>[];
  /** 按时间顺序排列的每一步（与 entries 一一对应） */
  steps: TurnStep<T>[];
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

/** 单个步骤的动作名：改动（edit/write）、运行、读取 … */
export function stepLabel(block: ActivityBlockLike): string {
  const category = activityCategory(block);
  return STEP_LABEL[category] ?? activityVerb(block);
}

function firstLine(text: unknown, max = 96): string {
  if (typeof text !== "string") return "";
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 单步摘要：工具看参数，思考取推理的第一句（截断，完整内容在展开后的卡片里） */
export function stepTarget(block: ActivityBlockLike): string {
  if (block.kind === "thinking") return firstLine(block.text);
  return firstLine(activityTarget(block));
}

/** 单步耗时文案：不足 1 秒也要显示（否则「很慢的一步」和「没跑」分不清） */
export function formatStepDuration(ms: number): string {
  if (ms < 0) return "";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} 秒`;
  return formatDuration(ms);
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

/** 改动步骤的增删行数；非改动工具或没有差异时返回 null（写入只报新增） */
export function editStat<T extends ActivityBlockLike>(block: T): { added: number; removed: number | null } | null {
  if (!EDIT_TOOLS.has(block.name ?? "")) return null;
  const lines = blockDiff(block);
  if (!lines.length) return null;
  const { added, removed } = diffStat(lines);
  return { added, removed: block.name === "write" ? null : removed };
}

/**
 * 时间线：保持块的原始顺序，只补上展示用的动作名、摘要、失败/运行状态和相对时间。
 *
 * 这里不做任何合并 —— 用户要看的正是「先思考、再跑命令、然后改文件、又失败」的真实次序。
 */
export function buildTurnSteps<T extends ActivityBlockLike>(entries: ActivityEntry<T>[]): TurnStep<T>[] {
  return entries.map((entry, position) => {
    const block = entry.block;
    const ts = typeof block.ts === "number" && block.ts > 0 ? block.ts : 0;
    // 这一步自己的耗时：工具类有记录的 durationMs 就直接用；
    // 思考 / 没记录的工具用「到下一步开始」的间隔（最后一步没有后继，只能给 -1 不显示）。
    const recorded = typeof block.durationMs === "number" && block.durationMs >= 0 ? block.durationMs : null;
    const nextTs = entries[position + 1]?.block.ts;
    const gap = ts && typeof nextTs === "number" && nextTs > ts ? nextTs - ts : -1;
    const elapsedMs = recorded ?? gap;
    const elapsed = formatStepDuration(elapsedMs);
    // 改动步骤把 +N / −N 一起带出来：时间线里的卡片不再画头部，行上要能直接看到增删
    const stat = editStat(block);
    return {
      block,
      index: entry.index,
      key: activityCategory(block),
      kind: block.kind === "thinking" ? "thinking" : "tool",
      label: stepLabel(block),
      target: stepTarget(block),
      failed: isFailed(block),
      live: isLiveTool(block) || Boolean(block.streaming),
      added: stat?.added ?? null,
      removed: stat?.removed ?? null,
      elapsedMs,
      elapsedLabel: elapsed,
    };
  });
}

/** 组头摘要：「执行了 N 步 · 改 N 个文件 · N 条命令 · 思考 N 段」 */
export function summarizeTurn<T extends ActivityBlockLike>(entries: ActivityEntry<T>[]): Pick<
  TurnGroup<T>,
  | "steps"
  | "toolCount"
  | "thinkingCount"
  | "editCount"
  | "commandCount"
  | "readCount"
  | "failedCount"
  | "errored"
  | "live"
  | "durationMs"
  | "summary"
  | "detail"
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

  const steps = buildTurnSteps(entries);
  const stamps = entries.map((entry) => entry.block.ts).filter((ts): ts is number => typeof ts === "number" && ts > 0);
  // 有真实时间戳就用首尾差；老会话没有时间戳时退回「各步耗时之和」，总时间不至于空着
  const durationMs =
    stamps.length >= 2
      ? Math.max(0, Math.max(...stamps) - Math.min(...stamps))
      : steps.reduce((sum, step) => sum + Math.max(0, step.elapsedMs), 0);

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

  const detail = steps
    .slice(0, 8)
    .map((step) => (step.target ? `${step.label} ${step.target}` : step.label))
    .join(" · ");

  return {
    steps,
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
    detail: steps.length > 8 ? `${detail} · +${steps.length - 8}` : detail,
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
