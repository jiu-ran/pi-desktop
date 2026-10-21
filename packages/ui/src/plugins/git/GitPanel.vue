<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";
import { collectChanges } from "../../shared/diff.ts";
import {
  changeCode,
  isSessionOnly,
  isStaged,
  isUnstaged,
  mergeRepoChanges,
  type RepoChange,
} from "../../shared/git-changes.ts";
import type { GitActionName, GitActionPayload, GitCommitNode, GitOverview } from "../../env.d.ts";
import { overviewState, type GitDiffSource, type GitStageData } from "./state.ts";

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);

const overview = ref<GitOverview | null>(null);
const loading = ref(false);
const error = ref("");
const busy = ref<GitActionName | "">("");
const section = ref<"changes" | "commits">("changes");
const filter = ref<"all" | "session">("all");
const commitMessage = ref("");
let request = 0;

const draftKey = computed(() => `pi-desktop.git.commit-draft:${ws.value?.cwd ?? ""}`);

function readDraft(): string {
  try {
    return localStorage.getItem(draftKey.value) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(value: string): void {
  try {
    if (value) localStorage.setItem(draftKey.value, value);
    else localStorage.removeItem(draftKey.value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

async function load(): Promise<void> {
  if (!ws.value?.cwd) {
    overview.value = null;
    overviewState.value = null;
    return;
  }
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const res = await workbench.gitOverview();
    if (current === request) {
      overview.value = res;
      overviewState.value = res;
    }
  } catch (err: any) {
    if (current === request) error.value = err?.message ?? String(err);
  } finally {
    if (current === request) loading.value = false;
  }
}

watch(
  () => ws.value?.cwd,
  () => {
    commitMessage.value = readDraft();
    filter.value = "all";
    section.value = "changes";
    void load();
  },
  { immediate: true },
);

watch(commitMessage, (value) => writeDraft(value));

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void load();
  }, 600);
}

const stopEvents = bus.on("pi:event", ({ event }: { event: any }) => {
  const type = event?.type;
  if (type === "agent_settled" || type === "tool_execution_end" || type === "message_end") scheduleRefresh();
});
const stopFiles = bus.on("files:changed", scheduleRefresh);

onMounted(() => {
  if (!overview.value) void load();
});
onBeforeUnmount(() => {
  stopEvents();
  stopFiles();
  if (refreshTimer) clearTimeout(refreshTimer);
});

/** 本会话中 Agent 改过的文件（与 Git 状态合并后用于标记和过滤） */
const sessionChanges = computed(() => collectChanges(ws.value?.blocks));

const changes = computed(() =>
  mergeRepoChanges({
    cwd: ws.value?.cwd ?? "",
    root: overview.value?.root ?? "",
    status: overview.value?.status ?? [],
    session: sessionChanges.value,
  }),
);

const visibleChanges = computed(() =>
  filter.value === "session" ? changes.value.filter((item) => item.agentTouched) : changes.value,
);

const sessionCount = computed(() => changes.value.filter((item) => item.agentTouched).length);
const stagedCount = computed(() => changes.value.filter(isStaged).length);
const hasRepo = computed(() => Boolean(overview.value?.isRepo));

const groups = computed(() => {
  const list = visibleChanges.value;
  return [
    { id: "staged", label: "已暂存", staged: true, items: list.filter(isStaged) },
    { id: "unstaged", label: "未暂存", staged: false, items: list.filter(isUnstaged) },
    { id: "untracked", label: "未跟踪", staged: false, items: list.filter((item) => item.untracked) },
    {
      id: "committed",
      label: hasRepo.value ? "已提交（本会话）" : "本会话改动",
      staged: false,
      items: list.filter(isSessionOnly),
    },
  ].filter((group) => group.items.length);
});

const canOperate = computed(() => Boolean(overview.value?.isRepo && overview.value?.canWrite && !busy.value));
const canCommit = computed(
  () => canOperate.value && stagedCount.value > 0 && Boolean(commitMessage.value.trim()),
);

async function run(action: GitActionName, payload: GitActionPayload = {}): Promise<void> {
  if (busy.value) return;
  busy.value = action;
  error.value = "";
  try {
    const result = await workbench.gitAction(action, payload);
    overview.value = result.overview;
    overviewState.value = result.overview;
    if (action === "commit") {
      commitMessage.value = "";
      writeDraft("");
    }
    bus.emit("notify", { level: "info", text: result.message });
  } catch (err: any) {
    const text = err?.message ?? String(err);
    error.value = text;
    bus.emit("notify", { level: "error", text });
  } finally {
    busy.value = "";
  }
}

function commit(): void {
  if (!canCommit.value) return;
  void run("commit", { message: commitMessage.value.trim() });
}

function changeKind(change: RepoChange, staged: boolean): string {
  const code = changeCode(change, staged);
  if (change.untracked || code === "A") return "新增";
  if (code === "D") return "删除";
  return "修改";
}

function isActive(change: RepoChange): boolean {
  return stage.activeTab.value?.pluginId === "git" && stage.activeTab.value?.tabId === `working:${change.path}`;
}

function isCommitActive(commit: GitCommitNode): boolean {
  return stage.activeTab.value?.pluginId === "git" && stage.activeTab.value?.tabId === `commit:${commit.hash}`;
}

/** 打开变更详情：有 Git 状态时默认看实时 diff，只有会话快照时看快照 */
function openChange(change: RepoChange): void {
  const hasLive = !isSessionOnly(change);
  const source: GitDiffSource = hasLive ? "live" : "snapshot";
  const data: GitStageData = {
    kind: hasLive ? "working" : "session",
    target: change.path,
    source,
    loading: hasLive,
    error: "",
    detail: null,
    session: change.session ?? null,
    hasLive,
  };
  const tab = stage.open<GitStageData>({
    pluginId: "git",
    tabId: `working:${change.path}`,
    title: `${change.name} · ${hasLive ? "Git" : "会话快照"}`,
    subtitle: change.path,
    data,
  });
  if (hasLive) void loadLive(tab, change);
}

async function loadLive(tab: { title: string; subtitle?: string; data: GitStageData }, change: RepoChange): Promise<void> {
  try {
    const detail = await workbench.gitInspect("working", change.path);
    tab.title = `${change.name} · Git`;
    tab.subtitle = detail.subtitle || change.path;
    tab.data = { ...tab.data, loading: false, error: "", detail, source: "live" };
  } catch (err: any) {
    tab.data = { ...tab.data, loading: false, error: err?.message ?? String(err) };
    bus.emit("notify", { level: "error", text: tab.data.error });
  }
}

async function inspectCommit(commit: GitCommitNode): Promise<void> {
  const tabId = `commit:${commit.hash}`;
  const data: GitStageData = {
    kind: "commit",
    target: commit.hash,
    source: "live",
    loading: true,
    error: "",
    detail: null,
    session: null,
    hasLive: false,
  };
  const tab = stage.open<GitStageData>({
    pluginId: "git",
    tabId,
    title: `Commit ${commit.shortHash}`,
    subtitle: commit.subject,
    data,
  });
  try {
    const detail = await workbench.gitInspect("commit", commit.hash);
    tab.title = detail.title || `Commit ${commit.shortHash}`;
    tab.subtitle = detail.subtitle || commit.subject;
    tab.data = { ...tab.data, loading: false, error: "", detail };
  } catch (err: any) {
    tab.data = { ...tab.data, loading: false, error: err?.message ?? String(err) };
    bus.emit("notify", { level: "error", text: tab.data.error });
  }
}

function openFileInEditor(change: RepoChange): void {
  bus.emit("file:open", change.path);
}

function reveal(change: RepoChange): void {
  workbench
    .openWorkspacePath(change.absPath || change.path)
    .catch((err: any) => bus.emit("notify", { level: "error", text: err?.message ?? String(err) }));
}
</script>

<template>
  <div class="git-panel">
    <div class="files-toolbar">
      <div class="git-branch-chip" :title="overview?.root || 'Git'">
        <span v-html="icons.branch" />
        <strong>{{ hasRepo ? overview?.branch || "HEAD" : "Git" }}</strong>
        <span v-if="overview?.detached" class="git-branch-note">游离</span>
        <span v-if="overview?.ahead" class="git-sync-count" title="本地领先远程的提交数">↑{{ overview.ahead }}</span>
        <span v-if="overview?.behind" class="git-sync-count" title="远程领先本地的提交数">↓{{ overview.behind }}</span>
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

    <div v-if="hasRepo" class="git-sync">
      <button
        type="button"
        class="btn small"
        :disabled="!canOperate || !overview?.hasRemote"
        :title="overview?.hasRemote ? '获取远程更新（不自动合并）' : '没有配置远程仓库'"
        @click="run('fetch')"
      >
        获取
      </button>
      <button
        type="button"
        class="btn small"
        :disabled="!canOperate || !overview?.upstream"
        :title="overview?.upstream ? '拉取并合并远程更新' : '当前分支没有上游分支，先推送一次'"
        @click="run('pull')"
      >
        拉取
      </button>
      <button
        type="button"
        class="btn small"
        :disabled="!canOperate || !overview?.hasRemote"
        :title="overview?.hasRemote ? '推送本地提交到远程' : '没有配置远程仓库'"
        @click="run('push')"
      >
        推送
      </button>
      <span v-if="busy" class="git-sync-busy"><span class="mini-spinner" />{{ busy === "commit" ? "提交中…" : "同步中…" }}</span>
      <span v-else-if="overview?.upstream" class="git-sync-upstream" :title="`上游分支：${overview.upstream}`">
        {{ overview.upstream }}
      </span>
    </div>

    <div v-if="loading && !overview" class="files-state"><span class="mini-spinner" />正在读取 Git 仓库…</div>
    <div v-else-if="!ws" class="files-state">请先打开一个项目目录</div>
    <template v-else>
      <div v-if="error" class="git-error">
        <span>{{ error }}</span>
        <button type="button" class="icon-btn small" title="关闭" @click="error = ''" v-html="icons.close" />
      </div>

      <div v-if="overview && !hasRepo" class="git-init">
        <p class="git-init-title">当前项目还不是 Git 仓库</p>
        <p class="git-init-hint">初始化后即可暂存、提交、推送，并在提交树里查看历史。本会话中 Agent 改动的文件会先列在下面。</p>
        <button type="button" class="btn small primary" :disabled="busy === 'init'" @click="run('init')">
          {{ busy === "init" ? "初始化中…" : "初始化 Git 仓库" }}
        </button>
      </div>

      <div v-if="hasRepo" class="git-subtabs">
        <button type="button" class="git-subtab" :class="{ active: section === 'changes' }" @click="section = 'changes'">
          变更
          <span class="git-subtab-count">{{ changes.length }}</span>
        </button>
        <button type="button" class="git-subtab" :class="{ active: section === 'commits' }" @click="section = 'commits'">
          提交树
          <span class="git-subtab-count">{{ overview?.commits.length ?? 0 }}</span>
        </button>
      </div>

      <template v-if="!hasRepo || section === 'changes'">
        <div v-if="hasRepo" class="git-filter">
          <button type="button" class="git-filter-chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">
            全部 <span>{{ changes.length }}</span>
          </button>
          <button type="button" class="git-filter-chip" :class="{ active: filter === 'session' }" @click="filter = 'session'">
            本会话 <span>{{ sessionCount }}</span>
          </button>
          <button
            type="button"
            class="btn small git-stage-all"
            :disabled="!canOperate || !changes.some((item) => !isStaged(item) && !isSessionOnly(item))"
            title="暂存所有未提交改动"
            @click="run('stage', { all: true })"
          >
            全部暂存
          </button>
        </div>

        <div class="git-change-scroll">
          <p v-if="!visibleChanges.length" class="list-empty">
            {{ !hasRepo ? "本会话还没有修改文件" : filter === "session" ? "本会话还没有修改文件" : "工作区干净，没有未提交修改" }}
          </p>

          <section v-for="group in groups" :key="group.id" class="git-section">
            <header class="git-section-head">
              <span>{{ group.label }}</span>
              <span class="git-section-count">{{ group.items.length }}</span>
            </header>
            <div
              v-for="change in group.items"
              :key="`${group.id}:${change.path}`"
              class="change-row git-change-row"
              :class="{ active: isActive(change) }"
              role="button"
              tabindex="0"
              :title="`查看 ${change.path} 的${group.id === 'committed' ? '会话快照' : ' Git Diff'}`"
              @click="openChange(change)"
            >
              <span class="change-kind" :data-kind="changeKind(change, group.staged)">
                {{ changeCode(change, group.staged) }}
              </span>
              <span class="change-name">{{ change.name }}</span>
              <span class="change-dir">{{ change.dir }}</span>
              <span v-if="change.agentTouched" class="git-agent-tag" title="本会话中 Agent 修改过">Agent</span>
              <span class="git-row-actions">
                <button
                  v-if="hasRepo && group.id !== 'committed' && group.staged"
                  type="button"
                  class="icon-btn small"
                  title="取消暂存"
                  :disabled="!canOperate"
                  @click.stop="run('unstage', { paths: [change.path] })"
                  v-html="icons.close"
                />
                <button
                  v-else-if="hasRepo && group.id !== 'committed'"
                  type="button"
                  class="icon-btn small"
                  title="暂存此文件"
                  :disabled="!canOperate"
                  @click.stop="run('stage', { paths: [change.path] })"
                  v-html="icons.plus"
                />
                <button
                  type="button"
                  class="icon-btn small"
                  title="在代码编辑器中打开源码"
                  @click.stop="openFileInEditor(change)"
                  v-html="icons.code"
                />
                <button
                  type="button"
                  class="icon-btn small"
                  title="在资源管理器中显示"
                  @click.stop="reveal(change)"
                  v-html="icons.reveal"
                />
              </span>
            </div>
          </section>
        </div>
      </template>

      <div v-else class="git-commit-list">
        <p v-if="!overview?.commits.length" class="list-empty">
          {{ overview?.hasCommits ? "暂无提交历史" : "还没有提交，暂存文件后即可创建第一个提交" }}
        </p>
        <button
          v-for="commit in overview?.commits ?? []"
          :key="commit.hash || commit.graph + commit.subject"
          type="button"
          class="git-commit-row"
          :class="{ active: commit.hash && isCommitActive(commit), 'graph-only': !commit.hash }"
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

      <div v-if="hasRepo && section === 'changes'" class="git-commit-box">
        <template v-if="overview?.canWrite">
          <textarea
            v-model="commitMessage"
            class="git-commit-input"
            rows="3"
            spellcheck="false"
            placeholder="提交信息，例如：修复会话分页（Ctrl+Enter 提交）"
            @keydown.ctrl.enter.prevent="commit"
            @keydown.meta.enter.prevent="commit"
          />
          <div class="git-commit-actions">
            <span class="git-commit-hint">
              {{ stagedCount ? `已暂存 ${stagedCount} 个文件` : "先暂存要提交的文件" }}
            </span>
            <button type="button" class="btn small primary" :disabled="!canCommit" @click="commit">
              {{ busy === "commit" ? "提交中…" : "提交" }}
            </button>
          </div>
        </template>
        <p v-else class="git-commit-hint">无法在此提交：仓库根目录不在当前项目内，或未检测到可用的 git 命令。</p>
      </div>
    </template>
  </div>
</template>
