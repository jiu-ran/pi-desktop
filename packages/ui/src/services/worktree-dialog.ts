import { reactive } from "vue";

export interface OpenWorktreeDialogOptions {
  /** 要基于哪个仓库目录创建 Worktree（省略时取当前活动项目） */
  cwd?: string;
  /** 预选要加载/迁移到新 Worktree 的会话文件路径 */
  sessionFile?: string;
  /** 预选会话的标题（展示用） */
  sessionTitle?: string;
  /** 预填入初始任务指令的文本（例如当前输入框里的未发送草稿） */
  initialPrompt?: string;
  /** 预填的任务标识名称 */
  initialName?: string;
}

/** 「新建 Git Worktree（隔离工作区与对话）」全局弹窗状态 */
export const worktreeDialogState = reactive({
  open: false,
  cwd: "",
  sessionFile: "",
  sessionTitle: "",
  initialPrompt: "",
  initialName: "",
});

export function openWorktreeDialog(options: OpenWorktreeDialogOptions = {}): void {
  worktreeDialogState.cwd = options.cwd ?? "";
  worktreeDialogState.sessionFile = options.sessionFile ?? "";
  worktreeDialogState.sessionTitle = options.sessionTitle ?? "";
  worktreeDialogState.initialPrompt = options.initialPrompt ?? "";
  worktreeDialogState.initialName = options.initialName ?? "";
  worktreeDialogState.open = true;
}

export function closeWorktreeDialog(): void {
  worktreeDialogState.open = false;
}
