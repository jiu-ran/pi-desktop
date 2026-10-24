/**
 * 「排队中」消息的展示规则。
 *
 * 问题：流式期间发出去的消息会先乐观渲染成气泡（这是必要的，否则引导消息要等重开
 * 会话才看得见），但 Pi 的队列里同一句话还在，于是输入框上方又显示一遍「待发送」，
 * 同一条消息在界面上出现两次。
 *
 * 规则：气泡是唯一的表现形式。队列里能对上气泡的条目不再单独显示；
 * 对不上的（别的客户端排进来的、或消息还没渲染）才显示成待发送卡片。
 */

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
  /** 队列里还没有对应气泡的条目 */
  pending: QueuedEntry[];
  /** 已经有气泡、需要标成「排队中」的气泡 id */
  queuedIds: string[];
}

function normalize(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/** 计算待发送列表与「排队中」标记。 */
export function planQueueView(blocks: QueueBlockLike[], queue: QueueState | null | undefined): QueuePlan {
  const entries: QueuedEntry[] = [
    ...(queue?.steering ?? []).map((text) => ({ mode: "steer" as const, text })),
    ...(queue?.followUp ?? []).map((text) => ({ mode: "followUp" as const, text })),
  ];
  const used = new Set<string>();
  const queuedIds: string[] = [];
  const pending: QueuedEntry[] = [];
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
    if (match) {
      used.add(match.id);
      queuedIds.push(match.id);
    } else {
      pending.push(entry);
    }
  }
  return { pending, queuedIds };
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

/** 撤回后放回输入框的文本：只留人写的那部分，别把附件 XML 塞回去。 */
export function queueDraftText(input: string): string {
  return stripQueueMarkers(input).replace(/\n{3,}/g, "\n\n").trim();
}
