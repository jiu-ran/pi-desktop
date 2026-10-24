import { reactive } from "vue";
import type { EventBus } from "../kernel/event-bus.ts";
import { localizeNotification } from "../shared/notify-text.ts";

export interface ToastItem {
  id: number;
  level: string;
  text: string;
  /** 同一条消息重复出现的次数（合并成一张卡片显示 ×N） */
  count?: number;
}

export const extState = reactive({
  dialogs: [] as any[],
  toasts: [] as ToastItem[],
  statuses: {} as Record<string, Record<string, string>>,
  widgets: {} as Record<string, Record<string, { lines: string[]; placement: string }>>,
});

let toastSeq = 0;
/** 每条提示的消失定时器：重复消息要重置计时，否则第二条还没看清就没了 */
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function pushToast(level: string, text: string): void {
  // 所有通知从同一个入口中文化，避免 Electron IPC 前缀和 Node 英文错误直接弹给用户。
  const localized = localizeNotification(text, level);
  // 同一条消息在短时间内重复出现时只保留一条：以前一个失败会被多个路径各报一次，
  // 界面上就堆出三四张一模一样的提示。
  const existing = extState.toasts.find((item) => item.text === localized && item.level === level);
  if (existing) {
    existing.count = (existing.count ?? 1) + 1;
    const timer = toastTimers.get(existing.id);
    if (timer) clearTimeout(timer);
    toastTimers.set(existing.id, scheduleDismiss(existing.id, level));
    return;
  }
  toastSeq += 1;
  const id = toastSeq;
  extState.toasts.push({ id, level, text: localized, count: 1 });
  toastTimers.set(id, scheduleDismiss(id, level));
}

function scheduleDismiss(id: number, level: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    toastTimers.delete(id);
    const index = extState.toasts.findIndex((item) => item.id === id);
    if (index >= 0) extState.toasts.splice(index, 1);
  }, level === "error" ? 8000 : 4500);
}

export function handleRequest(
  cwd: string,
  request: Record<string, any>,
  {
    sessionFile,
    onTitle,
    onEditorText,
  }: { sessionFile?: string; onTitle?: (title: string) => void; onEditorText?: (text: string) => void },
): void {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      extState.dialogs.push({ cwd, sessionFile, ...request, receivedAt: Date.now() });
      break;
    case "notify":
      pushToast(request.notifyType ?? "info", request.message ?? "");
      break;
    case "setStatus": {
      const bucket = { ...(extState.statuses[cwd] ?? {}) };
      if (request.statusText == null || request.statusText === "") delete bucket[request.statusKey];
      else bucket[request.statusKey] = request.statusText;
      extState.statuses[cwd] = bucket;
      break;
    }
    case "setWidget": {
      const bucket = { ...(extState.widgets[cwd] ?? {}) };
      if (!Array.isArray(request.widgetLines)) delete bucket[request.widgetKey];
      else bucket[request.widgetKey] = { lines: request.widgetLines, placement: request.widgetPlacement ?? "aboveEditor" };
      extState.widgets[cwd] = bucket;
      break;
    }
    case "setTitle":
      onTitle?.(request.title);
      break;
    case "set_editor_text":
      onEditorText?.(request.text ?? "");
      break;
    default:
      break;
  }
}

export function closeDialog(id: string): void {
  const index = extState.dialogs.findIndex((item) => item.id === id);
  if (index >= 0) extState.dialogs.splice(index, 1);
}

export function setupExtensionUi(bus: EventBus, host?: any): () => void {
  const disposers: Array<() => void> = [];
  disposers.push(bus.on("pi:event", ({ cwd, sessionFile, event }: { cwd: string; sessionFile?: string; event: any }) => {
    if (event.type !== "extension_ui_request") return;
    handleRequest(cwd, event, {
      sessionFile,
      onTitle: (title) => {
        if (typeof document !== "undefined") {
          document.title = title ? `${title} — Pi Desktop` : "Pi Desktop";
        }
      },
      onEditorText: (text) => bus.emit("composer:set", { cwd, sessionFile, text }),
    });
  }));

  disposers.push(bus.on(
    "extension-ui:respond",
    ({ cwd, sessionFile, response }: { cwd: string; sessionFile?: string; response: Record<string, any> }) => {
      host
        ?.respondExtensionUi(cwd, JSON.parse(JSON.stringify(response)), sessionFile)
        ?.catch((error: any) => pushToast("error", error?.message ?? String(error)));
    },
  ));

  disposers.push(bus.on("notify", ({ level, text }: { level?: string; text: string }) => {
    pushToast(level ?? "info", text);
  }));

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
