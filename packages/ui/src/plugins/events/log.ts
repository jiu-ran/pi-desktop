import { reactive } from "vue";

export interface EventLogEntry {
  id: number;
  cwd: string;
  type: string;
  group: string;
  hint: string;
  time: string;
  sessionFile: string;
  json: string;
}

const LIMIT = 400;
let seq = 0;

function groupOf(type: string): string {
  if (type.startsWith("tool_")) return "tool";
  if (type.startsWith("message_")) return "message";
  if (type.startsWith("agent_") || type.startsWith("turn_")) return "agent";
  if (type.includes("error") || type.includes("retry")) return "warn";
  if (type === "extension_ui_request") return "ext";
  return "other";
}

function hintOf(event: Record<string, any>): string {
  if (event.toolName) return event.toolName;
  if (event.assistantMessageEvent?.type) return event.assistantMessageEvent.type;
  if (event.message?.role) return event.message.role;
  if (event.method) return event.method;
  if (event.reason) return event.reason;
  return "";
}

export const eventLog = reactive({
  items: [] as EventLogEntry[],
  push(cwd: string, sessionFile: string | undefined, event: Record<string, any>) {
    const type = event.type ?? "unknown";
    const session = sessionFile ?? "";
    if (type === "message_update") return;
    seq += 1;
    this.items.unshift({
      id: seq,
      cwd,
      sessionFile: sessionFile ?? "",
      type,
      group: groupOf(type),
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
