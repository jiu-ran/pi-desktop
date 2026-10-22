<script setup lang="ts">
import { computed, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { StageTab } from "../../kernel/stage.ts";
import { diffStat, mergeHunks, parseUnifiedDiff } from "../../shared/diff.ts";
import DiffView from "../../components/shared/DiffView.vue";
import type { GitDiffSource, GitStageData } from "./state.ts";
import { appendDraft, buildReviewPrompt, type ReviewComment, type ReviewCommentDraft } from "../../shared/review.ts";

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
/** 评审意见只挂在当前实时 diff 上：已提交的 commit 和会话快照不可直接修改。 */
const reviewable = computed(() => data.value?.source === "live" && data.value?.kind !== "commit" && Boolean(detail.value));
const reviewComments = ref<ReviewComment[]>([]);
let reviewSeq = 0;

function commentsFor(path: string): ReviewComment[] {
  return reviewComments.value.filter((comment) => comment.path === path);
}

function addReviewComment(path: string, draft: ReviewCommentDraft): void {
  reviewComments.value = [
    ...reviewComments.value,
    { ...draft, path, id: `review-${Date.now().toString(36)}-${(reviewSeq += 1)}` },
  ];
}

function removeReviewComment(id: string): void {
  reviewComments.value = reviewComments.value.filter((comment) => comment.id !== id);
}

function clearReviewComments(): void {
  reviewComments.value = [];
}

function sendReviewToChat(): void {
  const prompt = buildReviewPrompt(reviewComments.value);
  const ws = workbench.active.value;
  if (!prompt || !ws) return;
  const count = reviewComments.value.length;
  bus.emit("composer:set", { cwd: ws.cwd, text: appendDraft(ws.draft, prompt) });
  reviewComments.value = [];
  bus.emit("notify", { level: "info", text: `已把 ${count} 条评审意见加入输入框，可继续编辑后发送` });
}

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

    <div v-if="reviewComments.length" class="git-review-bar">
      <span class="git-review-count">已添加 {{ reviewComments.length }} 条评审意见</span>
      <span class="git-review-note">{{ reviewable ? "随文件 · 行号 · 代码加入输入框" : "评审已暂存，切回实时 Diff 查看行内位置" }}</span>
      <button type="button" class="btn small" @click="clearReviewComments">清空</button>
      <button type="button" class="btn small primary" @click="sendReviewToChat">加入输入框</button>
    </div>
    <p v-else-if="reviewable" class="git-review-hint">悬停 diff 行左侧的 + 可添加评审意见，统一加入输入框后发送给 Agent。</p>

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
          <span v-if="commentsFor(file.file).length" class="git-review-file-count">{{ commentsFor(file.file).length }} 条评审</span>
          <span class="git-diff-stats">
            <span class="add">+{{ file.added }}</span>
            <span class="del">−{{ file.removed }}</span>
          </span>
        </header>
        <DiffView
          :lines="file.lines"
          :reviewable="reviewable"
          :comments="commentsFor(file.file)"
          @comment="addReviewComment(file.file, $event)"
          @remove="removeReviewComment"
        />
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
.git-review-hint {
  margin: -4px 0 10px;
  padding: 6px 8px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius-sm);
  color: var(--fg-3);
  font-size: 11.5px;
}
.git-review-bar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: -4px 0 10px;
  padding: 6px 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent) 7%, var(--bg));
}
.git-review-count { color: var(--accent); font-size: 12px; font-weight: 600; }
.git-review-note { flex: 1; color: var(--fg-3); font-size: 11px; }
.git-review-bar .btn { flex: none; }
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
.git-review-file-count { flex: none; padding: 0 5px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-size: 10px; line-height: 16px; }
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
