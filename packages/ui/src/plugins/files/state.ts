import { baseName } from "../../shared/util.ts";
import { rememberRecentFile } from "../../shared/recent-files.ts";
import { localizeNotification } from "../../shared/notify-text.ts";
import type { StageController } from "../../kernel/stage.ts";
import type { Workbench } from "../../kernel/workbench.ts";
import type { EventBus } from "../../kernel/event-bus.ts";

export interface FileStageData {
  cwd?: string;
  revision?: string;
  saving?: boolean;
  saveError?: string;
  path: string;
  relative: string;
  name: string;
  size: number;
  content: string;
  savedContent: string;
  draft: string;
  loading: boolean;
  error: string;
  /** 图片预览数据（data URL） */
  preview?: { mimeType: string; dataUrl: string };
  /** 非文本文件：只读预览 */
  binary?: boolean;
}

export function normalizeRelativePath(cwd: string, targetPath: string): string {
  const raw = String(targetPath ?? "").trim();
  if (!raw) return "";
  const normCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normTarget = raw.replace(/\\/g, "/");
  const windows = /^[A-Za-z]:\//.test(normCwd) || normCwd.startsWith("//");
  const comparedCwd = windows ? normCwd.toLowerCase() : normCwd;
  const comparedTarget = windows ? normTarget.toLowerCase() : normTarget;
  if (comparedTarget.startsWith(`${comparedCwd}/`)) {
    return normTarget.slice(normCwd.length + 1);
  }
  // 项目外文件保留绝对路径，交给主进程按“单文件绝对路径”处理。
  // 特别是 macOS / Linux 的 `/tmp/file` 不能被下面的相对路径清理逻辑去掉 `/`。
  if (normTarget.startsWith("/") || /^[A-Za-z]:\//.test(normTarget)) return normTarget;
  return normTarget.replace(/^\.?\//, "");
}

export async function openFileInStage(
  workbench: Workbench,
  stage: StageController,
  bus: EventBus,
  targetPath: string,
): Promise<void> {
  const cwd = workbench.state.activeCwd;
  if (!cwd) return;
  const relative = normalizeRelativePath(cwd, targetPath);
  if (!relative) return;

  const existing = stage.findTab<FileStageData>("files", relative);
  if (existing && !existing.data.error && !existing.data.loading) {
    stage.activate(existing.key);
    rememberRecentFile(cwd, relative);
    return;
  }

  const name = baseName(relative);
  const initialData: FileStageData = existing?.data ?? {
    cwd,
    path: relative,
    relative,
    name,
    size: 0,
    content: "",
    savedContent: "",
    draft: "",
    loading: true,
    error: "",
    preview: undefined,
    binary: false,
  };
  if (existing?.data.loading) { stage.activate(existing.key); return; }
  initialData.loading = true;
  initialData.error = "";

  const tab = stage.open<FileStageData>({
    pluginId: "files",
    tabId: relative,
    title: name,
    subtitle: relative,
    dirty: false,
    data: initialData,
  });

  try {
    const detail = await workbench.readFile(relative);
    if (!stage.allTabs.value.includes(tab)) return;
    tab.title = detail.name || name;
    tab.subtitle = detail.relative || relative;
    tab.dirty = false;
    rememberRecentFile(cwd, relative);
    tab.data = {
      cwd,
      revision: detail.revision,
      path: detail.path,
      relative: detail.relative,
      name: detail.name,
      size: detail.size,
      content: detail.content,
      savedContent: detail.content,
      draft: detail.content,
      loading: false,
      error: "",
      preview: detail.preview,
      binary: detail.binary,
    };
  } catch (error: any) {
    if (!stage.allTabs.value.includes(tab)) return;
    tab.data.loading = false;
    tab.data.error = localizeNotification(error, "error");
    bus.emit("notify", { level: "error", text: tab.data.error });
  }
}
