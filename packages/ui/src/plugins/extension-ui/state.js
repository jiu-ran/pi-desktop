import { reactive } from "vue";

/**
 * extension_ui_request 的状态。
 * 对话类（select/confirm/input/editor）排队显示；其余为即发即忘。
 */
export const extState = reactive({
  dialogs: [],
  toasts: [],
  // cwd -> { key: text }
  statuses: {},
  // cwd -> { key: { lines, placement } }
  widgets: {},
});

let toastSeq = 0;

export function pushToast(level, text) {
  toastSeq += 1;
  const id = toastSeq;
  extState.toasts.push({ id, level, text });
  setTimeout(() => {
    const index = extState.toasts.findIndex((item) => item.id === id);
    if (index >= 0) extState.toasts.splice(index, 1);
  }, level === "error" ? 8000 : 4500);
}

export function handleRequest(cwd, request, { onTitle, onEditorText }) {
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

export function closeDialog(id) {
  const index = extState.dialogs.findIndex((item) => item.id === id);
  if (index >= 0) extState.dialogs.splice(index, 1);
}
