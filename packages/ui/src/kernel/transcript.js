/**
 * Transcript 投影：把 Pi 的 AgentMessage 与流式事件折叠成统一的「块」列表。
 * 渲染插件只认块的结构，不认 RPC 协议。
 *
 * 块类型：
 *   { kind: "user",      id, text, images }
 *   { kind: "text",      id, text, streaming }
 *   { kind: "thinking",  id, text, streaming }
 *   { kind: "tool",      id, name, args, status, output, isError, durationMs }
 *   { kind: "notice",    id, level, text }
 */

function textOf(content) {
  if (typeof content === "string") return content;
  return (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
}

function resultText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  return (result.content ?? []).map((part) => part.text ?? "").join("\n");
}

let seq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

/**
 * @param {(arr: any[]) => any[]} [wrap] 外部传入的响应式包装（如 Vue reactive）。
 *   投影层必须在响应式数组上直接修改，否则界面感知不到变化。
 *   不传时是普通数组，便于在 Node 里测试。
 */
export function createTranscript(wrap = (arr) => arr) {
  /** @type {Array<any>} */
  const blocks = wrap([]);
  const tools = new Map();
  // 当前流式助手消息：contentIndex -> block
  let live = null;

  function pushTool(id, name, args, status) {
    let block = tools.get(id);
    if (!block) {
      blocks.push({ kind: "tool", id, name, args: args ?? {}, status, output: "", details: null, isError: false, durationMs: null });
      // 取回数组里的元素：响应式数组里是代理对象，修改它才能触发更新
      block = blocks[blocks.length - 1];
      tools.set(id, block);
    } else {
      if (args && Object.keys(args).length) block.args = args;
      if (name) block.name = name;
    }
    return block;
  }

  function loadMessages(messages) {
    blocks.length = 0;
    tools.clear();
    live = null;
    for (const message of messages ?? []) appendMessage(message);
  }

  function appendMessage(message) {
    if (message.role === "user") {
      const text = textOf(message.content);
      const images = Array.isArray(message.content) ? message.content.filter((p) => p.type === "image").length : 0;
      if (text || images) blocks.push({ kind: "user", id: uid("u"), text, images });
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

  function liveBlock(index, kind) {
    live ??= new Map();
    let block = live.get(index);
    if (!block) {
      blocks.push({ kind, id: uid(kind === "text" ? "tx" : "th"), text: "", streaming: true });
      block = blocks[blocks.length - 1];
      live.set(index, block);
    }
    return block;
  }

  /** 返回 true 表示块列表发生了变化。 */
  function applyEvent(event) {
    switch (event.type) {
      case "message_start":
        if (event.message?.role === "assistant") live = new Map();
        return false;
      case "message_update": {
        const update = event.assistantMessageEvent ?? {};
        if (update.type === "text_delta") liveBlock(update.contentIndex, "text").text += update.delta;
        else if (update.type === "thinking_delta") liveBlock(update.contentIndex, "thinking").text += update.delta;
        else if (update.type === "text_end") liveBlock(update.contentIndex, "text").text = update.content ?? "";
        else if (update.type === "thinking_end") liveBlock(update.contentIndex, "thinking").text = update.content ?? "";
        else if (update.type === "toolcall_start") pushTool(update.id, update.toolName, null, "pending");
        else if (update.type === "toolcall_end" && update.toolCall) {
          pushTool(update.toolCall.id, update.toolCall.name, update.toolCall.arguments, "pending");
        } else return false;
        return true;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") return false;
        for (const block of live?.values() ?? []) block.streaming = false;
        // 移除没有内容的空块
        for (let i = blocks.length - 1; i >= 0; i -= 1) {
          const block = blocks[i];
          if ((block.kind === "text" || block.kind === "thinking") && !block.text.trim()) blocks.splice(i, 1);
        }
        if (event.message.stopReason === "error" && event.message.errorMessage) {
          blocks.push({ kind: "notice", id: uid("n"), level: "error", text: event.message.errorMessage });
        }
        live = null;
        return true;
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

  function pushUser(text, images = 0) {
    blocks.push({ kind: "user", id: uid("u"), text, images });
  }

  /** 桌面端本地提示（如 /session 的结果），不写入 Pi 会话 */
  function pushNotice(level, text) {
    blocks.push({ kind: "notice", id: uid("n"), level, text, local: true });
  }

  return { blocks, loadMessages, applyEvent, pushUser, pushNotice };
}
