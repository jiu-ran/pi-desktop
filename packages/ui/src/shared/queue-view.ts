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

/**
 * 编辑排队中的消息：把「这一段提示词末尾的用户文字」换成新文字。
 *
 * Pi 的队列里存的是完整提示词（前面可能带 <file> / <session> 上下文），
 * 用户编辑的是自己写的那部分，所以只能替换末尾，前面原样保留。
 * 找不到对应文字时（例如纯附件消息）退回用新文字，避免把别人的上下文弄坏。
 */
export function replacePromptMessage(prompt: string, oldMessage: string, newMessage: string): string {
  const text = String(prompt ?? "");
  const oldText = String(oldMessage ?? "");
  const next = String(newMessage ?? "");
  const { prefix, message } = splitPromptMessage(text);
  const same = normalizeLine(message) === normalizeLine(oldText);
  if (!prefix) return same || !message ? next : next;
  // 附件 / 引用上下文原样保留，只替换后面那段用户文字
  return `${prefix}\n${next}`;
}

function normalizeLine(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * 把提示词拆成「自动附带的上下文」与「用户写的文字」。
 *
 * Pi 的队列里存的是完整提示词，用户编辑的是后半段；之前直接按「末尾是否相等」判断，
 * 一旦带附件或引用（末尾对不上）就会整段丢掉上下文 —— 这里按最后一个
 * `</file>` / `</directory>` / `</session>` 切开，保证上下文永远保留。
 */
export function splitPromptMessage(prompt: string): { prefix: string; message: string } {
  const text = String(prompt ?? "");
  let lastEnd = -1;
  for (const match of text.matchAll(/<\/(?:file|directory|session)>/g)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) return { prefix: "", message: text.trim() };
  return { prefix: text.slice(0, lastEnd), message: text.slice(lastEnd).trim() };
}

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

/** 撤回后放回输入框的文本：只留人写的那部分，别把附件 XML 塞回去。 */
export function queueDraftText(input: string): string {
  return stripQueueMarkers(input).replace(/\n{3,}/g, "\n\n").trim();
}
