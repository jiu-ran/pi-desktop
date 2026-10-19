<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { StageTab } from "../../kernel/stage.ts";
import { collectChanges } from "../../shared/diff.ts";
import { icons } from "../../shared/util.ts";
import DiffView from "../../components/shared/DiffView.vue";

const props = defineProps<{
  tab: StageTab<{ path: string }>;
}>();

const { workbench, bus } = useKernel();
const ws = computed(() => workbench.active.value);

const changeItem = computed(() =>
  collectChanges(ws.value?.blocks).find((item) => item.path === props.tab.data?.path) ?? null,
);

function openInEditor(): void {
  if (props.tab.data?.path) {
    bus.emit("file:open", props.tab.data.path);
  }
}

function revealExternal(): void {
  if (props.tab.data?.path) {
    workbench
      .openWorkspacePath(props.tab.data.path)
      .catch((err: any) => bus.emit("notify", { level: "error", text: err?.message ?? String(err) }));
  }
}
</script>

<template>
  <section class="stage-view changes-stage">
    <div class="file-editor-toolbar">
      <div class="file-editor-path" :title="tab.data?.path">
        <span class="current">{{ tab.data?.path }}</span>
      </div>
      <template v-if="changeItem">
        <span class="change-kind" :data-kind="changeItem.kind">{{ changeItem.kind }}</span>
        <span class="stat-add">+{{ changeItem.added }}</span>
        <span class="stat-del">−{{ changeItem.removed }}</span>
        <span class="file-editor-meta">共 {{ changeItem.hunks.length }} 次改动</span>
      </template>
      <button type="button" class="btn small" title="在代码编辑器中打开源文件" @click="openInEditor">
        <span v-html="icons.code" />打开源码
      </button>
      <button type="button" class="icon-btn small" title="使用系统程序打开" @click="revealExternal" v-html="icons.reveal" />
    </div>

    <div v-if="!changeItem" class="file-editor-state">
      当前会话中未找到 <code>{{ tab.data?.path }}</code> 的变更记录（可能已切换会话）。
    </div>

    <div v-else class="stage-scroll">
      <div v-for="(hunk, idx) in changeItem.hunks" :key="hunk.id" class="stage-diff-card">
        <header class="stage-diff-head">
          <span>改动片段 #{{ idx + 1 }}</span>
          <span class="mono">{{ hunk.id }}</span>
        </header>
        <DiffView :lines="hunk.lines" />
      </div>
    </div>
  </section>
</template>
