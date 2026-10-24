import type { TranscriptBlock } from "../kernel/transcript.ts";

/** 这一步是否还在进行中（流式文本、运行中 / 待执行的工具）。 */
function isLive(block: TranscriptBlock): boolean {
  return Boolean(block.streaming) || block.status === "running" || block.status === "pending";
}

/**
 * 按"一轮用户提问"聚合回复文本，返回 key = 该轮最后一个文本块下标的复制内容。
 *
 * 只有这一轮真正结束才提供复制：
 *   - 会话级的 streaming 标记（最后一轮才参考，否则新一轮一开始就会把历史回复的
 *     复制按钮全藏起来）；
 *   - 该轮里是否还有运行中 / 待执行的工具或流式文本——标记来自事件流，时序稍一滞后
 *     就会出现「回复没结束、复制按钮已经出现」，用块自身状态兜底。
 */
export function buildCopyTexts(
  blocks: readonly TranscriptBlock[],
  streaming: boolean,
): Map<number, string> {
  const result = new Map<number, string>();
  let parts: string[] = [];
  let last = -1;
  let segmentLive = false;

  const finish = (isCurrentTurn: boolean) => {
    const stillRunning = segmentLive || (isCurrentTurn && streaming);
    if (last >= 0 && !stillRunning && !blocks[last]?.streaming) {
      result.set(last, parts.join("\n\n"));
    }
    parts = [];
    last = -1;
    segmentLive = false;
  };

  blocks.forEach((block, index) => {
    if (block.kind === "user") {
      finish(false);
      return;
    }
    if (block.kind === "text" && block.text?.trim()) {
      parts.push(block.text);
      last = index;
    }
    if (isLive(block)) segmentLive = true;
  });
  finish(true);
  return result;
}
