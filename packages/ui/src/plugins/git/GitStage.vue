<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { StageTab } from "../../kernel/stage.ts";
import { diffStat } from "../../shared/diff.ts";
import DiffView from "../../components/shared/DiffView.vue";
import type { GitDiffSource, GitStageData } from "./state.ts";

interface GitLine { kind: "add" | "del" | "ctx" | "meta"; text: string; oldNo: string; newNo: string }
interface GitFile { path: string; added: number; removed: number; lines: GitLine[] }

const props = defineProps<{ tab: StageTab<GitStageData> }>();
const { workbench, bus } = useKernel();
const data = computed(() => props.tab.data);
const detail = computed(() => data.value?.detail ?? null);
const snapshot = computed(() => (data.value?.source === "snapshot" ? data.value.session : null));
const snapshotLines = computed(() => snapshot.value?.hunks.flatMap((hunk) => hunk.lines) ?? []);
const snapshotStat = computed(() => diffStat(snapshotLines.value));
const canToggle = computed(() => Boolean(data.value?.session && data.value?.hasLive));

const files = computed(() => {
  const output: GitFile[] = [];
  let file: GitFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of (detail.value?.diff ?? "").split(/\r?\n/)) {
    if (!raw || raw.startsWith("\\") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("diff --git ")) {
      const match = raw.match(/^(?:diff --git a\/.+ b\/|\+\+\+ b\/)(.+)$/);
      if (match) {
        file = { path: match[1], added: 0, removed: 0, lines: [] };
        output.push(file);
      }
      continue;
    }
    if (!file) continue;
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      if (hunk[3]?.trim()) file.lines.push({ kind: "meta", text: hunk[3].trim(), oldNo: "", newNo: "" });
      continue;
    }
    const kind = raw.startsWith("+") ? "add" : raw.startsWith("-") ? "del" : "ctx";
    const text = raw.slice(1);
    if (!text.trim()) continue;
    file.lines.push({
      kind,
      text,
      oldNo: kind === "add" ? "" : String(oldNo),
      newNo: kind === "del" ? "" : String(newNo),
    });
    if (kind !== "add") oldNo += 1;
    if (kind !== "del") newNo += 1;
    if (kind === "add") file.added += 1;
    if (kind === "del") file.removed += 1;
  }
  return output.filter((item) => item.lines.length);
});

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
      <div>
        <strong>{{ detail?.title || tab.title }}</strong>
        <span v-if="(detail?.subtitle || tab.subtitle) && (detail?.subtitle || tab.subtitle) !== (detail?.title || tab.title)">
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
      <div class="git-snapshot-head">
        <span class="change-kind" :data-kind="snapshot.kind">{{ snapshot.kind }}</span>
        <span class="stat-add">+{{ snapshotStat.added }}</span>
        <span class="stat-del">−{{ snapshotStat.removed }}</span>
        <span class="git-detail-meta-inline">共 {{ snapshot.hunks.length }} 次改动 · 会话快照，可能已提交或与当前磁盘不同</span>
      </div>
      <div v-for="(hunk, idx) in snapshot.hunks" :key="hunk.id" class="stage-diff-card">
        <header class="stage-diff-head">
          <span>改动片段 #{{ idx + 1 }}</span>
          <span class="mono">{{ hunk.id }}</span>
        </header>
        <DiffView :lines="hunk.lines" />
      </div>
    </template>

    <template v-else>
      <pre v-if="detail?.meta" class="git-detail-meta">{{ detail.meta }}</pre>
      <article v-for="file in files" :key="file.path" class="git-file">
        <header>
          <button type="button" @click="openFile(file.path)">{{ file.path }}</button>
          <span class="add">+{{ file.added }}</span>
          <span class="del">−{{ file.removed }}</span>
        </header>
        <div class="git-lines">
          <div v-for="(line, index) in file.lines" :key="index" :data-kind="line.kind">
            <span>{{ line.newNo || line.oldNo }}</span>
            <code>{{ line.text }}</code>
          </div>
        </div>
      </article>
      <pre v-if="!data?.loading && !files.length" class="git-detail-meta">{{ detail?.diff || "没有差异内容" }}</pre>
    </template>
  </section>
</template>

<style scoped>
.git-detail { height: 100%; overflow: auto; padding: 12px; background: var(--bg); color: var(--fg); }
.git-detail-head, .git-file header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.git-detail-head { margin-bottom: 12px; }
.git-detail-head span, .git-detail-meta { color: var(--fg-2); }
.git-detail-actions { display: flex; align-items: center; gap: 8px; }
.git-source-toggle { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-2); }
.git-source-toggle button { padding: 2px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--fg-2); font-size: 11px; cursor: pointer; }
.git-source-toggle button.active { background: var(--bg); color: var(--fg); font-weight: 600; }
.git-snapshot-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.git-detail-meta-inline { color: var(--fg-3); font-size: 11.5px; }
.git-detail-error { color: var(--warn); }
.git-file { margin-bottom: 10px; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; }
.git-file header { min-height: 34px; padding: 0 10px; background: var(--bg-2); }
.git-file button, .git-detail button { border: 0; background: transparent; color: var(--fg); cursor: pointer; }
.add { color: var(--ok-fg); }
.del { color: var(--del-fg); }
.git-lines { font: 12px/20px var(--mono); }
.git-lines div { display: grid; grid-template-columns: 54px minmax(0, 1fr); border-left: 3px solid transparent; }
.git-lines div[data-kind="add"] { border-left-color: var(--ok-fg); }
.git-lines div[data-kind="del"] { border-left-color: var(--del-fg); }
.git-lines span { padding-right: 10px; color: var(--fg-3); text-align: right; user-select: none; }
.git-lines code { padding-right: 12px; white-space: pre; }
.git-lines div[data-kind="add"] { background: var(--add-bg); }
.git-lines div[data-kind="del"] { background: var(--del-bg); }
.git-detail-meta { white-space: pre-wrap; }
</style>
