/**
 * 子代理结果归一化。
 *
 * pi-subagents 的工具结果把结构化信息放在 `details`：
 *   { mode: "single" | "parallel" | "chain" | "management", results: [...], progress: [...], runId, asyncId, ... }
 * 每个 result 里可能有 agent / success / error / durationMs / usage / sessionFile，
 * 进度快照里还有 progress.toolCount / turnCount / tokens / currentTool。
 *
 * 不同版本会增删字段，所以这里全部按可选读取，缺字段就降级，不假设固定结构。
 */

export type SubagentState = "running" | "ok" | "failed" | "timeout" | "stopped";

export interface SubagentRow {
  agent: string;
  state: SubagentState;
  durationMs: number | null;
  tools: number | null;
  turns: number | null;
  tokens: number | null;
  currentTool: string;
  error: string;
  output: string;
  truncated: boolean;
}

export interface SubagentSummary {
  mode: string;
  rows: SubagentRow[];
  agents: string[];
  ok: number;
  failed: number;
  running: number;
  tasks: string[];
}

/** 单个结果的输出可能很长；列表里只留摘要，完整内容仍走原来的「结果」区。 */
const OUTPUT_PREVIEW = 400;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickOutput(result: any): { output: string; truncated: boolean } {
  const raw = text(result?.finalOutput) || text(result?.output) || text(result?.error);
  if (raw.length <= OUTPUT_PREVIEW) return { output: raw, truncated: false };
  return { output: `${raw.slice(0, OUTPUT_PREVIEW).trimEnd()}…`, truncated: true };
}

function stateOf(result: any, settled: boolean): SubagentState {
  if (result?.timedOut) return "timeout";
  if (result?.stopped || result?.interrupted) return "stopped";
  if (result?.success === false || text(result?.error)) return "failed";
  if (result?.success === true) return "ok";
  const activity = text(result?.progress?.activityState);
  if (activity === "running" || activity === "waiting") return "running";
  // 没有明确状态时的兜底：工具已结束就当作成功，否则仍在运行。
  return settled ? "ok" : "running";
}

/** `details` 不可用时返回 null，调用方回退到普通工具卡片。 */
export function summarizeSubagent(details: unknown, settled = true): SubagentSummary | null {
  if (!details || typeof details !== "object") return null;
  const raw = details as any;
  const results: any[] = Array.isArray(raw.results) ? raw.results : [];
  const mode = text(raw.mode) || (raw.workflowGraph ? "workflow" : "");
  if (!results.length && !mode) return null;

  const rows: SubagentRow[] = results.map((result: any) => {
    const progress = result?.progress ?? {};
    const { output, truncated } = pickOutput(result);
    return {
      agent: text(result?.agent) || text(progress?.agent) || "子代理",
      state: stateOf(result, settled),
      durationMs: num(result?.durationMs) ?? num(progress?.durationMs),
      tools: num(progress?.toolCount) ?? (Array.isArray(result?.toolCalls) ? result.toolCalls.length : null),
      turns: num(progress?.turnCount),
      tokens: num(progress?.tokens) ?? num(result?.usage?.totalTokens),
      currentTool: text(progress?.currentTool),
      error: text(result?.error),
      output,
      truncated,
    };
  });

  const agents = [...new Set(rows.map((row) => row.agent))];
  const tasks = results.map((result: any) => text(result?.task)).filter(Boolean);

  return {
    mode,
    rows,
    agents,
    ok: rows.filter((row) => row.state === "ok").length,
    failed: rows.filter((row) => row.state === "failed" || row.state === "timeout").length,
    running: rows.filter((row) => row.state === "running").length,
    tasks,
  };
}

/** 头部徽标的模式文案；未知模式直接显示原值。 */
export function subagentModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    single: "单个",
    parallel: "并行",
    chain: "链式",
    workflow: "工作流",
    management: "管理",
  };
  return labels[mode] ?? mode;
}

/** 状态文案与色调，供界面复用。 */
export function subagentStateLabel(state: SubagentState): string {
  const labels: Record<SubagentState, string> = {
    running: "运行中",
    ok: "完成",
    failed: "失败",
    timeout: "超时",
    stopped: "已停止",
  };
  return labels[state];
}

/** 毫秒 → 「1.2s」/「820ms」/「2m 05s」。 */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
