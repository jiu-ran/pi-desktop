<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons } from "../../shared/util.ts";
import type { GitCommitNode, GitInspectResult, GitOverview, GitStatusFile } from "../../env.d.ts";

export interface GitStageData {
  kind: "commit" | "working";
  target: string;
  loading: boolean;
  error: string;
  detail: GitInspectResult | null;
}

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);

const overview = ref<GitOverview | null>(null);
const loading = ref(false);
const error = ref("");
const activeSection = ref<"commits" | "status">("commits");
let request = 0;

async function load(): Promise<void> {
  if (!ws.value?.cwd) {
    overview.value = null;
    return;
  }
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const res = await workbench.gitOverview();
    if (current === request) {
      overview.value = res;
    }
  } catch (err: any) {
    if (current === request) {
      error.value = err?.message ?? String(err);
    }
  } finally {
    if (current === request) {
      loading.value = false;
    }
  }
}

watch(() => ws.value?.cwd, load, { immediate: true });

function isActive(kind: "commit" | "working", target: string): boolean {
  return (
    stage.activeTab.value?.pluginId === "git" &&
    stage.activeTab.value?.tabId === `${kind}:${target}`
  );
}

async function inspect(kind: "commit" | "working", target: string, title: string, subtitle: string): Promise<void> {
  const tabId = `${kind}:${target}`;
  const initialData: GitStageData = {
    kind,
    target,
    loading: true,
    error: "",
    detail: null,
  };
  const tab = stage.open<GitStageData>({
    pluginId: "git",
    tabId,
    title,
    subtitle,
    data: initialData,
  });

  try {
    const detail = await workbench.gitInspect(kind, target);
    tab.title = detail.title || title;
    tab.subtitle = detail.subtitle || subtitle;
    tab.data = {
      kind,
      target,
      loading: false,
      error: "",
      detail,
    };
  } catch (err: any) {
    tab.data.loading = false;
    tab.data.error = err?.message ?? String(err);
    bus.emit("notify", { level: "error", text: tab.data.error });
  }
}

function inspectCommit(commit: GitCommitNode): void {
  inspect("commit", commit.hash, `Commit ${commit.shortHash}`, commit.subject);
}

function inspectStatus(item: GitStatusFile): void {
  inspect("working", item.path, `${baseName(item.path)} · Git`, item.path);
}

function openFileInEditor(path: string): void {
  bus.emit("file:open", path);
}
</script>

<template>
  <div class="git-panel">
    <div class="files-toolbar">
      <div class="git-branch-chip" :title="overview?.branch || 'Git'">
        <span v-html="icons.branch" />
        <strong>{{ overview?.isRepo ? overview.branch || "HEAD" : "Git" }}</strong>
      </div>
      <div class="files-actions">
        <button
          type="button"
          class="icon-btn small"
          title="刷新 Git 状态与提交树"
          :disabled="loading"
          @click="load"
          v-html="icons.refresh"
        />
      </div>
    </div>

    <div v-if="overview?.isRepo" class="git-subtabs">
      <button
        type="button"
        class="git-subtab"
        :class="{ active: activeSection === 'commits' }"
        @click="activeSection = 'commits'"
      >
        提交树
        <span class="git-subtab-count">{{ overview.commits.length }}</span>
      </button>
      <button
        type="button"
        class="git-subtab"
        :class="{ active: activeSection === 'status' }"
        @click="activeSection = 'status'"
      >
        工作区变更
        <span class="git-subtab-count">{{ overview.status.length }}</span>
      </button>
    </div>

    <div v-if="loading && !overview" class="files-state"><span class="mini-spinner" />正在读取 Git 仓库…</div>
    <div v-else-if="error" class="files-state error">
      <span>{{ error }}</span>
      <button type="button" class="btn" @click="load">重试</button>
    </div>
    <div v-else-if="!ws" class="files-state">请先打开一个项目目录</div>
    <div v-else-if="!overview?.isRepo" class="files-state">当前目录不是 Git 仓库</div>

    <div v-else-if="activeSection === 'commits'" class="git-commit-list">
      <p v-if="!overview.commits.length" class="list-empty">暂无提交历史</p>
      <button
        v-for="commit in overview.commits"
        :key="commit.hash || commit.graph + commit.subject"
        type="button"
        class="git-commit-row"
        :class="{ active: commit.hash && isActive('commit', commit.hash), 'graph-only': !commit.hash }"
        :disabled="!commit.hash"
        :title="commit.hash ? `${commit.shortHash} — ${commit.subject}` : ''"
        @click="commit.hash && inspectCommit(commit)"
      >
        <span class="git-graph">{{ commit.graph }}</span>
        <template v-if="commit.hash">
          <div class="git-commit-main">
            <div class="git-commit-top">
              <span class="git-commit-subject">{{ commit.subject }}</span>
            </div>
            <div class="git-commit-meta">
              <span class="git-commit-hash">{{ commit.shortHash }}</span>
              <span v-if="commit.refs" class="git-commit-ref">{{ commit.refs }}</span>
              <span>{{ commit.author }}</span>
              <span>{{ commit.relativeTime }}</span>
            </div>
          </div>
        </template>
      </button>
    </div>

    <div v-else class="git-status-list">
      <p v-if="!overview.status.length" class="list-empty">工作区干净，没有未提交修改</p>
      <div
        v-for="item in overview.status"
        :key="item.path"
        class="change-row"
        :class="{ active: isActive('working', item.path) }"
        role="button"
        tabindex="0"
        :title="`在详情视图中查看 ${item.path} 的 Git Diff`"
        @click="inspectStatus(item)"
      >
        <span class="change-kind" :data-kind="item.code === '?' ? '新增' : '修改'">{{ item.code }}</span>
        <span class="change-name">{{ baseName(item.path) }}</span>
        <span class="change-dir">{{ item.path }}</span>
        <button
          type="button"
          class="icon-btn small"
          title="在代码编辑器中打开源码"
          @click.stop="openFileInEditor(item.path)"
          v-html="icons.code"
        />
      </div>
    </div>
  </div>
</template>
