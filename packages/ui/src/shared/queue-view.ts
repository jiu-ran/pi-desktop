/**
 * 「排队中」消息的展示规则。
 *
 * 问题：流式期间发出去的消息会先乐观渲染成气泡（这是必要的，否则引导消息要等重开
 * 会话才看得见），但 Pi 的队列里同一句话还在，于是输入框上方又显示一遍「待发送」，
 * 同一条消息在界面上出现两次。
 *
 * 规则（0.2.8 起）：还排在队列里的消息**只在输入框上方**显示成「待发送」卡片，
 * 对话里那条乐观渲染的气泡暂时隐藏——两者同时出现会让同一条消息看起来发了两遍。
 * 等它真正被 Pi 取走（队列里没有了），对话里的气泡才出现。
 */

import { splitPromptMessage } from "./queue-prompt.ts";

export interface QueueState {
  steering: string[];
  followUp: string[];
}

export interface QueueBlockLike {
  id: string;
  kind?: string;
  /** 气泡上显示的文字（已剥离附件标记） */
  text?: string;
  /** 实际发给模型的完整提示词（含 <file> 等附件块）；Pi 的队列里存的是这个 */
  queueText?: string;
}

export type QueueMode = "steer" | "followUp";

export interface QueuedEntry {
  mode: QueueMode;
  text: string;
}

export interface QueuePlan {
  /** 输入框上方要列出的待发送条目（按 Pi 的队列顺序，含插话与排队） */
  entries: QueuedEntry[];
  /** 对话里应该暂时隐藏的乐观气泡 id（它们的内容已经在上面列出来了） */
  hiddenIds: string[];
}

function normalize(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/** 计算输入框上方的待发送列表，以及对话里需要暂时隐藏的气泡。 */
export function planQueueView(blocks: QueueBlockLike[], queue: QueueState | null | undefined): QueuePlan {
  const entries: QueuedEntry[] = [
    ...(queue?.steering ?? []).map((text) => ({ mode: "steer" as const, text })),
    ...(queue?.followUp ?? []).map((text) => ({ mode: "followUp" as const, text })),
  ];
  const used = new Set<string>();
  const hiddenIds: string[] = [];
  for (const entry of entries) {
    const target = normalize(entry.text);
    // 队列里存的是完整提示词（附件也在里面），所以优先按 queueText 比；
    // 历史消息没有 queueText，退回按显示文字比。
    const match = (blocks ?? []).find(
      (block) =>
        (block.kind === undefined || block.kind === "user") &&
        !used.has(block.id) &&
        (normalize(block.queueText ?? "") === target ||
          (normalize(block.queueText ?? "") === "" && normalize(block.text ?? "") === target)),
    );
    if (!match) continue;
    used.add(match.id);
    hiddenIds.push(match.id);
  }
  return { entries, hiddenIds };
}

/** 提示词里的附件块换成可读标签：排队卡片上不能铺一坨 XML。 */
export function stripQueueMarkers(input: string): string {
  return String(input ?? "")
    .replace(/<(file|directory|session) name="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g, (_match, tag: string, name: string) => {
      const label = tag === "directory" ? "目录" : tag === "session" ? "对话" : "文件";
      return `[${label}: ${name}]`;
    })
    .trim();
}

/** 队列卡片的单行预览：多行压成一行，过长截断。 */
export function queuePreview(input: string, limit = 80): string {
  const text = stripQueueMarkers(input).replace(/\s+/g, " ").trim();
  if (!text) return "（无文字内容）";
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

// 提示词拼装放在 queue-prompt.ts（纯函数、可单测）；这里转出去，调用方不用改 import。
export {
  joinPromptBlocks,
  rebuildPrompt,
  replacePromptMessage,
  splitPromptBlocks,
  splitPromptMessage,
  type PromptBlock,
} from "./queue-prompt.ts";

/** 算出编辑后的队列（保持原顺序；插话与追加分开）。 */
export function planQueueEdit(
  queue: QueueState,
  target: QueuedEntry,
  newText: string,
): QueueState {
  const normalizeText = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const wanted = normalizeText(target.text);
  const map = (list: string[]) =>
    list.map((item) => (normalizeText(item) === wanted ? newText : item));
  return {
    steering: target.mode === "steer" ? map(queue.steering) : [...queue.steering],
    followUp: target.mode === "followUp" ? map(queue.followUp) : [...queue.followUp],
  };
}

/** 撤回单条排队消息：只在它所属的那一列里去掉第一条匹配项。 */
export function planQueueWithdraw(queue: QueueState, target: QueuedEntry): QueueState {
  const normalizeText = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const wanted = normalizeText(target.text);
  const drop = (list: string[]): string[] => {
    const index = list.findIndex((item) => normalizeText(item) === wanted);
    if (index < 0) return [...list];
    return [...list.slice(0, index), ...list.slice(index + 1)];
  };
  return {
    steering: target.mode === "steer" ? drop(queue.steering) : [...queue.steering],
    followUp: target.mode === "followUp" ? drop(queue.followUp) : [...queue.followUp],
  };
}

/**
 * 已经离开队列的乐观气泡要挪到时间线末尾。
 *
 * 排队期间这条气泡是隐藏的（内容在输入框上方），但它在 blocks 里的位置停在
 * 「入队那一刻」——上一轮还在继续输出，后面的块都排在它下面。等它真正被 Pi 取走、
 * 重新显示出来时，就会插在上一轮输出的中间（用户看到的就是「顺序乱了」）。
 *
 * 返回需要移动到末尾的气泡 id（已在末尾的不动）。只处理队列刚发出的那批：
 * 队列还存在气泡按 queueText 对不上；发出去的则一定对得上。
 */
export function planQueuedFlush(
  blocks: QueueBlockLike[],
  previous: QueueState | null | undefined,
  next: QueueState | null | undefined,
): string[] {
  const before = [...(previous?.steering ?? []), ...(previous?.followUp ?? [])].map(normalize);
  const after = new Set([...(next?.steering ?? []), ...(next?.followUp ?? [])].map(normalize));
  // 只有「上一轮队列里有、这一轮没了」的那几条才是刚被取走发出去的。
  // 不能用「不在当前队列里的 queueText」来判断：历史消息也带 queueText，会被一起重排。
  const sent = new Set(before.filter((text) => !after.has(text)));
  if (!sent.size) return [];
  const lastIndex = (blocks?.length ?? 0) - 1;
  const ids: string[] = [];
  (blocks ?? []).forEach((block, index) => {
    if (block.kind !== undefined && block.kind !== "user") return;
    const key = normalize(block.queueText ?? "");
    if (!key || !sent.has(key)) return;
    if (index === lastIndex) return;
    ids.push(block.id);
  });
  return ids;
}

/** 队列里每条消息带的图片（Pi 的队列只回传文本，重新入队时必须自己带上图片）。 */
export interface QueuedImage {
  mimeType: string;
  data: string;
}

export interface QueueImageBlockLike {
  kind?: string;
  queueText?: string;
  imageItems?: QueuedImage[];
}

/**
 * 按「完整提示词」收集排队气泡上的图片。
 *
 * Pi 的 clearQueue 只返回文本，图片是单独的数组（steer(message, images)）。
 * 重新入队（编辑 / 单条撤回）时如果不把图片带回去，图片就丢了；反过来，
 * 给每条都塞同一组图片又会出现「图片又被添加了一次」的重复。
 * 所以按提示词文本一一对应地取。
 */
export function queueImagesByPrompt(blocks: QueueImageBlockLike[]): Record<string, QueuedImage[]> {
  const map: Record<string, QueuedImage[]> = {};
  for (const block of blocks ?? []) {
    if (block.kind !== undefined && block.kind !== "user") continue;
    const key = normalize(block.queueText ?? "");
    if (!key || map[key]) continue;
    const images = block.imageItems ?? [];
    if (!images.length) continue;
    map[key] = images.map((item) => ({ mimeType: item.mimeType, data: item.data }));
  }
  return map;
}

/** 撤回后放回输入框的文本：只留人写的那部分，别把附件 XML 塞回去。 */
/**
 * 编辑框 / 退回输入框时用的「用户文字」：只取最后一段人写的话。
 *
 * 不能走 stripQueueMarkers —— 那会把附件块换成展示用的 `[文件: C:\…\a.png]` 标签，
 * 预填进编辑框再保存就会在提示词里多出一份图片路径（气泡上看到两条重复路径）。
 */
export function queueDraftText(input: string): string {
  return splitPromptMessage(String(input ?? "")).message.replace(/\n{3,}/g, "\n\n").trim();
}
