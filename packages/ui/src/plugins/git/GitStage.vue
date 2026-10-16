<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { StageTab } from "../../kernel/stage.ts";
import { parseUnifiedDiff } from "../../shared/diff.ts";
import { icons } from "../../shared/util.ts";
import DiffView from "../../components/shared/DiffView.vue";
import type { GitStageData } from "./GitPanel.vue";

const props = defineProps<{
  tab: StageTab<GitStageData>;
}>();

const { bus } = useKernel();
const data = computed(() => props.tab.data);
const detail = computed(() => data.value?.detail ?? null);
const parsedFiles = computed(() => (detail.value?.diff ? parseUnifiedDiff(detail.value.diff) : []));

function openFile(filePath: string): void {
  if (filePath) bus.emit("file:open", filePath);
}
</script>

<template>
  <section class="stage-view git-stage">
    <div class="file-editor-toolbar">
      <div class="file-editor-path" :title="detail?.subtitle || tab.subtitle">
        <span class="current">{{ detail?.title || tab.title }}</span>
        <span v-if="detail?.subtitle" class="file-editor-sep">·</span>
        <span v-if="detail?.subtitle">{{ detail.subtitle }}</span>
      </div>
      <button
        v-if="data?.kind === 'working' && data?.target"
        type="button"
        class="btn small"
        title="在代码编辑器中打开源文件"
        @click="openFile(data.target)"
      >
        <span v-html="icons.code" />打开源码
      </button>
    </div>

    <div v-if="data?.loading" class="file-editor-state"><span class="mini-spinner" />正在读取 Git 详情…</div>
    <div v-else-if="data?.error" class="file-editor-state error">{{ data.error }}</div>
    <div v-else-if="detail" class="stage-scroll">
      <pre v-if="detail.meta" class="git-inspect-meta">{{ detail.meta }}</pre>

      <template v-if="parsedFiles.length">
        <div v-for="file in parsedFiles" :key="file.file" class="stage-diff-card">
          <header class="stage-diff-head">
            <span class="mono">{{ file.file }}</span>
            <div class="stage-diff-stats">
              <span class="stat-add">+{{ file.added }}</span>
              <span class="stat-del">−{{ file.removed }}</span>
              <button
                type="button"
                class="icon-btn small"
                title="在编辑器中打开该文件"
                @click="openFile(file.file)"
                v-html="icons.code"
              />
            </div>
          </header>
          <DiffView :lines="file.lines" />
        </div>
      </template>

      <pre v-else class="term-out">{{ detail.diff || "（无差异内容）" }}</pre>
    </div>
  </section>
</template>
