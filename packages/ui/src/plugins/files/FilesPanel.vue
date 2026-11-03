<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openMenu } from "../../components/sidebar/ui.ts";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons } from "../../shared/util.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import {
  badgeCode,
  badgeKind,
  collapsePath,
  mergeRepoChanges,
  pathKey,
  type RepoChange,
} from "../../shared/git-changes.ts";
import { overviewState, refreshOverviewState } from "../git/state.ts";
import { copyText, deleteEntry, renameEntry } from "./actions.ts";
import { beginCreate, inlineCreate } from "./inline-create.ts";
import { applySort, fileSort, setFileSort } from "./sort.ts";
import { FILE_SORT_OPTIONS, sameSortSetting } from "../../shared/file-sort.ts";
import FileCreateRow from "./FileCreateRow.vue";
import FileIcon from "../../components/shared/FileIcon.vue";
import FileTreeNode from "./FileTreeNode.vue";
import { openFileInStage } from "./state.ts";

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);
const entries = ref<WorkspaceEntry[]>([]);
/** 排序只影响展示：原始顺序留在 entries 里，切换排序不需要重新读目录 */
const sortedEntries = computed(() => applySort(entries.value));
const sortGlyph = "<svg class=\"pi-icon\" viewBox=\"0 0 16 16\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5.5 3.5v9M3 6l2.5-2.5L8 6M10.5 12.5v-9M8 10l2.5 2.5L13 10\"/></svg>";
const loading = ref(false);
const error = ref("");
const filter = ref("");
const searchResults = ref<WorkspaceEntry[]>([]);
const showChanges = ref(false);
let gitTimer: ReturnType<typeof setTimeout> | null = null;
const searching = ref(false);
let request = 0;
let searchRequest = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<void> {
  const cwd = ws.value?.cwd;
  if (!cwd) {
    entries.value = [];
    return;
  }
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const result = await workbench.listDirectory("");
    if (current === request) entries.value = result;
  } catch (reason: any) {
    if (current === request) error.value = reason?.message ?? String(reason);
  } finally {
    if (current === request) loading.value = false;
  }
}

watch(() => ws.value?.cwd, load, { immediate: true });

// 文件树 Git 标记与「只看变更」视图参考 ThinkRail 的 Files 树（Apache-2.0）。
const changes = computed<Array<RepoChange & { display: string }>>(() => {
  const overview = overviewState.value;
  const cwd = ws.value?.cwd;
  if (!overview?.isRepo || !cwd) return [];
  const base = collapsePath(cwd);
  return mergeRepoChanges({ cwd, root: overview.root, status: overview.status }).map((change) => {
    const abs = collapsePath(change.absPath);
    const display = abs === base ? "." : abs.startsWith(base + "/") ? abs.slice(base.length + 1) : abs;
    return { ...change, display };
  });
});
const changesByPath = computed(() => new Map(changes.value.map((change) => [pathKey(change.absPath), change])));
function gitFor(path: string): RepoChange | undefined {
  return changesByPath.value.get(pathKey(path));
}

function scheduleGitRefresh(): void {
  if (gitTimer) clearTimeout(gitTimer);
  gitTimer = setTimeout(() => {
    gitTimer = null;
    void refreshOverviewState(workbench);
  }, 400);
}

onMounted(() => void refreshOverviewState(workbench));
watch(
  () => ws.value?.cwd,
  () => {
    scheduleGitRefresh();
  },
);

function openChanged(change: RepoChange): void {
  void openFileInStage(workbench, stage, bus, change.absPath);
}

const ctx = { workbench, stage, bus };

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  const query = filter.value.trim();
  const current = ++searchRequest;
  if (!query || !ws.value) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    searchTimer = null;
    try {
      const items = await workbench.completePaths(query);
      if (current === searchRequest) searchResults.value = items.filter((item) => item.kind === "file");
    } catch {
      if (current === searchRequest) searchResults.value = [];
    } finally {
      if (current === searchRequest) searching.value = false;
    }
  }, 150);
}

const stopWatching = bus.on("files:changed", ({ directory }: { directory: string }) => {
  if (!directory) void load();
  if (filter.value.trim()) scheduleSearch();
});
onBeforeUnmount(() => {
  stopWatching();
  if (gitTimer) clearTimeout(gitTimer);
});


/** 排序菜单：当前生效的那项带勾，点一下立刻生效（本地记住） */
function sortMenu(event: MouseEvent): void {
  openMenu(event, FILE_SORT_OPTIONS.map((option) => ({
    label: `${sameSortSetting(fileSort, option) ? "✓ " : ""}${option.label}`,
    icon: sortGlyph,
    run: () => setFileSort(option),
  })));
}

function rootMenu(event: MouseEvent): void {
  if (!ws.value) return;
  openMenu(event, [
    { label: "新建文件", icon: icons.plus, run: () => beginCreate("", "file") },
    { label: "新建文件夹", icon: icons.folder, run: () => beginCreate("", "folder") },
    { separator: true },
    { label: "复制项目路径", icon: icons.copy, run: () => void copyText(bus, ws.value!.cwd, "已复制路径") },
    { label: "在文件管理器中显示", icon: icons.folder, run: () => workbench.reveal(ws.value!.cwd) },
  ]);
}

function resultMenu(event: MouseEvent, item: WorkspaceEntry): void {
  openMenu(event, [
    { label: "用系统程序打开", icon: icons.reveal, run: () => workbench.openWorkspacePath(item.relative).catch(fail) },
    { label: "重命名…", icon: icons.file, run: () => void renameEntry(ctx, item) },
    { separator: true },
    { label: "复制路径", icon: icons.copy, run: () => void copyText(bus, item.path, "已复制路径") },
    { label: "复制相对路径", icon: icons.copy, run: () => void copyText(bus, item.relative, "已复制相对路径") },
    { label: "在文件管理器中显示", icon: icons.folder, run: () => workbench.reveal(item.path) },
    { separator: true },
    { label: "删除…", icon: icons.trash, danger: true, run: () => void deleteEntry(ctx, item) },
  ]);
}

function fail(error: any): void {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

watch([filter, () => ws.value?.cwd], scheduleSearch);

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  searchRequest += 1;
});

function refresh(): void {
  load();
}

function openResult(item: WorkspaceEntry): void {
  openFileInStage(workbench, stage, bus, item.relative);
}

function onResultDragStart(event: DragEvent, item: WorkspaceEntry): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-pi-paths", JSON.stringify([item.path]));
  event.dataTransfer.setData("text/plain", item.path);
}
</script>

<template>
  <div class="files-view">
    <div class="files-toolbar">
      <span class="files-root" :title="ws?.cwd || '未打开项目'">
        {{ ws ? ws.name || baseName(ws.cwd) : "未打开项目" }}
      </span>
      <div class="files-actions">
        <button
          type="button"
          class="icon-btn small files-changes-btn"
          :class="{ active: showChanges }"
          :title="showChanges ? '显示全部文件' : `只看变更（${changes.length}）`"
          :disabled="!ws"
          @click="showChanges = !showChanges"
        >
          <span v-html="icons.diff" />
          <span v-if="changes.length" class="files-changes-count">{{ changes.length }}</span>
        </button>
        <button
          type="button"
          class="icon-btn small"
          title="刷新文件树"
          :disabled="loading"
          @click="refresh"
          v-html="icons.refresh"
        />
        <button
          type="button"
          class="icon-btn small"
          :title="`排序：${FILE_SORT_OPTIONS.find((option) => sameSortSetting(fileSort, option))?.label ?? '文件夹在前 · 名称 A→Z'}`"
          :disabled="!ws"
          @click="sortMenu"
          v-html="sortGlyph"
        />
        <button type="button" class="icon-btn small" title="新建文件" :disabled="!ws" @click="beginCreate('', 'file')" v-html="icons.plus" />
        <button type="button" class="icon-btn small" title="新建文件夹" :disabled="!ws" @click="beginCreate('', 'folder')" v-html="icons.folderAdd" />
      </div>
    </div>

    <div v-if="ws" class="panel-filter-wrap">
      <input v-model="filter" class="panel-filter" placeholder="搜索项目内文件…" />
    </div>

    <div v-if="loading" class="files-state"><span class="mini-spinner" />正在读取目录…</div>
    <div v-else-if="error" class="files-state error">
      <span>{{ error }}</span>
      <button type="button" class="btn" @click="refresh">重试</button>
    </div>
    <div v-else-if="!ws" class="files-state">
      <span>先在左侧侧边栏选择或打开一个项目，这里会显示它的文件树</span>
    </div>
    <template v-else-if="filter.trim()">
      <div v-if="searching" class="files-state"><span class="mini-spinner" />正在搜索文件…</div>
      <div v-else-if="!searchResults.length" class="files-state">没有匹配的文件</div>
      <div v-else class="files-tree">
        <button
          v-for="item in searchResults"
          :key="item.path"
          type="button"
          class="file-tree-row"
          :class="{
            active: stage.activeTab.value?.pluginId === 'files' && stage.activeTab.value?.tabId === item.relative,
          }"
          :title="`${item.relative}（可拖拽至输入框作为附件）`"
          draggable="true"
          @dragstart="onResultDragStart($event, item)"
          @click="openResult(item)"
          @contextmenu="resultMenu($event, item)"
        >
          <FileIcon :name="item.name" />
          <span class="file-tree-name">{{ item.name }}</span>
          <small class="file-search-rel">{{ item.relative }}</small>
          <span v-if="gitFor(item.path)" class="file-tree-git" :data-kind="badgeKind(gitFor(item.path)!)">{{ badgeCode(gitFor(item.path)!) }}</span>
        </button>
      </div>
    </template>
    <div v-else-if="showChanges" class="files-tree files-changes-list">
      <div v-if="!changes.length" class="files-state">工作区没有未提交的改动</div>
      <button
        v-for="change in changes"
        :key="change.path"
        type="button"
        class="file-tree-row"
        :class="{
          active: stage.activeTab.value?.pluginId === 'files' && stage.activeTab.value?.tabId === change.display,
        }"
        :title="change.absPath"
        @click="openChanged(change)"
      >
        <span class="file-tree-caret" />
        <FileIcon :name="change.name" />
        <span class="file-tree-name">{{ change.name }}</span>
        <small v-if="change.display !== change.name" class="file-search-rel">{{ change.display }}</small>
        <span class="file-tree-git" :data-kind="badgeKind(change)">{{ badgeCode(change) }}</span>
      </button>
    </div>
    <div v-else class="files-tree" @contextmenu="rootMenu">
      <FileCreateRow
        v-if="inlineCreate && inlineCreate.parent === ''"
        :key="inlineCreate.seq"
        :parent="''"
        :kind="inlineCreate.kind"
        :level="0"
      />
      <div v-if="!sortedEntries.length && !inlineCreate" class="files-state">目录为空，右键可新建</div>
      <FileTreeNode
        v-for="item in sortedEntries"
        :key="item.path"
        :item="item"
        :git="gitFor(item.path)"
        :git-map="changesByPath"
      />
    </div>
  </div>
</template>
