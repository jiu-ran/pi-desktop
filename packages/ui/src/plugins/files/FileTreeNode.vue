<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { openMenu } from "../../components/sidebar/ui.ts";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import { badgeCode, badgeKind, pathKey, type RepoChange } from "../../shared/git-changes.ts";
import { copyText, createEntry, deleteEntry, renameEntry } from "./actions.ts";
import { openFileInStage } from "./state.ts";

const props = withDefaults(
  defineProps<{
    item: WorkspaceEntry;
    level?: number;
    /** 该文件自身的 Git 状态 */
    git?: RepoChange;
    /** 全量 Git 状态索引，用于给文件夹汇总子项变更数 */
    gitMap?: Map<string, RepoChange>;
  }>(),
  {
    level: 0,
  },
);

const { workbench, stage, bus } = useKernel();
const expanded = ref(false);
const loading = ref(false);
const children = ref<WorkspaceEntry[]>([]);
let childrenRequest = 0;

const isActive = computed(
  () =>
    props.item.kind !== "folder" &&
    stage.activeTab.value?.pluginId === "files" &&
    stage.activeTab.value?.tabId === props.item.relative,
);

// 文件夹只显示子项变更总数，文件显示 M/A/D/R/U 字母。
const folderChanges = computed(() => {
  if (props.item.kind !== "folder" || !props.gitMap?.size) return 0;
  const prefix = pathKey(props.item.path) + "/";
  let count = 0;
  for (const key of props.gitMap.keys()) if (key.startsWith(prefix)) count += 1;
  return count;
});

const isDirty = computed(
  () =>
    props.item.kind !== "folder" &&
    stage.tabs.some((tab) => tab.pluginId === "files" && tab.tabId === props.item.relative && tab.dirty),
);

function notify(error: any): void {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

function fileIconKind(item: WorkspaceEntry): string {
  if (item.kind === "folder") return "folder";
  const ext = item.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "vue", "svelte", "html", "css", "scss"].includes(ext)) return "code";
  if (["json", "jsonl"].includes(ext)) return "json";
  if (["zip", "jar", "gz", "7z", "rar"].includes(ext)) return "archive";
  if (["md", "txt", "log", "csv", "yml", "yaml"].includes(ext)) return "text";
  return "file";
}

function fileIcon(item: WorkspaceEntry): string {
  const kind = fileIconKind(item);
  return icons[kind] ?? icons.file;
}

async function open(): Promise<void> {
  if (props.item.kind === "folder") {
    if (!expanded.value && !children.value.length) {
      loading.value = true;
      try {
        children.value = await workbench.listDirectory(props.item.relative);
      } catch (error) {
        notify(error);
        return;
      } finally {
        loading.value = false;
      }
    }
    expanded.value = !expanded.value;
    return;
  }
  await openFileInStage(workbench, stage, bus, props.item.relative);
}

function onDragStart(event: DragEvent): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-pi-paths", JSON.stringify([props.item.path]));
  event.dataTransfer.setData("text/plain", props.item.path);
}

async function reloadChildren(force = false): Promise<void> {
  if (!expanded.value && !force) return;
  const current = ++childrenRequest;
  loading.value = true;
  try {
    const result = await workbench.listDirectory(props.item.relative);
    if (current === childrenRequest) children.value = result;
  } catch (error) {
    if (current === childrenRequest) notify(error);
  } finally {
    if (current === childrenRequest) loading.value = false;
  }
}

const stopWatching = bus.on("files:changed", ({ directory }: { directory: string }) => {
  if (props.item.kind === "folder" && directory === props.item.relative) {
    children.value = [];
    if (expanded.value) void reloadChildren();
  }
});
onBeforeUnmount(stopWatching);

const ctx = { workbench, stage, bus };

function menu(event: MouseEvent): void {
  const folder = props.item.kind === "folder";
  openMenu(event, [
    ...(folder
      ? [
          { label: "新建文件", icon: icons.plus, run: () => void createEntry(ctx, props.item.relative, "file") },
          { label: "新建文件夹", icon: icons.folder, run: () => void createEntry(ctx, props.item.relative, "folder") },
          { separator: true },
        ]
      : [{ label: "用系统程序打开", icon: icons.reveal, run: () => workbench.openWorkspacePath(props.item.relative).catch(notify) }]),
    { label: "重命名…", icon: icons.file, run: () => void renameEntry(ctx, props.item) },
    { separator: true },
    { label: "复制路径", icon: icons.copy, run: () => void copyText(bus, props.item.path, "已复制路径") },
    { label: "复制相对路径", icon: icons.copy, run: () => void copyText(bus, props.item.relative, "已复制相对路径") },
    { label: "在文件管理器中显示", icon: icons.folder, run: () => workbench.reveal(props.item.path) },
    { separator: true },
    { label: "删除…", icon: icons.trash, danger: true, run: () => void deleteEntry(ctx, props.item) },
  ]);
}
</script>

<template>
  <div class="file-tree-node">
    <button
      type="button"
      class="file-tree-row"
      :class="{ folder: item.kind === 'folder', active: isActive, expanded }"
      :style="{ paddingLeft: `${8 + level * 14}px` }"
      :title="`${item.relative}（可拖拽至输入框作为附件）`"
      draggable="true"
      @dragstart="onDragStart"
      @click="open"
      @contextmenu="menu"
    >
      <span class="file-tree-caret">
        <span v-if="loading" class="mini-spinner" />
        <span v-else-if="item.kind === 'folder'" v-html="expanded ? icons.chevronDown : icons.chevronRight" />
      </span>
      <span class="file-tree-icon" :class="fileIconKind(item)" v-html="fileIcon(item)" />
      <span class="file-tree-name">{{ item.name }}</span>
      <span v-if="isDirty" class="file-tree-dirty" title="有未保存修改">●</span>
      <span
        v-else-if="item.kind === 'folder' && folderChanges"
        class="file-tree-git-count"
        :title="`${folderChanges} 个变更`"
      >{{ folderChanges }}</span>
      <span
        v-else-if="git"
        class="file-tree-git"
        :data-kind="badgeKind(git)"
        :title="`Git 状态：${badgeCode(git)}`"
      >{{ badgeCode(git) }}</span>
    </button>
    <div v-if="expanded" class="file-tree-children" @contextmenu.stop>
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :item="child"
        :level="level + 1"
        :git="gitMap?.get(pathKey(child.path))"
        :git-map="gitMap"
      />
      <div v-if="!loading && !children.length" class="file-tree-empty" :style="{ paddingLeft: `${32 + level * 16}px` }">
        空文件夹
      </div>
    </div>
  </div>
</template>
