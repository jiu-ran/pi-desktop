import type { WorkspaceDiskChange } from "../../env.d.ts";

type Emit = (type: string, payload?: any) => void;

/**
 * 把主进程的目录监听接进内核事件总线。
 *
 * 拿到一次磁盘变动后发两个事件：
 * - `files:changed`（directory）→ 文件树节点、Git 面板按需重读（它们本来就懂这个信号）；
 * - `files:disk-change`（change）→ 已打开的编辑页自己决定要不要同步内容。
 */
export function bindDiskWatch(emit: Emit): () => void {
  const subscribe = window.piDesktop?.onFilesDiskChange;
  if (typeof subscribe !== "function") return () => {};
  return subscribe((change: WorkspaceDiskChange) => {
    if (!change || !Array.isArray(change.directories)) return;
    for (const directory of change.directories) {
      emit("files:changed", { directory });
    }
    emit("files:disk-change", change);
  });
}
