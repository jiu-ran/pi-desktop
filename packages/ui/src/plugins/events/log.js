import { reactive } from "vue";

const LIMIT = 400;
let seq = 0;

function groupOf(type) {
  if (type.startsWith("tool_")) return "tool";
  if (type.startsWith("message_")) return "message";
  if (type.startsWith("agent_") || type.startsWith("turn_")) return "agent";
  if (type.includes("error") || type.includes("retry")) return "warn";
  if (type === "extension_ui_request") return "ext";
  return "other";
}

function hintOf(event) {
  if (event.toolName) return event.toolName;
  if (event.assistantMessageEvent?.type) return event.assistantMessageEvent.type;
  if (event.message?.role) return event.message.role;
  if (event.method) return event.method;
  if (event.reason) return event.reason;
  return "";
}

export const eventLog = reactive({
  items: [],
  push(cwd, event) {
    seq += 1;
    this.items.unshift({
      id: seq,
      cwd,
      type: event.type ?? "unknown",
      group: groupOf(event.type ?? ""),
      hint: hintOf(event),
      time: new Date().toLocaleTimeString(),
      json: JSON.stringify(event, null, 2).slice(0, 6000),
    });
    if (this.items.length > LIMIT) this.items.length = LIMIT;
  },
  clear() {
    this.items.length = 0;
  },
});
