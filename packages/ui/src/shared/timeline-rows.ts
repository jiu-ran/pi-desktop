import type { ActivityBlockLike } from "./activity.ts";
import type { TurnStep } from "./activity-turns.ts";

/**
 * 时间线的「降噪」：连续同类步骤的同前缀淡化（L）+ 参数不同的同类步骤合并成一行（E）。
 *
 * 真实会话里常见：连着 4 条 `cat > scripts/checks/_apN.cjs <<'CJS'`，或者
 * `npm run check -- 0` … `-- 17`。它们占满一屏却只有文件名/序号在变，
 * 真正有信息量的「思考」「失败」被淹掉。
 *
 * 规则（只影响显示，不改数据）：
 * - 相邻、同工具、只有中间一小段不同 → 相同的前后缀淡成灰色，变化的片段保持正常亮度；
 * - 这样的连续步骤 ≥ 3 步且允许合并时，收成一行 `…_ap{1..4}.cjs`，点开再看每一步。
 */

export interface MatchableStep {
  /** 分类键：bash / read / edit / thinking … */
  key: string;
  kind: "thinking" | "tool";
  /** 一行摘要（命令 / 文件名） */
  target: string;
  failed: boolean;
  live: boolean;
  /** 改动新增行数（非改动步骤为 null） */
  added?: number | null;
  /** 改动删除行数（write 或非改动步骤为 null） */
  removed?: number | null;
}

export interface StepMatch {
  prefix: string;
  changed: string;
  suffix: string;
  /** 相同部分占得够多、差异只是一小段：值得淡化（甚至可以合并） */
  mergeable: boolean;
}

export type TimelineRow<T extends MatchableStep> =
  | { kind: "step"; step: T; match?: StepMatch; startIndex: number }
  | {
      kind: "run";
      steps: T[];
      target: string;
      failed: boolean;
      live: boolean;
      /** 合并行里所有改动的 +N / −N 之和 */
      added: number | null;
      removed: number | null;
      startIndex: number;
    };

/** 合并需要的最少步数：两步相同的命令不值得多一次点击 */
export const MERGE_MIN_STEPS = 3;

/** 相同部分至少占较短串的多少比例，才算「只是参数不同」 */
const SIMILAR_RATIO = 0.6;

/** 比较两步的摘要，切出相同前缀 / 变化段 / 相同后缀。 */
export function matchTarget(previous: string, current: string): StepMatch | null {
  const a = String(previous ?? "");
  const b = String(current ?? "");
  if (!a || !b || a === b) return null;
  let head = 0;
  const limit = Math.min(a.length, b.length);
  while (head < limit && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < limit - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const prefix = a.slice(0, head);
  const suffix = tail ? a.slice(a.length - tail) : "";
  const changed = b.slice(head, b.length - tail);
  if (!changed) return null;
  const same = prefix.length + suffix.length;
  const mergeable = same >= Math.ceil(Math.min(a.length, b.length) * SIMILAR_RATIO);
  return { prefix, changed, suffix, mergeable };
}

/** 两步是否「同一类、只差参数」——可以直接合并成一组 */
export function canMergePair(previous: MatchableStep, current: MatchableStep): boolean {
  if (previous.kind !== "tool" || current.kind !== "tool") return false;
  if (previous.key !== current.key) return false;
  if (!previous.target || !current.target) return false;
  return Boolean(matchTarget(previous.target, current.target)?.mergeable);
}

/** 一组步骤的共同前后缀（只有中间那段在变） */
export function runAffixes(steps: MatchableStep[]): { prefix: string; suffix: string; values: string[] } {
  if (!steps.length) return { prefix: "", suffix: "", values: [] };
  const targets = steps.map((step) => step.target);
  let prefix = targets[0]!;
  let suffix = "";
  // 前缀：所有串的公共开头
  for (const target of targets.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < target.length && prefix[index] === target[index]) index += 1;
    prefix = prefix.slice(0, index);
  }
  // 后缀：所有串在「去掉公共前缀之后」的公共结尾
  const rest = targets.map((target) => target.slice(prefix.length));
  if (rest.some((part) => !part)) return { prefix: "", suffix: "", values: targets };
  suffix = rest[0]!;
  for (const part of rest.slice(1)) {
    let index = 0;
    while (index < suffix.length && index < part.length && suffix[suffix.length - 1 - index] === part[part.length - 1 - index]) index += 1;
    suffix = suffix.slice(suffix.length - index);
  }
  const values = rest.map((part) => part.slice(0, part.length - (suffix ? suffix.length : 0)));
  return { prefix, suffix, values };
}

/** 把变化段压成 `{1..4}` / `{a|b|c}`；单调数字用区间更好读 */
export function compactValues(values: string[]): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return "";
  const numbers = unique.map((value) => (/^\d+$/.test(value) ? Number(value) : Number.NaN));
  if (numbers.every((value) => Number.isFinite(value))) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const step = sorted.length > 1 ? sorted[1]! - sorted[0]! : 1;
    const consecutive = sorted.every((value, index) => index === 0 || value - sorted[index - 1]! === step);
    if (consecutive && step === 1 && sorted.length > 1) return `${sorted[0]}..${sorted[sorted.length - 1]}`;
    const listed = sorted.length === unique.length ? sorted.map(String) : unique;
    return listed.length > 3 ? `${listed.slice(0, 3).join("|")}|…` : listed.join("|");
  }
  const shown = unique.slice(0, 3).join("|");
  return unique.length > 3 ? `${shown}|…` : shown;
}

/** 把一组步骤的增删行数加起来；全是 null 时返回 null（不显示） */
export function sumStat(steps: MatchableStep[], field: "added" | "removed"): number | null {
  let total = 0;
  let seen = false;
  for (const step of steps) {
    const value = step[field];
    if (typeof value === "number") {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

/** 一组合并后的显示摘要：`cat > …/_ap{1..4}.cjs` */
export function runTarget(steps: MatchableStep[]): string {
  const { prefix, suffix, values } = runAffixes(steps);
  if (!prefix && !suffix) return `${compactValues(values)} ×${steps.length}`;
  return `${prefix}{${compactValues(values)}}${suffix}`;
}

/**
 * 把时间线步骤排成显示行。
 *
 * `merge` 关掉时只做淡化（每步一行、相邻同工具的比较前缀）；打开时连续 ≥ 3 步
 * 的同类步骤收成一行。
 */
export function buildTimelineRows<T extends MatchableStep>(
  steps: readonly T[],
  options: { merge: boolean; minRun?: number } = { merge: true },
): TimelineRow<T>[] {
  const minRun = Math.max(2, options.minRun ?? MERGE_MIN_STEPS);
  const rows: TimelineRow<T>[] = [];
  let run: T[] = [];
  // 行在时间线上的起始序号（1 基），合并行一次占 N 步
  let cursor = 0;

  const flush = (): void => {
    if (!run.length) return;
    if (options.merge && run.length >= minRun) {
      cursor += 1;
      rows.push({
        kind: "run",
        steps: run,
        target: runTarget(run),
        failed: run.some((step) => step.failed),
        live: run.some((step) => step.live),
        added: sumStat(run, "added"),
        removed: sumStat(run, "removed"),
        startIndex: cursor,
      });
      cursor += run.length - 1;
    } else {
      // 不合并时仍然逐步显示，但保留相邻同类的「淡化前缀」信息
      run.forEach((step, index) => {
        const previous = index > 0 ? run[index - 1] : undefined;
        const match = previous ? matchTarget(previous.target, step.target) : null;
        cursor += 1;
        rows.push({ kind: "step", step, match: match?.mergeable ? match : undefined, startIndex: cursor });
      });
    }
    run = [];
  };

  for (const step of steps) {
    if (!run.length) {
      run.push(step);
      continue;
    }
    if (canMergePair(run[run.length - 1]!, step)) {
      run.push(step);
      continue;
    }
    flush();
    run.push(step);
  }
  flush();
  return rows;
}
