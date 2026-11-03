import { ref } from "vue";

/**
 * 文件树里的「就地新建」草稿。
 *
 * 仿 VS Code：点「新建文件 / 新建文件夹」不再弹对话框，而是在目标目录里插一行输入框，
 * Enter 创建、Esc 取消。`parent` 是相对项目根的目录（根目录为空串）。
 */
export interface InlineCreateDraft {
  parent: string;
  kind: "file" | "folder";
  /** 每次重新打开都换一个 seq：同一个目录连续新建两次时输入框要重置 */
  seq: number;
}

export const inlineCreate = ref<InlineCreateDraft | null>(null);

export function beginCreate(parent = "", kind: "file" | "folder" = "file"): void {
  inlineCreate.value = {
    parent: String(parent ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
    kind,
    seq: Date.now(),
  };
}

export function cancelCreate(): void {
  inlineCreate.value = null;
}
