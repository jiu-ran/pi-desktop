/**
 * 把上游的压缩失败信息翻成人话。
 *
 * 上游（pi-coding-agent）在写摘要时如果模型的 `stopReason` 是 `length`，会报
 * `Summarization failed: generation hit the token cap and the summary is incomplete`。
 * 这句话对用户完全不可操作，所以这里给出「为什么 + 怎么办」，原始英文留在
 * 提示的 hover 里，排查时仍然拿得到。
 */
export interface CompactionFailureExplanation {
  /** 一句人话的原因 */
  reason: string;
  /** 一句可操作的建议 */
  hint: string;
}

const RAW = (message: string): string => String(message ?? "").trim();

/**
 * 已知的几种失败；匹配不上的返回 null，调用方保留原文（不要瞎猜）。
 */
export function explainCompactionFailure(message: string | null | undefined): CompactionFailureExplanation | null {
  const raw = RAW(message ?? "");
  if (!raw) return null;

  // 摘要被输出上限截断：多半是思考等级太高，推理把输出预算吃掉了
  if (/hit the token cap|summary is incomplete/i.test(raw)) {
    return {
      reason: "写摘要时撞到模型的输出上限，摘要被截断了",
      hint: "多半是思考等级把输出预算花在推理上；已自动用 off 重试一次，仍不行就把默认思考等级调低，或换输出上限更大的模型",
    };
  }

  // 摘要请求本身失败（网络 / 鉴权 / 模型不可用）
  if (/Summarization failed/i.test(raw)) {
    return {
      reason: "写摘要的模型调用失败了",
      hint: "检查模型是否可用、额度是否用尽；网络或限流恢复后再试一次",
    };
  }

  // 上下文本身太大，切不出可总结的片段
  if (/context (window|length)|too (large|long) to (summar|compact)/i.test(raw)) {
    return {
      reason: "上下文超出模型能处理的范围",
      hint: "先手动删掉几条无关的长输出（或新开一个任务），再重新压缩",
    };
  }

  if (/aborted|cancell?ed/i.test(raw)) {
    return { reason: "压缩被取消了", hint: "需要时再执行一次 /compact" };
  }

  return null;
}

/** 提示里显示的正文：有解释就用解释，没有就保留原文 */
export function compactionFailureText(message: string | null | undefined): string {
  const raw = RAW(message ?? "");
  const explained = explainCompactionFailure(raw);
  if (!explained) return `上下文压缩失败${raw ? `：${raw}` : ""}`;
  return `上下文压缩失败：${explained.reason} —— ${explained.hint}`;
}
