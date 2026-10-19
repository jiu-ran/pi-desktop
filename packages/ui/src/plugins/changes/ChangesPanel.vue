<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";
import { collectChanges, totals, type ChangeFileItem } from "../../shared/diff.ts";

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);
const files = computed(() => collectChanges(ws.value?.blocks));
const sum = computed(() => totals(files.value));

function isActive(file: ChangeFileItem): boolean {
  return stage.activeTab.value?.pluginId === "changes" && stage.activeTab.value?.tabId === file.path;
}

function openDiffInStage(file: ChangeFileItem): void {
  stage.open({
    pluginId: "changes",
    tabId: file.path,
    title: `${file.name} · 变更`,
    subtitle: file.path,
    data: { path: file.path },
  });
}

function openInEditor(file: ChangeFileItem): void {
  bus.emit("file:open", file.path);
}

function reveal(file: ChangeFileItem): void {
  workbench
    .openWorkspacePath(file.path)
    .catch((err: any) => bus.emit("notify", { level: "error", text: err?.message ?? String(err) }));
}
</script>

<template>
  <div class="changes-panel">
    <div v-if="files.length" class="changes-summary">
      <span>{{ files.length }} 个文件已修改</span>
      <span class="stat-add">+{{ sum.added }}</span>
      <span class="stat-del">−{{ sum.removed }}</span>
    </div>

    <div v-if="files.length" class="changes-list">
      <div
        v-for="file in files"
        :key="file.path"
        class="change-row"
        :class="{ active: isActive(file) }"
        role="button"
        tabindex="0"
        :title="`在详情视图中查看 ${file.path} 的变更差异`"
        @click="openDiffInStage(file)"
      >
        <span class="change-kind" :data-kind="file.kind">{{ file.kind === "新增" ? "A" : "M" }}</span>
        <span class="change-name">{{ file.name }}</span>
        <span class="change-dir">{{ file.dir }}</span>
        <span class="stat-add">+{{ file.added }}</span>
        <span class="stat-del">−{{ file.removed }}</span>
        <button
          type="button"
          class="icon-btn small"
          title="在编辑器中打开源码"
          @click.stop="openInEditor(file)"
          v-html="icons.code"
        />
        <button
          type="button"
          class="icon-btn small"
          title="在资源管理器中显示"
          @click.stop="reveal(file)"
          v-html="icons.reveal"
        />
      </div>
    </div>

    <p v-else class="list-empty">
      当前会话还没有修改文件。Agent 使用 <code>edit</code> / <code>write</code> 改动的文件会汇总在这里，点击即可在详情视图中对比差异。
    </p>
  </div>
</template>
