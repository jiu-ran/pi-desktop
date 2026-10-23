import type { StageTab } from "../../kernel/stage.ts";
import type { Workbench } from "../../kernel/workbench.ts";
import type { FileStageData } from "./state.ts";

const saves = new WeakMap<StageTab<FileStageData>, Promise<void>>();

/** 保存绑定文件创建时的项目，不读取正在切换的活动工作区；串行保留后续草稿。 */
export async function saveFileTab(workbench: Workbench, tab: StageTab<FileStageData>): Promise<void> {
  const previous = saves.get(tab) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const file = tab.data;
    if (!tab.dirty || !file || file.binary || file.loading) return;
    if (file.error) throw new Error(file.error);
    const content = file.draft ?? file.content ?? "";
    file.saving = true;
    file.saveError = "";
    try {
      const saved = await workbench.writeFile(file.path || file.relative, content, file.revision, file.cwd);
      file.content = saved.content;
      file.savedContent = saved.content;
      file.revision = saved.revision;
      file.size = saved.size;
      tab.dirty = file.draft !== saved.content;
    } catch (error: any) {
      file.saveError = error?.message || String(error);
      throw error;
    } finally { file.saving = false; }
  });
  saves.set(tab, pending);
  try { await pending; }
  finally { if (saves.get(tab) === pending) saves.delete(tab); }
}
