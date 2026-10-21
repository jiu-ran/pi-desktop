<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { StageTab } from "../../kernel/stage.ts";
import { diffStat, mergeHunks, parseUnifiedDiff } from "../../shared/diff.ts";
import DiffView from "../../components/shared/DiffView.vue";
import type { GitDiffSource, GitStageData } from "./state.ts";

const props = defineProps<{ tab: StageTab<GitStageData> }>();
const { workbench, bus } = useKernel();
const data = computed(() => props.tab.data);
const detail = computed(() => data.value?.detail ?? null);
const snapshot = computed(() => (data.value?.source === "snapshot" ? data.value.session : null));
// 同一文件的多次会话改动合成一份连续 diff，不再按工具调用拆成多张卡片
const snapshotLines = computed(() => mergeHunks(snapshot.value?.hunks ?? []));
const snapshotStat = computed(() => diffStat(snapshotLines.value));
const canToggle = computed(() => Boolean(data.value?.session && data.value?.hasLive));
const liveFiles = computed(() => parseUnifiedDiff(detail.value?.diff ?? ""));

function openFile(path: string): void {
  if (path) bus.emit("file:open", path);
}

async function switchSource(next: GitDiffSource): Promise<void> {
  const current = data.value;
  if (!current || current.source === next) return;
  if (next === "snapshot") {
    props.tab.data = { ...current, source: "snapshot", detail: null, error: "", loading: false };
    return;
  }
  props.tab.data = { ...current, source: "live", loading: true, error: "" };
  try {
    const nextDetail = await workbench.gitInspect("working", current.target);
    props.tab.data = { ...props.tab.data, detail: nextDetail, loading: false, error: "" };
  } catch (err: any) {
    props.tab.data = { ...props.tab.data, loading: false, error: err?.message ?? String(err) };
  }
}
</script>

<template>
  <section class="git-detail">
    <header class="git-detail-head">
      <div class="git-detail-title">
        <strong>{{ detail?.title || tab.title }}</strong>
        <span
          v-if="(detail?.subtitle || tab.subtitle) && (detail?.subtitle || tab.subtitle) !== (detail?.title || tab.title)"
          class="git-detail-sub"
          :title="detail?.subtitle || tab.subtitle"
        >
          {{ detail?.subtitle || tab.subtitle }}
        </span>
      </div>
      <div class="git-detail-actions">
        <div v-if="canToggle" class="git-source-toggle">
          <button type="button" :class="{ active: data?.source === 'live' }" @click="switchSource('live')">实时 Diff</button>
          <button type="button" :class="{ active: data?.source === 'snapshot' }" @click="switchSource('snapshot')">会话快照</button>
        </div>
        <button
          v-if="data?.kind !== 'commit'"
          type="button"
          class="btn small"
          title="在代码编辑器中打开源文件"
          @click="openFile(data?.target ?? '')"
        >
          打开源码
        </button>
      </div>
    </header>

    <p v-if="data?.loading">正在读取 Git 详情…</p>
    <p v-else-if="data?.error" class="git-detail-error">{{ data.error }}</p>

    <template v-else-if="snapshot">
      <article class="git-diff-card">
        <header class="git-diff-head">
          <span class="change-kind" :data-kind="snapshot.kind">{{ snapshot.kind }}</span>
          <button type="button" class="git-diff-path" :title="snapshot.path" @click="openFile(snapshot.path)">
            {{ snapshot.name }}
          </button>
          <span class="git-detail-meta-inline" title="会话记录里保存的改动，可能已提交或与当前磁盘不同">会话快照</span>
          <span class="git-diff-stats">
            <span class="add">+{{ snapshotStat.added }}</span>
            <span class="del">−{{ snapshotStat.removed }}</span>
          </span>
        </header>
        <DiffView v-if="snapshotLines.length" :lines="snapshotLines" />
        <p v-else class="git-detail-empty">这次改动没有可展示的差异内容</p>
      </article>
    </template>

    <template v-else>
      <pre v-if="detail?.meta" class="git-detail-meta">{{ detail.meta }}</pre>
      <article v-for="file in liveFiles" :key="file.file" class="git-diff-card">
        <header class="git-diff-head">
          <button type="button" class="git-diff-path" :title="file.file" @click="openFile(file.file)">{{ file.file }}</button>
          <span class="git-diff-stats">
            <span class="add">+{{ file.added }}</span>
            <span class="del">−{{ file.removed }}</span>
          </span>
        </header>
        <DiffView :lines="file.lines" />
      </article>
      <p v-if="!liveFiles.length" class="git-detail-empty">{{ detail?.diff || "没有差异内容" }}</p>
    </template>
  </section>
</template>

<style scoped>
.git-detail { height: 100%; overflow: auto; padding: 12px; background: var(--bg); color: var(--fg); }
.git-detail-head, .git-diff-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.git-detail-head { margin-bottom: 12px; }
.git-detail-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.git-detail-sub { overflow: hidden; color: var(--fg-2); font: 11.5px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.git-detail-head span, .git-detail-meta { color: var(--fg-2); }
.git-detail-actions { display: flex; flex: none; align-items: center; gap: 8px; margin-left: auto; }
.git-detail-actions .btn { flex: none; white-space: nowrap; }
.git-source-toggle { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-2); }
.git-source-toggle button { padding: 2px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--fg-2); font-size: 11px; cursor: pointer; }
.git-source-toggle button.active { background: var(--bg); color: var(--fg); font-weight: 600; }
.git-detail-error { color: var(--warn); }
.git-detail-empty { margin: 0; padding: 12px; color: var(--fg-3); font-size: 12px; white-space: pre-wrap; }
.git-diff-card { margin-bottom: 10px; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; }
.git-diff-head {
  justify-content: flex-start;
  min-height: 34px;
  padding: 0 10px;
  background: var(--bg-2);
  font-size: 12px;
}
.git-diff-stats { display: inline-flex; flex: none; gap: 6px; margin-left: auto; }
.git-diff-path { min-width: 0; overflow: hidden; border: 0; background: transparent; color: var(--fg); font: 12px var(--mono); text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.git-diff-path:hover { color: var(--accent); }
.add { color: var(--ok-fg); font: 11.5px var(--mono); }
.del { color: var(--del-fg); font: 11.5px var(--mono); }
.change-kind {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font: 10px/16px var(--mono);
}
.git-diff-card :deep(.diff-view) {
  max-height: none;
  border: 0;
  border-radius: 0;
}
.git-detail-meta { white-space: pre-wrap; }
</style>
