import type { TranscriptBlock } from "../kernel/transcript.ts";

/**
 * 按“一轮用户提问”聚合回复文本，返回 key = 该轮最后一个文本块下标的复制内容。
 * 本轮还在流式输出时不提供复制文本，避免用户复制到半截回复。
 */
export function buildCopyTexts(
  blocks: readonly TranscriptBlock[],
  streaming: boolean,
): Map<number, string> {
  const result = new Map<number, string>();
  let parts: string[] = [];
  let last = -1;
  const finish = () => {
    if (last >= 0 && !streaming && !blocks[last]?.streaming) result.set(last, parts.join("\n\n"));
    parts = [];
    last = -1;
  };
  blocks.forEach((block, index) => {
    if (block.kind === "user") finish();
    else if (block.kind === "text" && block.text?.trim()) {
      parts.push(block.text);
      last = index;
    }
  });
  finish();
  return result;
}
