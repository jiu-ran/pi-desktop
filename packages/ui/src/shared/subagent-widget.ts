/**
 * 子代理扩展的「状态 widget」解析。
 *
 * pi-subagents 通过 RPC widget 把后台任务状态推给宿主（TUI 形态是渲染在编辑器上方的一行）：
 *   - widget key `subagent-async`，内容是 `PI_SUBAGENT_ASYNC_JSON:<JSON>` 的单行快照；
 *   - widget key `subagent-inspect`，内容是 `PI_SUBAGENT_INSPECT_JSON:<JSON>`，**宿主不能显示**。
 *
 * 直接 `<pre>` 打出来就是一大坨机器 JSON（用户看到的那块），所以这里把它解析成
 * 「几条任务 + 状态 + 当前动作」，原始 JSON 只放在折叠区里备查。
 */

export const ASYNC_WIDGET_KEY = "subagent-async";
export const INSPECT_WIDGET_KEY = "subagent-inspect";
export const ASYNC_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
export const INSPECT_WIDGET_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";
export const ASYNC_SNAPSHOT_KIND = "pi-subagents.async-status-snapshot";

export type SnapshotState =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "partial"
  | "paused"
  | "stopped"
  | "rejected";

export interface SnapshotActivity {
  currentTool: string;
  turnCount: number | null;
  toolCount: number | null;
  lastActivityAt: number | null;
}

export interface SnapshotNode {
  id: string;
  kind: string;
  label: string;
  state: SnapshotState;
  agent: string;
  model: string;
  thinking: string;
  startedAt: number | null;
  updatedAt: number | null;
  activity: SnapshotActivity;
  children: SnapshotNode[];
}

export interface AsyncSnapshot {
  generatedAt: number | null;
  runs: SnapshotNode[];
  omittedRuns: number;
  omittedChildren: number;
}

const STATES: SnapshotState[] = [
  "queued",
  "running",
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
];

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** 从一段以前缀开头的文本里取出 JSON；解析失败返回 null。 */
export function parsePrefixedJson(text: string, prefix: string): unknown | null {
  const whole = text.trim();
  const index = whole.indexOf(prefix);
  if (index < 0) return null;
  const payload = whole.slice(index + prefix.length).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    // 有些宿主会把 payload 折成多行，或者后面又跟了别的行：逐步往前退，直到能解析。
    const lines = payload.split(/\r?\n/);
    for (let end = lines.length - 1; end > 0; end -= 1) {
      try {
        return JSON.parse(lines.slice(0, end).join("\n"));
      } catch {
        /* 继续退 */
      }
    }
    return null;
  }
}

function nodeOf(raw: any, depth: number): SnapshotNode {
  const state = str(raw?.state) as SnapshotState;
  const activity = raw?.activity ?? {};
  return {
    id: str(raw?.id),
    kind: str(raw?.kind),
    label: str(raw?.label),
    state: STATES.includes(state) ? state : "running",
    agent: str(raw?.agent),
    model: str(raw?.model),
    thinking: str(raw?.thinking),
    startedAt: num(raw?.startedAt),
    updatedAt: num(raw?.updatedAt),
    activity: {
      currentTool: str(activity?.currentTool),
      turnCount: num(activity?.turnCount),
      toolCount: num(activity?.toolCount),
      lastActivityAt: num(activity?.lastActivityAt),
    },
    children: depth >= 3 ? [] : (Array.isArray(raw?.children) ? raw.children.slice(0, 8).map((child: any) => nodeOf(child, depth + 1)) : []),
  };
}

/** 解析 `subagent-async` widget 的若干行；不是快照时返回 null。 */
export function parseAsyncSnapshot(lines: string[]): AsyncSnapshot | null {
  const text = (lines ?? []).join("\n");
  if (!text.includes(ASYNC_WIDGET_PREFIX)) return null;
  const payload: any = parsePrefixedJson(text, ASYNC_WIDGET_PREFIX);
  if (!payload || payload.kind !== ASYNC_SNAPSHOT_KIND || !Array.isArray(payload.runs)) return null;
  return {
    generatedAt: num(payload.generatedAt),
    runs: payload.runs.slice(0, 20).map((run: any) => nodeOf(run, 0)),
    omittedRuns: num(payload?.omitted?.runs) ?? 0,
    omittedChildren: num(payload?.omitted?.children) ?? 0,
  };
}

export function snapshotStateLabel(state: SnapshotState): string {
  const labels: Record<SnapshotState, string> = {
    queued: "排队中",
    running: "运行中",
    complete: "完成",
    failed: "失败",
    partial: "部分完成",
    paused: "已暂停",
    stopped: "已停止",
    rejected: "被拒绝",
  };
  return labels[state] ?? state;
}

export function snapshotStateTone(state: SnapshotState): "ok" | "run" | "warn" | "err" | "muted" {
  if (state === "complete") return "ok";
  if (state === "running") return "run";
  if (state === "queued" || state === "paused") return "muted";
  if (state === "failed" || state === "rejected") return "err";
  return "warn";
}

/** 汇总一行：`2 个运行中 · 1 个失败`；全部结束就没有运行中的后缀。 */
export function snapshotSummary(snapshot: AsyncSnapshot): string {
  const all: SnapshotNode[] = [];
  const walk = (nodes: SnapshotNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "step" && node.kind !== "host-step") all.push(node);
      walk(node.children);
    }
  };
  walk(snapshot.runs);
  const count = (state: SnapshotState) => all.filter((node) => node.state === state).length;
  const parts: string[] = [];
  const running = count("running") + count("queued");
  const failed = count("failed") + count("rejected");
  const done = count("complete");
  if (running) parts.push(`${running} 个运行中`);
  if (done) parts.push(`${done} 个已完成`);
  if (failed) parts.push(`${failed} 个失败`);
  if (!parts.length) parts.push(`${all.length} 个任务`);
  if (snapshot.omittedRuns) parts.push(`另有 ${snapshot.omittedRuns} 个未列出`);
  return parts.join(" · ");
}

/** 任务行右侧的细节：当前工具、轮数/工具数、模型与思考深度。 */
export function snapshotNodeDetail(node: SnapshotNode): string {
  const parts: string[] = [];
  if (node.activity.currentTool) parts.push(node.activity.currentTool);
  if (node.activity.turnCount !== null) parts.push(`${node.activity.turnCount} 轮`);
  if (node.activity.toolCount !== null) parts.push(`${node.activity.toolCount} 工具`);
  // agent 与 label 相同就别重复写一遍（「delegate delegate」）
  const who = node.agent && node.agent !== node.label ? node.agent : "";
  if (who && node.kind !== "step") parts.push(who);
  // 思考深度通常挂在子步骤上，运行级节点经常没有
  const thinking = node.thinking || node.children.find((child) => child.thinking)?.thinking || "";
  if (thinking) parts.push(`思考 ${thinking}`);
  return parts.join(" · ");
}

/** 时间戳 → 本地 HH:MM:SS，用于「更新于」这类提示。 */
export function snapshotClock(at: number | null): string {
  if (!at) return "";
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
