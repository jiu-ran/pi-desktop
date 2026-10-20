import { splitAttachmentMarkers, type MessageAttachment } from "../shared/attachments.ts";

export interface TranscriptBlock {
  kind: "user" | "text" | "thinking" | "tool" | "notice";
  id: string;
  text?: string;
  images?: number;
  /** 用户消息里的图片（用于缩略图展示） */
  imageItems?: Array<{ mimeType: string; data: string }>;
  /** 用户消息里被抽离出来的附件标记 */
  attachments?: MessageAttachment[];
  streaming?: boolean;
  name?: string;
  args?: Record<string, any>;
  status?: "pending" | "running" | "done" | "error";
  output?: string;
  details?: any;
  isError?: boolean;
  durationMs?: number | null;
  level?: string;
  local?: boolean;
  usageText?: string;
}

function textOf(content: any): string {
  if (typeof content === "string") return content;
  return (content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("");
}

/** 用户消息：剥离附件标记，并收集图片数据用于缩略图 */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
/** 单张图片缩略图的数据上限，超出的只显示张数，避免长会话占用过多内存 */
const IMAGE_PREVIEW_MAX = 8 * 1024 * 1024;
function userBlock(content: any): Omit<TranscriptBlock, "id"> {
  const { text, attachments } = splitAttachmentMarkers(textOf(content));
  const imageParts = (Array.isArray(content) ? content : []).filter((part: any) => part?.type === "image");
  const imageItems = imageParts
    .filter((part: any) => typeof part.data === "string" && part.data.length <= IMAGE_PREVIEW_MAX)
    .map((part: any) => ({ mimeType: String(part.mimeType ?? "image/png"), data: part.data as string }));
  // 有图片时不再重复展示同名的图片文件徽标
  const files = imageParts.length
    ? attachments.filter((item) => item.kind === "folder" || !IMAGE_EXT.test(item.path))
    : attachments;
  return {
    kind: "user",
    text,
    images: imageParts.length,
    imageItems,
    attachments: files,
  };
}

function resultText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (!Array.isArray(result.content)) return "";
  return result.content.map((part: any) => part?.text ?? "").join("\n");
}

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

export function createTranscript(wrap: <T extends any[]>(arr: T) => T = (arr) => arr) {
  const blocks = wrap<TranscriptBlock[]>([]);
  const tools = new Map<string, TranscriptBlock>();
  let live: Map<number, TranscriptBlock> | null = null;

  function pushTool(id: string, name: string, args: any, status: TranscriptBlock["status"]): TranscriptBlock {
    let block = tools.get(id);
    if (!block) {
      blocks.push({ kind: "tool", id, name, args: args ?? {}, status, output: "", details: null, isError: false, durationMs: null });
      block = blocks[blocks.length - 1];
      tools.set(id, block);
    } else {
      if (args && Object.keys(args).length) block.args = args;
      if (name) block.name = name;
    }
    return block;
  }

  function loadMessages(messages: any[]): void {
    blocks.length = 0;
    tools.clear();
    live = null;
    for (const message of messages ?? []) appendMessage(message);
  }

  function appendMessage(message: any): void {
    if (message.role === "user") {
      const block = userBlock(message.content);
      if (block.text || block.images || block.attachments?.length) blocks.push({ ...block, id: uid("u") });
      return;
    }
    if (message.role === "assistant") {
      for (const part of message.content ?? []) {
        if (part.type === "thinking" && part.thinking?.trim()) {
          blocks.push({ kind: "thinking", id: uid("th"), text: part.thinking, streaming: false });
        } else if (part.type === "text" && part.text?.trim()) {
          blocks.push({ kind: "text", id: uid("tx"), text: part.text, streaming: false });
        } else if (part.type === "toolCall") {
          pushTool(part.id, part.name, part.arguments, "done");
        }
      }
      if (message.stopReason === "error" && message.errorMessage) {
        blocks.push({ kind: "notice", id: uid("n"), level: "error", text: message.errorMessage });
      }
      return;
    }
    if (message.role === "toolResult") {
      const block = pushTool(message.toolCallId, message.toolName, null, "done");
      block.output = resultText(message);
      block.details = message.details ?? null;
      block.isError = Boolean(message.isError);
      block.status = message.isError ? "error" : "done";
      block.durationMs = message.durationMs ?? null;
    }
  }

  function liveBlock(index: number, kind: "text" | "thinking"): TranscriptBlock {
    live ??= new Map();
    let block = live.get(index);
    if (!block) {
      blocks.push({ kind, id: uid(kind === "text" ? "tx" : "th"), text: "", streaming: true });
      block = blocks[blocks.length - 1];
      live.set(index, block);
    }
    return block;
  }

  function finalizeLive(partial = true): void {
    for (const block of live?.values() ?? []) {
      block.streaming = false;
      if (partial) block.details = { ...(block.details ?? {}), partial: true };
    }
    live = null;
  }

  function settleRunningTools(): boolean {
    let changed = false;
    for (const block of blocks) {
      if (block.kind !== "tool" || (block.status !== "pending" && block.status !== "running")) continue;
      block.status = "done";
      changed = true;
    }
    return changed;
  }

  function applyEvent(event: any): boolean {
    switch (event.type) {
      case "message_start":
        if (event.message?.role === "assistant") live = new Map();
        return false;
      case "message_update": {
        const update = event.assistantMessageEvent ?? {};
        if (update.type === "text_delta") {
          const b = liveBlock(update.contentIndex, "text");
          b.text = (b.text ?? "") + update.delta;
        } else if (update.type === "thinking_delta") {
          const b = liveBlock(update.contentIndex, "thinking");
          b.text = (b.text ?? "") + update.delta;
        } else if (update.type === "text_end") liveBlock(update.contentIndex, "text").text = update.content ?? "";
        else if (update.type === "thinking_end") liveBlock(update.contentIndex, "thinking").text = update.content ?? "";
        else if (update.type === "toolcall_start") pushTool(update.id, update.toolName, null, "pending");
        else if (update.type === "toolcall_delta") {
          const block = pushTool(update.id ?? update.toolCallId, update.toolName, null, "pending");
          const raw = update.delta ?? update.argumentsDelta ?? "";
          if (raw) {
            const current = typeof block.details?.streamedArgs === "string" ? block.details.streamedArgs : "";
            block.details = { ...(block.details ?? {}), streamedArgs: `${current}${raw}` };
          }
        } else if (update.type === "toolcall_end" && update.toolCall) {
          pushTool(update.toolCall.id, update.toolCall.name, update.toolCall.arguments, "pending");
        } else return false;
        return true;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") return false;
        finalizeLive(false);
        for (let i = blocks.length - 1; i >= 0; i -= 1) {
          const block = blocks[i];
          if ((block.kind === "text" || block.kind === "thinking") && !(block.text ?? "").trim()) blocks.splice(i, 1);
        }
        if (event.message.stopReason === "error" && event.message.errorMessage) {
          blocks.push({ kind: "notice", id: uid("n"), level: "error", text: event.message.errorMessage });
        }
        return true;
      }
      case "agent_settled":
      case "abort":
      case "error":
      case "agent_error": {
        const hadLive = Boolean(live);
        if (hadLive) finalizeLive(true);
        return settleRunningTools() || hadLive;
      }
      case "tool_execution_start": {
        const block = pushTool(event.toolCallId, event.toolName, event.args, "running");
        block.status = "running";
        return true;
      }
      case "tool_execution_update": {
        const block = pushTool(event.toolCallId, event.toolName, event.args, "running");
        block.output = resultText(event.partialResult);
        return true;
      }
      case "tool_execution_end": {
        const block = pushTool(event.toolCallId, event.toolName, null, "done");
        block.output = resultText(event.result);
        block.details = event.result?.details ?? null;
        block.isError = Boolean(event.isError);
        block.status = event.isError ? "error" : "done";
        block.durationMs = event.durationMs ?? null;
        return true;
      }
      case "auto_retry_start":
        blocks.push({ kind: "notice", id: uid("n"), level: "warning", text: `第 ${event.attempt}/${event.maxAttempts} 次重试：${event.errorMessage ?? ""}` });
        return true;
      case "compaction_end":
        if (event.result) {
          blocks.push({ kind: "notice", id: uid("n"), level: "info", text: `上下文已压缩：${event.result.tokensBefore} → ${event.result.estimatedTokensAfter} tokens` });
          return true;
        }
        return false;
      case "extension_error":
        blocks.push({ kind: "notice", id: uid("n"), level: "error", text: `扩展出错：${event.error}` });
        return true;
      default:
        return false;
    }
  }

  function pushUser(text: string, images = 0, extra: Pick<TranscriptBlock, "imageItems" | "attachments"> = {}): TranscriptBlock {
    const block: TranscriptBlock = { kind: "user", id: uid("u"), text, images, ...extra };
    blocks.push(block);
    return block;
  }

  /** 发送失败时撤回乐观渲染的用户消息，避免界面留下一条实际没发出去的消息。 */
  function removeBlock(id: string): void {
    const index = blocks.findIndex((block) => block.id === id);
    if (index >= 0) blocks.splice(index, 1);
  }

  function pushNotice(level: string, text: string): void {
    blocks.push({ kind: "notice", id: uid("n"), level, text, local: true });
  }

  function attachUsage(text: string): void {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.kind === "user") break;
      if (block.kind === "text") {
        block.usageText = text;
        return;
      }
    }
  }

  function prependMessages(messages: any[]): void {
    const newBlocks: TranscriptBlock[] = [];
    for (const message of messages ?? []) {
      if (message.role === "user") {
        const block = userBlock(message.content);
        if (block.text || block.images || block.attachments?.length) newBlocks.push({ ...block, id: uid("u") });
      } else if (message.role === "assistant") {
        for (const part of message.content ?? []) {
          if (part.type === "thinking" && part.thinking?.trim()) {
            newBlocks.push({ kind: "thinking", id: uid("th"), text: part.thinking, streaming: false });
          } else if (part.type === "text" && part.text?.trim()) {
            newBlocks.push({ kind: "text", id: uid("tx"), text: part.text, streaming: false });
          } else if (part.type === "toolCall") {
            const existing = tools.get(part.id);
            if (existing && blocks.includes(existing)) {
              // 之前只看到 toolResult 而建过占位块，复用并把它移到正确位置
              blocks.splice(blocks.indexOf(existing), 1);
              existing.name = part.name ?? existing.name;
              existing.args = part.arguments ?? existing.args ?? {};
              newBlocks.push(existing);
            } else {
              const block: TranscriptBlock = { kind: "tool", id: part.id, name: part.name, args: part.arguments ?? {}, status: "done", output: "", details: null, isError: false, durationMs: null };
              newBlocks.push(block);
              tools.set(part.id, block);
            }
          }
        }
      } else if (message.role === "toolResult") {
        let block = tools.get(message.toolCallId);
        if (!block) {
          block = { kind: "tool", id: message.toolCallId, name: message.toolName, args: {}, status: "done", output: "", details: null, isError: false, durationMs: null };
          tools.set(message.toolCallId, block);
          newBlocks.push(block);
        }
        block.output = resultText(message);
        block.details = message.details ?? null;
        block.isError = Boolean(message.isError);
        block.status = message.isError ? "error" : "done";
        block.durationMs = message.durationMs ?? null;
      }
    }
    blocks.unshift(...newBlocks);
  }

  return { blocks, loadMessages, applyEvent, pushUser, pushNotice, attachUsage, prependMessages, removeBlock };
}
