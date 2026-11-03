/**
 * 新建 / 重命名时对名字的本地校验。
 *
 * 只拦「一定会失败」的输入（斜杠、Windows 保留字符、`.`/`..`），
 * 其余交给主进程判断 —— 前端猜平台规则只会两边不一致。
 */

export interface EntryNameCheck {
  ok: boolean;
  /** 不合法时的中文原因；空名字不报错（表示「还没输入」） */
  reason: string;
}

export function validateEntryName(name: string): EntryNameCheck {
  const value = String(name ?? "").trim();
  if (!value) return { ok: false, reason: "" };
  if (value === "." || value === "..") return { ok: false, reason: "不能用 . 或 .." };
  if (/[/\\]/.test(value)) return { ok: false, reason: "名称里不能有 / 或 \\" };
  if (/[:*?"<>|]/.test(value)) return { ok: false, reason: '名称里不能有 : * ? " < > |' };
  if (value.length > 255) return { ok: false, reason: "名称太长（最多 255 个字符）" };
  return { ok: true, reason: "" };
}

/** 输入框占位：照着 VS Code 的习惯给个示例。 */
export function entryNamePlaceholder(kind: "file" | "folder"): string {
  return kind === "folder" ? "文件夹名" : "文件名，例如 app.ts";
}
