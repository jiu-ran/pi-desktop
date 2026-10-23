/**
 * 终端内的复制 / 粘贴快捷键判定。
 *
 * 平台差异是有意保留的：
 * - Windows / Linux：选中内容后 Ctrl+C 复制，没有选中时仍把 ^C 交给程序中断；
 *   Windows 额外支持 Ctrl+V 粘贴（Unix 终端的 Ctrl+V 是字面输入，不抢）。
 * - macOS：Cmd+C / Cmd+V 负责剪贴板，Ctrl+C 必须保持中断语义。
 * - 所有平台都支持 Ctrl+Shift+C/V 与 Ctrl/Shift+Insert。
 */
export type ClipboardAction = "copy" | "paste";

export interface ClipboardKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function resolveClipboardAction(
  event: ClipboardKeyEvent,
  platform: string,
  hasSelection: boolean,
): ClipboardAction | null {
  const key = event.key.toLowerCase();
  const insert = key === "insert";
  if (insert) {
    if (event.ctrlKey && !event.shiftKey) return "copy";
    if (event.shiftKey && !event.ctrlKey) return "paste";
    return null;
  }
  const cmd = platform === "darwin" && event.metaKey;
  if ((event.ctrlKey || cmd) && event.shiftKey && key === "c") return "copy";
  if ((event.ctrlKey || cmd) && event.shiftKey && key === "v") return "paste";
  if (cmd && !event.ctrlKey) {
    if (key === "c") return "copy";
    if (key === "v") return "paste";
  }
  const plainCtrl = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  if (plainCtrl && platform !== "darwin" && key === "c" && hasSelection) return "copy";
  if (plainCtrl && platform === "win32" && key === "v") return "paste";
  return null;
}
