import { reactive } from "vue";

export interface ToastItem {
  id: number;
  level: string;
  text: string;
}

export const extState = reactive({
  dialogs: [] as any[],
  toasts: [] as ToastItem[],
  statuses: {} as Record<string, Record<string, string>>,
  widgets: {} as Record<string, Record<string, { lines: string[]; placement: string }>>,
});

let toastSeq = 0;

export function pushToast(level: string, text: string): void {
  toastSeq += 1;
  const id = toastSeq;
  extState.toasts.push({ id, level, text });
  setTimeout(() => {
    const index = extState.toasts.findIndex((item) => item.id === id);
    if (index >= 0) extState.toasts.splice(index, 1);
  }, level === "error" ? 8000 : 4500);
}

export function handleRequest(
  cwd: string,
  request: Record<string, any>,
  { onTitle, onEditorText }: { onTitle?: (title: string) => void; onEditorText?: (text: string) => void },
): void {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      extState.dialogs.push({ cwd, ...request, receivedAt: Date.now() });
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
