<script setup lang="ts">
import { computed, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";

const props = defineProps({
  item: { type: Object, required: true },
  level: { type: Number, default: 0 },
});
const { workbench, bus } = useKernel();
const emit = defineEmits(["open-file"]);
const expanded = ref(false);
const loading = ref(false);
const children = ref([]);
const isActive = computed(() => props.item.kind !== "folder" && workbench.state.activeFile === props.item.relative);
const isDirty = computed(() => props.item.kind !== "folder"
  && workbench.state.openFiles.some((f) => f.relative === props.item.relative && f.dirty));

function notify(error) {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

function fileIconKind(item) {
  if (item.kind === "folder") return "folder";
  const ext = item.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "vue", "svelte", "html", "css", "scss"].includes(ext)) return "code";
  if (["json", "jsonl"].includes(ext)) return "json";
  if (["zip", "jar", "gz", "7z", "rar"].includes(ext)) return "archive";
  if (["md", "txt", "log", "csv", "yml", "yaml"].includes(ext)) return "text";
  return "file";
}

function fileIcon(item) {
  const kind = fileIconKind(item);
  return icons[kind] ?? icons.file;
}

async function open() {
  if (props.item.kind === "folder") {
    if (!expanded.value && !children.value.length) {
      loading.value = true;
      try { children.value = await workbench.listDirectory(props.item.relative); }
      catch (error) { notify(error); return; }
      finally { loading.value = false; }
    }
    expanded.value = !expanded.value;
    return;
  }
  try { await workbench.openFile(props.item.relative); }
  catch (error) { notify(error); }
}
</script>

<template>
  <div class="file-tree-node">
    <button
      class="file-tree-row"
      :class="{ folder: item.kind === 'folder', active: isActive, expanded }"
      :style="{ paddingLeft: `${8 + level * 14}px` }"
      :title="item.relative"
      @click="open"
    >
      <span class="file-tree-caret">
        <span v-if="loading" class="mini-spinner" />
        <span v-else-if="item.kind === 'folder'" v-html="expanded ? icons.chevronDown : icons.chevronRight" />
      </span>
      <span class="file-tree-icon" :class="fileIconKind(item)" v-html="fileIcon(item)" />
      <span class="file-tree-name">{{ item.name }}</span>
      <span v-if="isDirty" class="file-tree-dirty" title="有未保存修改">●</span>
    </button>
    <div v-if="expanded" class="file-tree-children">
      <FileTreeNode v-for="child in children" :key="child.path" :item="child" :level="level + 1" @open-file="emit('open-file', $event)" />
      <div v-if="!loading && !children.length" class="file-tree-empty" :style="{ paddingLeft: `${32 + level * 16}px` }">空文件夹</div>
    </div>
  </div>
</template>
