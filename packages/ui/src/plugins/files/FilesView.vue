<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons } from "../../shared/util.ts";
import FileTreeNode from "./FileTreeNode.vue";

const { workbench, bus } = useKernel();
const state = workbench.state;
const ws = computed(() => workbench.active.value);
const entries = ref([]);
const loading = ref(false);
const error = ref("");
let request = 0;

async function load() {
  const cwd = ws.value?.cwd;
  if (!cwd) { entries.value = []; return; }
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const result = await workbench.listDirectory("");
    if (current === request) entries.value = result;
  } catch (reason) {
    if (current === request) error.value = reason?.message ?? String(reason);
  } finally {
    if (current === request) loading.value = false;
  }
}

watch(() => ws.value?.cwd, load, { immediate: true });

function refresh() { load(); }
function chooseProject() {
  workbench.chooseAndOpen().catch((reason) => bus.emit("notify", { level: "error", text: reason?.message ?? String(reason) }));
}
</script>

<template>
  <div class="files-view">
    <div class="files-toolbar">
      <span class="files-root" :title="ws?.cwd || '未打开项目'">{{ ws ? (ws.name || baseName(ws.cwd)) : "未打开项目" }}</span>
      <div class="files-actions">
        <button class="icon-btn small" title="刷新文件树" :disabled="loading" @click="refresh" v-html="icons.refresh" />
        <button class="icon-btn small" title="切换项目目录" @click="chooseProject" v-html="icons.folder" />
      </div>
    </div>
    <div v-if="loading" class="files-state"><span class="mini-spinner" />正在读取目录…</div>
    <div v-else-if="error" class="files-state error">
      <span>{{ error }}</span>
      <button class="btn" @click="refresh">重试</button>
    </div>
    <div v-else-if="!ws" class="files-state">
      <span>请先打开一个项目目录</span>
      <button class="btn" @click="chooseProject">打开目录</button>
    </div>
    <div v-else-if="!entries.length" class="files-state">目录为空</div>
    <div v-else class="files-tree">
      <FileTreeNode v-for="item in entries" :key="item.path" :item="item" />
    </div>
  </div>
</template>
