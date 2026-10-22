<!-- 工作区与变更展示参考 ThinkRail（Apache-2.0），见 THIRD-PARTY-NOTICES.md。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";
import { askConfirm, askPrompt } from "../../components/sidebar/ui.ts";
import { collectChanges } from "../../shared/diff.ts";
import {
  badgeCode,
  badgeKind,
  isSessionOnly,
  isStaged,
  mergeRepoChanges,
  pathKey,
  type RepoChange,
} from "../../shared/git-changes.ts";
import { buildChangeTree, flattenChangeTree, type ChangeTreeRow } from "../../shared/git-tree.ts";
import type { GitActionName, GitActionPayload, GitCommitNode, GitOverview, GitWorktree } from "../../env.d.ts";
import { overviewState, type GitDiffSource, type GitStageData } from "./state.ts";

interface PanelRow extends ChangeTreeRow {
  /** 文件夹下的文件总数 / 已暂存数 */
  total?: number;
  stagedCount?: number;
}

interface PanelSection {
  id: "changes" | "untracked" | "committed";
  label: string;
  items: RepoChange[];
  rows: PanelRow[];
  total: number;
  staged: number;
  collapsed: boolean;
}

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);

const overview = ref<GitOverview | null>(null);
const loading = ref(false);
const error = ref("");
const busy = ref<GitActionName | "">("");
const history = ref(false);
const worktreesOpen = ref(false);
const worktrees = ref<GitWorktree[]>([]);
const worktreeBusy = ref("");
const worktreeError = ref("");
const commitMessage = ref("");
const collapsedFolders = reactive(new Set<string>());
const collapsedGroups = reactive(new Set<string>());
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
      void loadWorktrees();
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
    history.value = false;
    worktreesOpen.value = false;
    worktrees.value = [];
    worktreeError.value = "";
    collapsedFolders.clear();
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

// 隔离工作区：从当前 HEAD 派生独立分支与目录，作为新项目打开（参考 ThinkRail 的 worktree 工作区）。
async function loadWorktrees(): Promise<void> {
  if (!ws.value?.cwd || !overview.value?.isRepo) {
    worktrees.value = [];
    return;
  }
  try {
    worktrees.value = await workbench.gitWorktrees();
    worktreeError.value = "";
  } catch (err: any) {
    worktrees.value = [];
    worktreeError.value = err?.message ?? String(err);
  }
}

async function toggleWorktrees(): Promise<void> {
  worktreesOpen.value = !worktreesOpen.value;
  if (worktreesOpen.value) {
    history.value = false;
    await loadWorktrees();
  }
}

function toggleHistory(): void {
  history.value = !history.value;
  if (history.value) worktreesOpen.value = false;
}

const isolatedCount = computed(() => worktrees.value.filter((worktree) => !worktree.primary).length);

const canCreateWorktree = computed(
  () => Boolean(overview.value?.isRepo && overview.value?.canWrite && overview.value?.hasCommits && !worktreeBusy.value),
);

function isWorktreeActive(worktree: GitWorktree): boolean {
  if (!ws.value?.cwd) return false;
  return pathKey(ws.value.cwd) === pathKey(worktree.path);
}

async function createWorktree(): Promise<void> {
  const name = await askPrompt({
    title: "新建隔离工作区",
    message: "从当前 HEAD 创建独立分支和工作目录，并在新项目中打开。适合并行运行互不干扰的任务；改动不会影响当前工作区。",
    label: "任务名",
    placeholder: "例如 fix-login",
    confirmLabel: "创建",
  });
  if (!name) return;
  worktreeBusy.value = "create";
  worktreeError.value = "";
  try {
    const result = await workbench.createGitWorktree(name);
    bus.emit("notify", { level: "info", text: result.message });
    await workbench.open(result.worktree.path);
    await loadWorktrees();
  } catch (err: any) {
    worktreeError.value = err?.message ?? String(err);
    bus.emit("notify", { level: "error", text: worktreeError.value });
  } finally {
    worktreeBusy.value = "";
  }
}

async function openWorktree(worktree: GitWorktree): Promise<void> {
  if (isWorktreeActive(worktree)) return;
  worktreeBusy.value = worktree.path;
  try {
    await workbench.open(worktree.path);
  } catch (err: any) {
    worktreeError.value = err?.message ?? String(err);
    bus.emit("notify", { level: "error", text: worktreeError.value });
  } finally {
    worktreeBusy.value = "";
  }
}

async function removeWorktree(worktree: GitWorktree): Promise<void> {
  const confirmed = await askConfirm({
    title: "移除隔离工作区",
    message: `将删除目录：
${worktree.path}

未提交的改动会一起丢失；分支 ${worktree.branch || "detached"} 会保留。`,
    confirmLabel: "移除",
    danger: true,
  });
  if (!confirmed) return;
  worktreeBusy.value = worktree.path;
  worktreeError.value = "";
  try {
    const result = await workbench.removeGitWorktree(worktree.path);
    bus.emit("notify", { level: "info", text: result.message });
    await load();
  } catch (err: any) {
    worktreeError.value = err?.message ?? String(err);
    bus.emit("notify", { level: "error", text: worktreeError.value });
  } finally {
    worktreeBusy.value = "";
  }
}

function revealWorktree(worktree: GitWorktree): void {
  workbench.reveal(worktree.path).catch((err: any) => bus.emit("notify", { level: "error", text: err?.message ?? String(err) }));
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

const hasRepo = computed(() => Boolean(overview.value?.isRepo));
const stagedCount = computed(() => changes.value.filter(isStaged).length);
const canOperate = computed(() => Boolean(overview.value?.isRepo && overview.value?.canWrite && !busy.value));
const canCommit = computed(
  () => canOperate.value && stagedCount.value > 0 && Boolean(commitMessage.value.trim()),
);

const sections = computed<PanelSection[]>(() => {
  const list = changes.value;
  const defs = [
    { id: "changes" as const, label: "更改", items: list.filter((item) => !item.untracked && !isSessionOnly(item)) },
    { id: "untracked" as const, label: "未进行版本管理的文件", items: list.filter((item) => item.untracked) },
    {
      id: "committed" as const,
      label: hasRepo.value ? "已提交（本会话）" : "本会话改动",
      items: list.filter(isSessionOnly),
    },
  ];
  return defs
    .filter((definition) => definition.items.length)
    .map((definition) => {
      const rows = flattenChangeTree(buildChangeTree(definition.items), collapsedFolders).map(
        (row): PanelRow => {
          if (row.kind !== "folder") return row;
          const under = definition.items.filter(
            (item) => item.path === row.path || item.path.startsWith(`${row.path}/`),
          );
          return { ...row, total: under.length, stagedCount: under.filter(isStaged).length };
        },
      );
      return {
        ...definition,
        rows,
        total: definition.items.length,
        staged: definition.items.filter(isStaged).length,
        collapsed: collapsedGroups.has(definition.id),
      };
    });
});

function checkState(staged: number, total: number): "off" | "partial" | "on" {
  if (!total || staged <= 0) return "off";
  return staged >= total ? "on" : "partial";
}

function rowStaged(row: PanelRow): number {
  if (row.kind === "folder") return row.stagedCount ?? 0;
  return row.change && isStaged(row.change) ? 1 : 0;
}

function rowTotal(row: PanelRow): number {
  return row.kind === "folder" ? row.total ?? 0 : 1;
}

function rowState(row: PanelRow): "off" | "partial" | "on" {
  return checkState(rowStaged(row), rowTotal(row));
}

async function run(action: GitActionName, payload: GitActionPayload = {}): Promise<boolean> {
  if (busy.value) return false;
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
    return true;
  } catch (err: any) {
    const text = err?.message ?? String(err);
    error.value = text;
    bus.emit("notify", { level: "error", text });
    return false;
  } finally {
    busy.value = "";
  }
}

function commit(): void {
  if (!canCommit.value) return;
  void run("commit", { message: commitMessage.value.trim() });
}

/** 提交后立刻推送：复用同一段提交流程，中途失败会保留草稿。 */
async function commitAndPush(): Promise<void> {
  if (!canCommit.value) return;
  const message = commitMessage.value.trim();
  busy.value = "commit";
  error.value = "";
  try {
    const committed = await workbench.gitAction("commit", { message });
    overview.value = committed.overview;
    overviewState.value = committed.overview;
    commitMessage.value = "";
    writeDraft("");
    busy.value = "push";
    const pushed = await workbench.gitAction("push", {});
    overview.value = pushed.overview;
    overviewState.value = pushed.overview;
    bus.emit("notify", { level: "info", text: `${committed.message}，${pushed.message}` });
  } catch (err: any) {
    const text = err?.message ?? String(err);
    error.value = text;
    bus.emit("notify", { level: "error", text });
  } finally {
    busy.value = "";
  }
}

function itemsUnder(section: PanelSection, folder: string): RepoChange[] {
  return section.items.filter((item) => item.path === folder || item.path.startsWith(`${folder}/`));
}

function toggleFile(change: RepoChange): void {
  if (!canOperate.value) return;
  if (isStaged(change)) void run("unstage", { paths: [change.path] });
  else void run("stage", { paths: [change.path] });
}

function toggleFolder(section: PanelSection, row: PanelRow): void {
  if (!canOperate.value || section.id === "committed") return;
  const under = itemsUnder(section, row.path);
  const pending = under.filter((item) => !isStaged(item));
  if (pending.length) void run("stage", { paths: pending.map((item) => item.path) });
  else void run("unstage", { paths: under.map((item) => item.path) });
}

function toggleSection(section: PanelSection): void {
  if (!canOperate.value || section.id === "committed") return;
  const pending = section.items.filter((item) => !isStaged(item));
  if (pending.length) void run("stage", { paths: pending.map((item) => item.path) });
  else void run("unstage", { paths: section.items.map((item) => item.path) });
}

function toggleGroupCollapse(section: PanelSection): void {
  if (collapsedGroups.has(section.id)) collapsedGroups.delete(section.id);
  else collapsedGroups.add(section.id);
}

function toggleFolderCollapse(path: string): void {
  if (collapsedFolders.has(path)) collapsedFolders.delete(path);
  else collapsedFolders.add(path);
}

function onRowClick(row: PanelRow): void {
  if (row.kind === "folder") {
    toggleFolderCollapse(row.path);
    return;
  }
  if (row.change) openChange(row.change);
}

function onRowCheck(section: PanelSection, row: PanelRow): void {
  if (row.kind === "folder") {
    toggleFolder(section, row);
    return;
  }
  if (row.change) toggleFile(row.change);
}

function onRowOpen(row: PanelRow): void {
  if (row.change) openFileInEditor(row.change);
}

function onRowReveal(row: PanelRow): void {
  if (row.change) reveal(row.change);
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
    title: change.name,
    subtitle: change.path,
    data,
  });
  // 恢复的旧标签可能还带着「· Git」后缀，打开时统一刷新为文件名
  tab.title = change.name;
  tab.subtitle = change.path;
  if (hasLive) void loadLive(tab, change);
}

async function loadLive(
  tab: { title: string; subtitle?: string; data: GitStageData },
  change: RepoChange,
): Promise<void> {
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
    <div class="git-sc-toolbar">
      <span class="git-sc-branch" :title="overview?.root || 'Git'">
        <span class="git-sc-branch-icon" v-html="icons.branch" />
        <strong>{{ hasRepo ? overview?.branch || "HEAD" : "Git" }}</strong>
        <span v-if="overview?.detached" class="git-sc-note">游离</span>
        <span v-if="overview?.ahead" class="git-sc-count" title="本地领先远程的提交数">↑{{ overview.ahead }}</span>
        <span v-if="overview?.behind" class="git-sc-count" title="远程领先本地的提交数">↓{{ overview.behind }}</span>
      </span>
      <span class="git-sc-spacer" />
      <button
        type="button"
        class="icon-btn small"
        title="刷新"
        :disabled="loading"
        @click="load"
        v-html="icons.refresh"
      />
      <button
        type="button"
        class="icon-btn small"
        title="暂存所有更改"
        :disabled="!canOperate || !changes.some((item) => !isStaged(item) && !isSessionOnly(item))"
        @click="run('stage', { all: true })"
        v-html="icons.check"
      />
      <button
        type="button"
        class="icon-btn small"
        title="取消所有暂存"
        :disabled="!canOperate || stagedCount === 0"
        @click="run('unstage', { all: true })"
        v-html="icons.minus"
      />
      <button
        type="button"
        class="icon-btn small"
        title="获取（fetch）"
        :disabled="!canOperate || !overview?.hasRemote"
        @click="run('fetch')"
        v-html="icons.download"
      />
      <button
        type="button"
        class="icon-btn small"
        title="拉取（pull）"
        :disabled="!canOperate || !overview?.upstream"
        @click="run('pull')"
        v-html="icons.pull"
      />
      <button
        type="button"
        class="icon-btn small"
        title="推送（push）"
        :disabled="!canOperate || !overview?.hasRemote"
        @click="run('push')"
        v-html="icons.upload"
      />
      <button
        type="button"
        class="icon-btn small git-worktree-toggle"
        :class="{ active: worktreesOpen }"
        :title="isolatedCount ? `隔离工作区（${isolatedCount}）` : '隔离工作区'"
        :disabled="!hasRepo"
        @click="toggleWorktrees"
      >
        <span v-html="icons.branch" />
        <span v-if="isolatedCount" class="git-worktree-badge">{{ isolatedCount }}</span>
      </button>
      <button
        type="button"
        class="icon-btn small"
        :class="{ active: history }"
        title="提交历史"
        :disabled="!hasRepo"
        @click="toggleHistory"
        v-html="icons.history"
      />
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
        <p class="git-init-hint">初始化后即可暂存、提交、推送，并在提交历史里查看记录。本会话中 Agent 改动的文件会先列在下面。</p>
        <button type="button" class="btn small primary" :disabled="busy === 'init'" @click="run('init')">
          {{ busy === "init" ? "初始化中…" : "初始化 Git 仓库" }}
        </button>
      </div>

      <div v-if="worktreesOpen" class="git-history git-worktrees">
        <div class="git-history-head">
          <button type="button" class="icon-btn small" title="返回更改" @click="worktreesOpen = false" v-html="icons.chevronLeft" />
          <strong>隔离工作区</strong>
          <span class="git-history-count">{{ isolatedCount }}</span>
          <span class="git-sc-spacer" />
          <span v-if="worktreeBusy === 'create'" class="mini-spinner" />
          <button
            type="button"
            class="icon-btn small"
            title="新建隔离工作区"
            :disabled="!canCreateWorktree"
            @click="createWorktree"
            v-html="icons.plus"
          />
        </div>
        <p class="git-worktree-hint">从当前 HEAD 派生独立分支和目录，作为新项目打开。适合并行运行互不干扰的任务，改动不会影响当前工作区。</p>
        <div v-if="worktreeError" class="git-error"><span>{{ worktreeError }}</span></div>
        <p v-if="!hasRepo" class="list-empty">当前项目还不是 Git 仓库</p>
        <p v-else-if="!overview?.hasCommits" class="list-empty">提交第一个版本后才能创建隔离工作区</p>
        <div class="git-worktree-list">
          <div
            v-for="worktree in worktrees"
            :key="worktree.path"
            class="git-worktree-row"
            :class="{ primary: worktree.primary, active: isWorktreeActive(worktree), missing: !worktree.exists }"
          >
            <span class="git-worktree-icon" v-html="icons.branch" />
            <div class="git-worktree-main">
              <strong>{{ worktree.branch || (worktree.head ? worktree.head.slice(0, 7) : 'detached HEAD') }}</strong>
              <small :title="worktree.path">{{ worktree.path }}</small>
            </div>
            <span v-if="worktree.primary" class="git-worktree-tag">主工作区</span>
            <span v-else-if="worktree.managed" class="git-worktree-tag">隔离</span>
            <span v-else class="git-worktree-tag">外部</span>
            <div class="git-worktree-actions">
              <button
                v-if="!worktree.primary && !isWorktreeActive(worktree)"
                type="button"
                class="icon-btn small"
                title="在新项目中打开"
                :disabled="Boolean(worktreeBusy) || !worktree.exists"
                @click="openWorktree(worktree)"
                v-html="icons.folder"
              />
              <button
                type="button"
                class="icon-btn small"
                title="在文件管理器中显示"
                :disabled="!worktree.exists"
                @click="revealWorktree(worktree)"
                v-html="icons.reveal"
              />
              <button
                v-if="worktree.managed && !isWorktreeActive(worktree)"
                type="button"
                class="icon-btn small danger"
                title="移除隔离工作区"
                :disabled="Boolean(worktreeBusy)"
                @click="removeWorktree(worktree)"
                v-html="icons.trash"
              />
            </div>
          </div>
        </div>
        <p v-if="!worktrees.some((worktree) => !worktree.primary)" class="git-worktree-empty">还没有隔离工作区。点击右上角 + 新建一个。</p>
      </div>

      <div v-else-if="history" class="git-history">
        <div class="git-history-head">
          <button type="button" class="icon-btn small" title="返回更改" @click="history = false" v-html="icons.chevronLeft" />
          <strong>提交历史</strong>
          <span class="git-history-count">{{ overview?.commits.length ?? 0 }}</span>
        </div>
        <div class="git-commit-list">
          <p v-if="!overview?.commits.length" class="list-empty">
            {{ overview?.hasCommits ? "暂无提交历史" : "还没有提交，切换回更改并提交第一个版本" }}
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
      </div>

      <template v-else>
        <div class="git-tree">
          <p v-if="!sections.length" class="list-empty">
            {{ hasRepo ? "工作区干净，没有未提交的更改" : "本会话还没有修改文件" }}
          </p>

          <section v-for="section in sections" :key="section.id" class="git-group">
            <div class="git-group-head" role="button" tabindex="0" @click="toggleGroupCollapse(section)">
              <span class="git-caret" :class="{ open: !section.collapsed }" v-html="icons.chevronRight" />
              <span
                v-if="section.id !== 'committed'"
                class="git-check"
                role="checkbox"
                :aria-checked="checkState(section.staged, section.total) === 'on'"
                :data-state="checkState(section.staged, section.total)"
                :title="section.staged ? '取消暂存全部' : '暂存全部'"
                @click.stop="toggleSection(section)"
              >
                <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path v-if="checkState(section.staged, section.total) === 'on'" d="m2.4 6.3 2.2 2.2 4.9-5.1" />
                  <path v-else-if="checkState(section.staged, section.total) === 'partial'" d="M2.6 6h6.8" />
                </svg>
              </span>
              <span class="git-group-name">{{ section.label }}</span>
              <span class="git-group-count">{{ section.total }} 个文件</span>
            </div>

            <template v-if="!section.collapsed">
              <div
                v-for="row in section.rows"
                :key="row.id"
                class="git-tree-row"
                :class="{ folder: row.kind === 'folder', active: row.change && isActive(row.change) }"
                :style="{ paddingLeft: `${row.depth * 12 + 6}px` }"
                role="button"
                tabindex="0"
                :title="row.path"
                @click="onRowClick(row)"
              >
                <span v-if="row.kind === 'folder'" class="git-caret" :class="{ open: !collapsedFolders.has(row.path) }" v-html="icons.chevronRight" />
                <span v-else class="git-caret" />
                <span
                  v-if="section.id !== 'committed'"
                  class="git-check"
                  role="checkbox"
                  :aria-checked="rowState(row) === 'on'"
                  :data-state="rowState(row)"
                  @click.stop="onRowCheck(section, row)"
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path v-if="rowState(row) === 'on'" d="m2.4 6.3 2.2 2.2 4.9-5.1" />
                    <path v-else-if="rowState(row) === 'partial'" d="M2.6 6h6.8" />
                  </svg>
                </span>
                <span class="git-tree-name">{{ row.name }}</span>
                <template v-if="row.kind === 'folder'">
                  <span class="git-group-count">{{ row.count }} 个文件</span>
                </template>
                <template v-else-if="row.change">
                  <span v-if="row.change.agentTouched" class="git-agent-dot" title="本会话中 Agent 修改过" />
                  <span class="git-tree-badge" :data-kind="badgeKind(row.change)">{{ badgeCode(row.change) }}</span>
                  <span class="git-row-actions">
                    <button type="button" class="icon-btn small" title="在代码编辑器中打开源码" @click.stop="onRowOpen(row)" v-html="icons.code" />
                    <button type="button" class="icon-btn small" title="在资源管理器中显示" @click.stop="onRowReveal(row)" v-html="icons.reveal" />
                  </span>
                </template>
              </div>
            </template>
          </section>
        </div>

        <div v-if="hasRepo" class="git-sc-commit">
          <template v-if="overview?.canWrite">
            <textarea
              v-model="commitMessage"
              class="git-commit-input"
              rows="4"
              spellcheck="false"
              placeholder="提交消息"
              @keydown.ctrl.enter.prevent="commit"
              @keydown.meta.enter.prevent="commit"
            />
            <div class="git-sc-commit-actions">
              <button
                type="button"
                class="btn small primary"
                :disabled="!canCommit"
                :title="stagedCount ? `提交已暂存的 ${stagedCount} 个文件` : '先暂存要提交的文件'"
                @click="commit"
              >
                {{ busy === "commit" ? "提交中…" : "提交" }}
              </button>
              <button
                v-if="overview.hasRemote"
                type="button"
                class="btn small"
                :disabled="!canCommit"
                title="提交后立即推送"
                @click="commitAndPush"
              >
                提交并推送
              </button>
              <span v-if="busy && busy !== 'commit'" class="git-sync-busy"><span class="mini-spinner" />同步中…</span>
              <span v-else class="git-commit-hint">{{ stagedCount ? `${stagedCount} 个文件已暂存` : "尚未暂存任何更改" }}</span>
            </div>
          </template>
          <p v-else class="git-commit-hint">无法在此提交：仓库根目录不在当前项目内，或未检测到可用的 git 命令。</p>
        </div>
      </template>
    </template>
  </div>
</template>
