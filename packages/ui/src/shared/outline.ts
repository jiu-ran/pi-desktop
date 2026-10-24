/**
 * 对话右侧大纲：根据滚动位置决定高亮哪一轮用户消息。
 *
 * 之前只按「顶部已经越过视口顶边」判断，内容短或活动组折叠后，最后一条用户消息
 * 可能永远越不过那条线——滚到底也只有倒数第二轮被点亮。
 */
export function activeOutlineIndex(
  tops: readonly number[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  if (!tops.length) return -1;
  // 已经在底部（留 4px 容差）：直接标最后一轮，短会话也能亮对。
  if (scrollTop + clientHeight >= scrollHeight - 4) return tops.length - 1;
  const line = scrollTop + 8;
  let active = 0;
  for (let index = 0; index < tops.length; index += 1) {
    if (tops[index]! <= line) active = index;
    else break;
  }
  return active;
}
