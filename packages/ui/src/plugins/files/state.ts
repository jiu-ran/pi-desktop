import { baseName } from "../../shared/util.ts";
import type { StageController } from "../../kernel/stage.ts";
import type { Workbench } from "../../kernel/workbench.ts";
import type { EventBus } from "../../kernel/event-bus.ts";

export interface FileStageData {
  path: string;
  relative: string;
  name: string;
  size: number;
  content: string;
  savedContent: string;
  draft: string;
  loading: boolean;
  error: string;
}

export function normalizeRelativePath(cwd: string, targetPath: string): string {
  const raw = String(targetPath ?? "").trim();
  if (!raw) return "";
  const normCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normTarget = raw.replace(/\\/g, "/");
  if (normTarget.toLowerCase().startsWith(`${normCwd.toLowerCase()}/`)) {
    return normTarget.slice(normCwd.length + 1);
  }
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
    return;
  }

  const name = baseName(relative);
  const initialData: FileStageData = existing?.data ?? {
    path: relative,
    relative,
    name,
    size: 0,
    content: "",
    savedContent: "",
    draft: "",
    loading: true,
    error: "",
  };
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
    tab.title = detail.name || name;
    tab.subtitle = detail.relative || relative;
    tab.dirty = false;
    tab.data = {
      path: detail.path,
      relative: detail.relative,
      name: detail.name,
      size: detail.size,
      content: detail.content,
      savedContent: detail.content,
      draft: detail.content,
      loading: false,
      error: "",
    };
  } catch (error: any) {
    tab.data.loading = false;
    tab.data.error = error?.message ?? String(error);
    bus.emit("notify", { level: "error", text: tab.data.error });
  }
}
