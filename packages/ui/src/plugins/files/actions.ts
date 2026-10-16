import { askConfirm, askPrompt } from "../../components/sidebar/ui.ts";
import type { EventBus } from "../../kernel/event-bus.ts";
import type { StageController } from "../../kernel/stage.ts";
import type { Workbench } from "../../kernel/workbench.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import { openFileInStage } from "./state.ts";

interface FileActions {
  workbench: Workbench;
  stage: StageController;
  bus: EventBus;
}

function parentOf(relative: string): string {
  const index = relative.lastIndexOf("/");
  return index < 0 ? "" : relative.slice(0, index);
}

function notify(bus: EventBus, error: any): void {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

function changed(bus: EventBus, directory: string): void {
  bus.emit("files:changed", { directory });
}

/** 页签 key 由相对路径生成且不可变，路径变化后只能关闭再打开。 */
function affectedTabs(stage: StageController, relative: string): string[] {
  const prefix = `${relative}/`;
  return stage.tabs
    .filter((tab) => tab.pluginId === "files" && (tab.tabId === relative || tab.tabId.startsWith(prefix)))
    .map((tab) => tab.key);
}

function closeAffected(stage: StageController, relative: string): void {
  for (const key of affectedTabs(stage, relative)) stage.close(key);
}

export async function createEntry(ctx: FileActions, parent: string, kind: "file" | "folder"): Promise<void> {
  const folder = kind === "folder";
  const name = await askPrompt({
    title: folder ? "新建文件夹" : "新建文件",
    label: "名称",
    placeholder: folder ? "folder" : "file.txt",
    confirmLabel: "创建",
  });
  if (!name) return;
  try {
    const created = await ctx.workbench.createEntry(parent, name, kind);
    changed(ctx.bus, parent);
    ctx.bus.emit("notify", { level: "info", text: `已创建 ${created.name}` });
    if (!folder) await openFileInStage(ctx.workbench, ctx.stage, ctx.bus, created.relative);
  } catch (error) {
    notify(ctx.bus, error);
  }
}

export async function renameEntry(ctx: FileActions, item: WorkspaceEntry): Promise<void> {
  const name = await askPrompt({
    title: item.kind === "folder" ? "重命名文件夹" : "重命名文件",
    label: "新名称",
    value: item.name,
    confirmLabel: "重命名",
  });
  if (!name || name === item.name) return;

  const dirty = affectedTabs(ctx.stage, item.relative).some((key) => ctx.stage.tabs.find((tab) => tab.key === key)?.dirty);
  if (dirty) {
    const ok = await askConfirm({
      title: `重命名「${item.name}」？`,
      message: "其中有未保存的修改。重命名会关闭这些页签，未保存内容将丢失。",
      confirmLabel: "放弃修改并重命名",
      danger: true,
    });
    if (!ok) return;
  }

  try {
    const renamed = await ctx.workbench.renameEntry(item.relative, name);
    closeAffected(ctx.stage, item.relative);
    changed(ctx.bus, parentOf(item.relative));
    ctx.bus.emit("notify", { level: "info", text: `已重命名为 ${renamed.name}` });
    if (renamed.kind === "file") await openFileInStage(ctx.workbench, ctx.stage, ctx.bus, renamed.relative);
  } catch (error) {
    notify(ctx.bus, error);
  }
}

export async function deleteEntry(ctx: FileActions, item: WorkspaceEntry): Promise<void> {
  const folder = item.kind === "folder";
  const ok = await askConfirm({
    title: `删除「${item.name}」？`,
    message: folder ? "文件夹及其内容将移入回收站，已打开的页签会关闭。" : "文件将移入回收站。",
    confirmLabel: "移入回收站",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.workbench.deleteEntry(item.relative);
    closeAffected(ctx.stage, item.relative);
    changed(ctx.bus, parentOf(item.relative));
    ctx.bus.emit("notify", { level: "info", text: `已将 ${item.name} 移入回收站` });
  } catch (error) {
    notify(ctx.bus, error);
  }
}

export async function copyText(bus: EventBus, text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    bus.emit("notify", { level: "info", text: label });
  } catch (error) {
    notify(bus, error);
  }
}
