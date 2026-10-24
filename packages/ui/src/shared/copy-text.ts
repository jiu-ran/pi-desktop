import type { TranscriptBlock } from "../kernel/transcript.ts";

/** 这一步是否还在进行中（流式文本、运行中 / 待执行的工具）。 */
function isLive(block: TranscriptBlock): boolean {
  return Boolean(block.streaming) || block.status === "running" || block.status === "pending";
}

/**
 * 复制按钮只出现在整段对话的最后一段回复下面。
 *
 * 以前按「一轮用户消息」分组，每组最后一段文本都给一个复制按钮。问题是：
 *   - 引导（steering）消息会把一轮拆成多段，按钮于是落在对话中间；
 *   - 工具链很长时，中间那几段文本看起来也不像"可以复制的结果"。
 * 现在只保留最后一条用户消息之后的那段回复，且必须真的结束（没有流式文本、
 * 没有运行中 / 待执行的工具）才给。
 */
export function buildCopyTexts(
  blocks: readonly TranscriptBlock[],
  streaming: boolean,
): Map<number, string> {
  const result = new Map<number, string>();
  if (streaming) return result;

  let lastUser = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === "user") {
      lastUser = index;
      break;
    }
  }
  const tail = blocks.slice(lastUser + 1);
  if (!tail.length) return result;
  if (tail.some(isLive)) return result;

  const texts = tail.filter((block) => block.kind === "text" && block.text?.trim());
  const lastText = texts.at(-1);
  if (!lastText) return result;
  const index = blocks.lastIndexOf(lastText);
  if (index < 0) return result;
  result.set(index, texts.map((block) => block.text).join("\n\n"));
  return result;
}
