<!-- 工作区与变更展示参考 ThinkRail（Apache-2.0），见 THIRD-PARTY-NOTICES.md。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import GitBranches from "./GitBranches.vue";
import SelectMenu, { type SelectOption } from "../../components/shared/SelectMenu.vue";
import "../../styles/git.css";
import { useKernel } from "../../kernel/use-kernel.ts";
import { openWorktreeDialog } from "../../services/worktree-dialog.ts";
import { icons } from "../../shared/util.ts";
import { askConfirm } from "../../components/sidebar/ui.ts";
import { collectChanges } from "../../shared/diff.ts";
import { appendDraft } from "../../shared/review.ts";
import {
  badgeCode,
  badgeKind,
  buildWorktreeConflictPrompt,
  isSessionOnly,
  isStaged,
  isUnstaged,
  mergeRepoChanges,
  pathKey,
  type RepoChange,
} from "../../shared/git-changes.ts";
import { buildChangeTree, flattenChangeTree, type ChangeTreeRow } from "../../shared/git-tree.ts";
import type {
  GitActionName,
  GitActionPayload,
  GitBranch,
  GitCommitNode,
  GitOverview,
  GitWorktree,
  GitWorktreeMergeResult,
  GitWorktreeMergeStrategy,
} from "../../env.d.ts";
import { overviewState, type GitDiffSource, type GitStageData } from "./state.ts";

type PanelRow = ChangeTreeRow;

interface PanelSection {
  id: "staged" | "changes" | "untracked" | "committed";
  label: string;
  items: RepoChange[];
  rows: PanelRow[];
  total: number;
  collapsed: boolean;
}

const { workbench, stage, bus } = useKernel();
const ws = computed(() => workbench.active.value);

const overview = ref<GitOverview | null>(null);
const loading = ref(false);
const error = ref("");
const busy = ref<GitActionName | "">("");
const view = ref("changes");
const history = computed({ get: () => view.value === "history", set: (value: boolean) => { view.value = value ? "history" : "changes"; } });
const worktreesOpen = computed({ get: () => view.value === "worktrees", set: (value: boolean) => { view.value = value ? "worktrees" : "changes"; } });
const filter = ref("");
const sessionOnly = ref(false);
const worktrees = ref<GitWorktree[]>([]);
const worktreeBranches = ref<GitBranch[]>([]);
const worktreeBusy = ref("");
const worktreeError = ref("");
const createFormOpen = ref(false);
const createName = ref("");
const createStartOption = ref("HEAD");
const createCustomRef = ref("");
const createBaseBranch = ref("");
const createNameInput = ref<HTMLInputElement | null>(null);
const mergingWorktreePath = ref("");
const mergeTargetBranch = ref("");
const mergeStrategy = ref<GitWorktreeMergeStrategy>("squash");
const mergeMessage = ref("");
const mergeConflict = ref<GitWorktreeMergeResult | null>(null);
const commitMessage = ref("");
const commitInput = ref<HTMLTextAreaElement | null>(null);
/** 提交框高度跟随内容（不可手动拖拽），上限由 CSS max-height 控制。 */
function autosizeCommit(): void {
  const el = commitInput.value;
  if (!el) return;
  el.style.height = "auto";
  const max = Number.parseFloat(getComputedStyle(el).maxHeight) || 280;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}
watch(commitMessage, () => void nextTick(autosizeCommit));
watch(commitInput, (el) => {
  if (el) nextTick(autosizeCommit);
});
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

function writeDraft(value: string, key = draftKey.value): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* 隐私模式下忽略 */
  }
}

async function load(): Promise<void> {
  if (busy.value || worktreeBusy.value) { scheduleRefresh(); return; }
  if (!ws.value?.cwd) {
    request += 1;
    loading.value = false;
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
    view.value = "changes";
    filter.value = "";
    sessionOnly.value = false;
    worktrees.value = [];
    worktreeBranches.value = [];
    worktreeError.value = "";
    createFormOpen.value = false;
    mergingWorktreePath.value = "";
    mergeConflict.value = null;
    collapsedFolders.clear();
    collapsedGroups.clear();
    overview.value = null;
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

// 隔离工作区：从指定阶段（分支或提交）派生独立分支与目录，并在完成后合并回基础分支。
const primaryWorktree = computed(() => worktrees.value.find((item) => item.primary) ?? null);
const localBranches = computed(() => worktreeBranches.value.filter((b) => !b.remote));
const remoteBranches = computed(() => worktreeBranches.value.filter((b) => b.remote));

const defaultBaseBranchName = computed(() => {
  const current = overview.value?.branch ?? "";
  if (current && !current.startsWith("pi/") && localBranches.value.some((b) => b.name === current)) {
    return current;
  }
  const primaryBranch = primaryWorktree.value?.branch ?? "";
  if (primaryBranch && localBranches.value.some((b) => b.name === primaryBranch)) {
    return primaryBranch;
  }
  return localBranches.value[0]?.name ?? current ?? "main";
});

const startPointOptions = computed<SelectOption[]>(() => {
  const opts: SelectOption[] = [
    {
      value: "HEAD",
      label: `当前 HEAD (${overview.value?.branch || "游离"})`,
      hint: "当前状态",
    },
  ];
  for (const b of localBranches.value) {
    opts.push({
      value: b.ref,
      label: b.name,
      hint: `本地 · ${b.hash}`,
    });
  }
  for (const b of remoteBranches.value) {
    opts.push({
      value: b.ref,
      label: b.name,
      hint: `远程 · ${b.hash}`,
    });
  }
  const recentCommits = (overview.value?.commits ?? []).filter((c) => Boolean(c.hash)).slice(0, 12);
  for (const c of recentCommits) {
    const title = c.subject.length > 22 ? `${c.subject.slice(0, 22)}…` : c.subject;
    opts.push({
      value: `commit:${c.hash}`,
      label: `${c.shortHash} · ${title}`,
      hint: "提交",
    });
  }
  opts.push({
    value: "__custom__",
    label: "指定提交哈希 / 引用…",
    hint: "手动输入",
  });
  return opts;
});

const baseBranchOptions = computed<SelectOption[]>(() => {
  const list: SelectOption[] = localBranches.value.map((b) => ({
    value: b.name,
    label: b.name,
    hint: b.name === primaryWorktree.value?.branch ? "主工作区" : b.hash,
  }));
  if (!list.length && defaultBaseBranchName.value) {
    list.push({ value: defaultBaseBranchName.value, label: defaultBaseBranchName.value });
  }
  return list;
});

watch(createStartOption, (selected) => {
  if (selected.startsWith("refs/heads/")) {
    const name = selected.slice("refs/heads/".length);
    if (localBranches.value.some((b) => b.name === name)) {
      createBaseBranch.value = name;
      return;
    }
  }
  if (selected.startsWith("refs/remotes/")) {
    const rest = selected.slice("refs/remotes/".length);
    const short = rest.includes("/") ? rest.slice(rest.indexOf("/") + 1) : rest;
    const match = localBranches.value.find((b) => b.name === short);
    createBaseBranch.value = match ? match.name : defaultBaseBranchName.value;
    return;
  }
  if (!createBaseBranch.value) {
    createBaseBranch.value = defaultBaseBranchName.value;
  }
});

async function loadWorktrees(): Promise<void> {
  if (!ws.value?.cwd || !overview.value?.isRepo) {
    worktrees.value = [];
    worktreeBranches.value = [];
    return;
  }
  const cwd = ws.value.cwd;
  const current = request;
  try {
    const [result, branches] = await Promise.all([
      workbench.gitWorktrees(),
      workbench.gitBranches().catch(() => [] as GitBranch[]),
    ]);
    if (ws.value?.cwd !== cwd || current !== request) return;
    worktrees.value = result;
    worktreeBranches.value = branches;
    if (!createBaseBranch.value) createBaseBranch.value = defaultBaseBranchName.value;
    worktreeError.value = "";
  } catch (err: any) {
    if (ws.value?.cwd !== cwd || current !== request) return;
    worktrees.value = [];
    worktreeError.value = err?.message ?? String(err);
  }
}

const isolatedCount = computed(() => worktrees.value.filter((worktree) => !worktree.primary).length);

const canCreateWorktree = computed(
  () => Boolean(overview.value?.isRepo && overview.value?.canWrite && overview.value?.hasCommits && !worktreeBusy.value && !busy.value),
);

function isWorktreeActive(worktree: GitWorktree): boolean {
  if (!ws.value?.cwd) return false;
  return pathKey(ws.value.cwd) === pathKey(worktree.path);
}

function openCreateWorktreeModal(): void {
  openWorktreeDialog({
    cwd: ws.value?.cwd,
    sessionFile: (ws.value?.blocks?.length ?? 0) > 0 ? ws.value?.sessionFile : "",
    initialPrompt: ws.value?.draft ?? "",
  });
}

function toggleCreateWorktreeForm(): void {
  if (!canCreateWorktree.value) return;
  openCreateWorktreeModal();
}

async function submitCreateWorktree(): Promise<void> {
  const name = createName.value.trim();
  if (!name || !canCreateWorktree.value) return;
  let startPoint = "HEAD";
  if (createStartOption.value === "__custom__") {
    startPoint = createCustomRef.value.trim();
    if (!startPoint) {
      worktreeError.value = "请输入起点提交哈希或分支名";
      return;
    }
  } else if (createStartOption.value.startsWith("commit:")) {
    startPoint = createStartOption.value.slice("commit:".length);
  } else {
    startPoint = createStartOption.value;
  }
  const baseBranch = createBaseBranch.value || defaultBaseBranchName.value;
  worktreeBusy.value = "create";
  worktreeError.value = "";
  try {
    const result = await workbench.createGitWorktree(name, { startPoint, baseBranch });
    createFormOpen.value = false;
    createName.value = "";
    createCustomRef.value = "";
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

function toggleMergeWorktreeForm(worktree: GitWorktree): void {
  if (mergingWorktreePath.value === worktree.path) {
    mergingWorktreePath.value = "";
    return;
  }
  createFormOpen.value = false;
  mergingWorktreePath.value = worktree.path;
  mergeTargetBranch.value = worktree.baseBranch || defaultBaseBranchName.value;
  mergeStrategy.value = "squash";
  mergeMessage.value = "";
  worktreeError.value = "";
}

async function resolveConflictWithPi(conflict: GitWorktreeMergeResult): Promise<void> {
  const prompt = buildWorktreeConflictPrompt({
    worktreeBranch: conflict.worktreeBranch,
    targetBranch: conflict.targetBranch,
    conflicts: conflict.conflicts ?? [],
  });
  await workbench.open(conflict.worktreePath);
  const targetWs = workbench.findWorkspace(conflict.worktreePath) ?? workbench.active.value;
  const nextDraft = appendDraft(targetWs?.draft ?? "", prompt);
  if (targetWs) targetWs.draft = nextDraft;
  bus.emit("composer:set", { cwd: conflict.worktreePath, text: nextDraft });
  mergeConflict.value = null;
  bus.emit("notify", {
    level: "info",
    text: `已切换到 ${conflict.worktreeBranch} 并将变基解决冲突指令填入输入框`,
  });
}

async function submitMergeWorktree(worktree: GitWorktree): Promise<void> {
  if (worktreeBusy.value || busy.value) return;
  const targetBranch = mergeTargetBranch.value || worktree.baseBranch || defaultBaseBranchName.value;
  worktreeBusy.value = worktree.path;
  worktreeError.value = "";
  mergeConflict.value = null;
  try {
    const result = await workbench.mergeGitWorktree({
      worktreePath: worktree.path,
      targetBranch,
      strategy: mergeStrategy.value,
      message: mergeStrategy.value === "rebase" ? undefined : mergeMessage.value.trim() || undefined,
    });
    if (!result.ok && result.conflict) {
      mergeConflict.value = result;
      mergingWorktreePath.value = "";
      const filesPreview = (result.conflicts ?? []).slice(0, 8).map((f) => `• ${f}`).join("\n");
      const more = (result.conflicts?.length ?? 0) > 8 ? `\n…等共 ${result.conflicts!.length} 个文件` : "";
      const ask = await askConfirm({
        title: "合并存在冲突（已自动中止）",
        message: `将 ${result.worktreeBranch} 合并到 ${result.targetBranch} 时发现冲突：\n${filesPreview}${more}\n\n主工作区与隔离工作区均已恢复干净。是否打开该隔离工作区，并将「变基到 ${result.targetBranch} 解决冲突」填入输入框交给 Pi？`,
        confirmLabel: "交给 Pi 解决冲突",
      });
      if (ask) {
        await resolveConflictWithPi(result);
      }
      return;
    }
    mergingWorktreePath.value = "";
    mergeMessage.value = "";
    bus.emit("notify", { level: "info", text: result.message });
    await load();
    if (worktree.managed) {
      const cleanup = await askConfirm({
        title: "合并成功 — 是否清理隔离工作区？",
        message: `${result.message}\n\n是否现在移除该隔离工作区目录？点击「取消」将保留该工作区。`,
        confirmLabel: "移除工作区",
        check: worktree.branch ? { label: `同时删除本地分支 ${worktree.branch}`, value: true } : null,
      });
      if (cleanup) {
        worktreeBusy.value = worktree.path;
        try {
          const removed = await workbench.removeGitWorktree(
            worktree.path,
            { deleteBranch: cleanup.checked },
            result.primaryPath,
          );
          bus.emit("notify", { level: "info", text: removed.message });
          await load();
        } catch (err: any) {
          worktreeError.value = err?.message ?? String(err);
          bus.emit("notify", { level: "error", text: worktreeError.value });
        } finally {
          worktreeBusy.value = "";
        }
      }
    }
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
  const dirtyWarn = worktree.dirty ? "注意：该工作区仍有未提交的改动，移除后这些未提交改动会丢失！" : "未提交的改动会一起丢失。";
  const confirmed = await askConfirm({
    title: "移除隔离工作区",
    message: `将删除目录：\n${worktree.path}\n\n${dirtyWarn}`,
    confirmLabel: "移除",
    danger: true,
    check: worktree.branch ? { label: `同时删除本地分支 ${worktree.branch}`, value: false } : null,
  });
  if (!confirmed) return;
  worktreeBusy.value = worktree.path;
  worktreeError.value = "";
  try {
    const result = await workbench.removeGitWorktree(
      worktree.path,
      { deleteBranch: confirmed.checked },
      primaryWorktree.value?.path,
    );
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
const stopWorktreeChanged = bus.on("git:worktree-changed", () => {
  void loadWorktrees();
});
watch(view, value => { if (value === "worktrees") void loadWorktrees(); });

onMounted(() => {
  if (!overview.value) void load();
});
onBeforeUnmount(() => {
  request += 1;
  stopEvents();
  stopFiles();
  stopWorktreeChanged();
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
const canOperate = computed(() => Boolean(overview.value?.isRepo && overview.value?.canWrite && !busy.value && !worktreeBusy.value));
const canCommit = computed(
  () => canOperate.value && stagedCount.value > 0 && Boolean(commitMessage.value.trim()) && commitMessage.value.trim().length <= 5000,
);

const sections = computed<PanelSection[]>(() => {
  const list = changes.value.filter(item => (!sessionOnly.value || item.agentTouched)
    && item.path.toLowerCase().includes(filter.value.trim().toLowerCase()));
  const defs = view.value === "session" ? [
    { id: "committed" as const, label: "会话快照", items: list.filter(item => item.session) },
  ] : hasRepo.value ? [
    { id: "staged" as const, label: "已暂存", items: list.filter(isStaged) },
    { id: "changes" as const, label: "未暂存", items: list.filter(isUnstaged) },
    { id: "untracked" as const, label: "未跟踪", items: list.filter(item => item.untracked) },
  ] : [
    { id: "committed" as const, label: "本会话改动", items: list },
  ];
  return defs
    .filter((definition) => definition.items.length)
    .map((definition) => {
      const collapsed = new Set([...collapsedFolders].filter(key => key.startsWith(`${definition.id}:`)).map(key => key.slice(definition.id.length + 1)));
      const rows = flattenChangeTree(buildChangeTree(definition.items), collapsed);
      return {
        ...definition,
        rows,
        total: definition.items.length,
        collapsed: collapsedGroups.has(definition.id),
      };
    });
});

async function run(action: GitActionName, payload: GitActionPayload = {}): Promise<boolean> {
  if (busy.value || worktreeBusy.value || !ws.value) return false;
  const cwd = ws.value.cwd;
  request += 1;
  loading.value = false;
  const savedDraftKey = draftKey.value;
  busy.value = action;
  error.value = "";
  try {
    const result = await workbench.gitAction(action, payload, cwd);
    if (ws.value?.cwd !== cwd) {
      if (action === "commit") writeDraft("", savedDraftKey);
      bus.emit("notify", { level: "info", text: result.message });
      return true;
    }
    request += 1;
    loading.value = false;
    overview.value = result.overview;
    overviewState.value = result.overview;
    void loadWorktrees();
    if (action === "commit") {
      commitMessage.value = "";
      writeDraft("");
    }
    bus.emit("notify", { level: "info", text: result.message });
    return true;
  } catch (err: any) {
    const text = err?.message ?? String(err);
    if (ws.value?.cwd === cwd) error.value = text;
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
  const cwd = ws.value!.cwd;
  const savedDraftKey = draftKey.value;
  busy.value = "commit";
  request += 1;
  loading.value = false;
  error.value = "";
  try {
    const committed = await workbench.gitAction("commit", { message }, cwd);
    if (ws.value?.cwd === cwd) {
      overview.value = committed.overview;
      overviewState.value = committed.overview;
      commitMessage.value = "";
    }
    writeDraft("", savedDraftKey);
    busy.value = "push";
    const pushed = await workbench.gitAction("push", {}, cwd);
    if (ws.value?.cwd === cwd) {
      overview.value = pushed.overview;
      overviewState.value = pushed.overview;
    }
    bus.emit("notify", { level: "info", text: `${committed.message}，${pushed.message}` });
  } catch (err: any) {
    const text = err?.message ?? String(err);
    if (ws.value?.cwd === cwd) error.value = text;
    bus.emit("notify", { level: "error", text });
  } finally {
    busy.value = "";
  }
}

function itemsUnder(section: PanelSection, folder: string): RepoChange[] {
  return section.items.filter((item) => item.path === folder || item.path.startsWith(`${folder}/`));
}

function toggleSection(section: PanelSection): void {
  if (!canOperate.value || section.id === "committed") return;
  void run(section.id === "staged" ? "unstage" : "stage", { paths: section.items.map(item => item.path) });
}

function stageRow(section: PanelSection, row: PanelRow): void {
  const items = row.kind === "folder" ? itemsUnder(section, row.path) : row.change ? [row.change] : [];
  if (!items.length || !canOperate.value || section.id === "committed") return;
  void run(section.id === "staged" ? "unstage" : "stage", { paths: items.map(item => item.path) });
}

function toggleGroupCollapse(section: PanelSection): void {
  if (collapsedGroups.has(section.id)) collapsedGroups.delete(section.id);
  else collapsedGroups.add(section.id);
}

function toggleFolderCollapse(section: PanelSection, path: string): void {
  const key = `${section.id}:${path}`;
  if (collapsedFolders.has(key)) collapsedFolders.delete(key);
  else collapsedFolders.add(key);
}

function openRow(section: PanelSection, row: PanelRow): void {
  if (row.kind === "folder") {
    toggleFolderCollapse(section, row.path);
    return;
  }
  if (row.change) openChange(row.change, section.id === "committed", section.id === "staged" ? "staged" : "unstaged");
}

function onRowOpen(row: PanelRow): void {
  if (row.change) openFileInEditor(row.change);
}

function onRowReveal(row: PanelRow): void {
  if (row.change) reveal(row.change);
}

function isActive(change: RepoChange, section: PanelSection): boolean {
  return stage.activeTab.value?.pluginId === "git" && stage.activeTab.value?.tabId === `${section.id === "committed" ? "snapshot" : section.id === "staged" ? "staged" : "unstaged"}:${change.path}`;
}

function isCommitActive(commit: GitCommitNode): boolean {
  return stage.activeTab.value?.pluginId === "git" && stage.activeTab.value?.tabId === `commit:${commit.hash}`;
}

/** 打开变更详情：有 Git 状态时默认看实时 diff，只有会话快照时看快照 */
function openChange(change: RepoChange, snapshot = false, area: "staged" | "unstaged" = "unstaged"): void {
  const hasLive = !snapshot && !isSessionOnly(change);
  const source: GitDiffSource = hasLive ? "live" : "snapshot";
  const data: GitStageData = {
    kind: hasLive ? "working" : "session",
    target: change.path,
    area,
    source,
    loading: hasLive,
    error: "",
    detail: null,
    session: change.session ?? null,
    hasLive,
  };
  const tab = stage.open<GitStageData>({
    pluginId: "git",
    tabId: `${hasLive ? area : 'snapshot'}:${change.path}`,
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
  const origin = ws.value?.cwd;
  try {
    const detail = await workbench.gitInspect(tab.data.area || "working", change.path);
    if (ws.value?.cwd !== origin || !stage.allTabs.value.includes(tab as any)) return;
    tab.title = `${change.name} · Git`;
    tab.subtitle = detail.subtitle || change.path;
    tab.data = { ...tab.data, loading: false, error: "", detail, source: "live" };
  } catch (err: any) {
    if (ws.value?.cwd !== origin) return;
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
      <button class="git-sc-branch git-branch-trigger" type="button" :title="`${overview?.root || 'Git'}；点击管理分支`" aria-label="打开分支管理" @click="view = 'branches'">
        <span class="git-sc-branch-icon" v-html="icons.branch" />
        <strong>{{ hasRepo ? overview?.branch || "HEAD" : "Git" }}</strong>
        <span v-if="overview?.detached" class="git-sc-note">游离</span>
        <span v-if="overview?.ahead" class="git-sc-count" title="本地领先远程的提交数">↑{{ overview.ahead }}</span>
        <span v-if="overview?.behind" class="git-sc-count" title="远程领先本地的提交数">↓{{ overview.behind }}</span>
        <span v-html="icons.chevronDown" />
      </button>
      <span class="git-sc-spacer" />
      <button
        v-if="hasRepo"
        type="button"
        class="btn small git-sc-wt-btn"
        title="新建 Git Worktree（隔离工作区与对话）"
        :disabled="!canCreateWorktree"
        @click="openCreateWorktreeModal"
      >
        <span v-html="icons.branch" />+ 工作树
      </button>
      <button
        type="button"
        class="icon-btn small"
        title="刷新"
        :disabled="loading || Boolean(busy)"
        @click="load"
        v-html="icons.refresh"
      />

      <button
        type="button"
        class="icon-btn small"
        title="获取（fetch）"
        aria-label="获取远程更新"
        :disabled="!canOperate || !overview?.hasRemote"
        @click="run('fetch')"
        v-html="icons.download"
      />
      <button
        type="button"
        class="icon-btn small"
        title="拉取（pull）"
        aria-label="拉取远程更新"
        :disabled="!canOperate || !overview?.upstream"
        @click="run('pull')"
        v-html="icons.pull"
      />
      <button
        type="button"
        class="icon-btn small"
        title="推送（push）"
        aria-label="推送到远程"
        :disabled="!canOperate || !overview?.hasRemote"
        @click="run('push')"
        v-html="icons.upload"
      />
    </div>
    <div v-if="hasRepo" class="git-repo-context" :title="overview?.root"><span>{{ overview?.upstream || '未设置上游分支' }}</span><span>{{ overview?.canWrite ? '当前仓库' : '只读 · 非仓库根目录' }}</span></div>
    <nav class="git-view-tabs" aria-label="版本控制视图">
      <button v-for="tab in [{ id: 'changes', label: '更改' }, { id: 'branches', label: '分支' }, { id: 'history', label: '历史' }, { id: 'worktrees', label: '工作区' }, { id: 'session', label: '快照' }]" :key="tab.id" type="button" :class="{ active: view === tab.id }" :aria-pressed="view === tab.id" @click="view = tab.id">
        {{ tab.label }}<small v-if="tab.id === 'changes' && overview?.status.length">{{ overview.status.length }}</small>
      </button>
    </nav>

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

      <GitBranches v-if="view === 'branches'" :overview="overview" :busy="Boolean(busy) || Boolean(worktreeBusy)" @action="run" />
      <div v-else-if="worktreesOpen" class="git-history git-worktrees">
        <div class="git-history-head">
          <button type="button" class="icon-btn small" title="返回更改" @click="worktreesOpen = false" v-html="icons.chevronLeft" />
          <strong>隔离工作区</strong>
          <span class="git-history-count">{{ isolatedCount }}</span>
          <span class="git-sc-spacer" />
          <span v-if="worktreeBusy === 'create'" class="mini-spinner" />
          <button
            type="button"
            class="icon-btn small"
            :title="createFormOpen ? '收起新建面板' : '新建隔离工作区'"
            :disabled="!canCreateWorktree"
            @click="toggleCreateWorktreeForm"
            v-html="createFormOpen ? icons.close : icons.plus"
          />
        </div>
        <p class="git-worktree-hint">基于指定分支或提交创建独立工作区，作为新项目并行运行任务；完成后可一键合并回基础分支。</p>

        <form v-if="createFormOpen" class="git-worktree-form" @submit.prevent="submitCreateWorktree">
          <div class="git-wt-form-title">新建隔离工作区</div>
          <label class="git-wt-field">
            <span>任务名称</span>
            <input
              ref="createNameInput"
              v-model="createName"
              class="git-wt-input"
              placeholder="例如 fix-login（生成分支 pi/fix-login）"
              spellcheck="false"
              @keydown.esc.stop.prevent="createFormOpen = false"
            />
          </label>
          <div class="git-wt-field">
            <span>基于阶段（起点）</span>
            <SelectMenu
              v-model="createStartOption"
              :options="startPointOptions"
              size="sm"
              width="100%"
              aria-label="选择起点阶段"
            />
            <input
              v-if="createStartOption === '__custom__'"
              v-model="createCustomRef"
              class="git-wt-input"
              placeholder="输入提交哈希（如 a1b2c3d）或分支 / 标签"
              spellcheck="false"
            />
          </div>
          <div class="git-wt-field">
            <span>合并目标基础分支</span>
            <SelectMenu
              v-model="createBaseBranch"
              :options="baseBranchOptions"
              size="sm"
              width="100%"
              aria-label="选择合并目标基础分支"
            />
          </div>
          <div class="git-wt-form-actions">
            <button type="button" class="btn small" @click="createFormOpen = false">取消</button>
            <button
              type="submit"
              class="btn small primary"
              :disabled="!createName.trim() || (createStartOption === '__custom__' && !createCustomRef.trim()) || Boolean(worktreeBusy)"
            >
              {{ worktreeBusy === "create" ? "创建中…" : "创建并打开" }}
            </button>
          </div>
        </form>

        <div v-if="mergeConflict" class="git-wt-conflict">
          <div class="git-wt-conflict-head">
            <strong>合并存在冲突（已自动中止，主工作区保持干净）</strong>
            <button type="button" class="icon-btn small" title="关闭" @click="mergeConflict = null" v-html="icons.close" />
          </div>
          <p class="git-wt-conflict-sub">{{ mergeConflict.worktreeBranch }} → {{ mergeConflict.targetBranch }}</p>
          <ul v-if="mergeConflict.conflicts?.length" class="git-wt-conflict-files">
            <li v-for="file in mergeConflict.conflicts" :key="file">{{ file }}</li>
          </ul>
          <div class="git-wt-form-actions">
            <button type="button" class="btn small primary" @click="resolveConflictWithPi(mergeConflict)">
              交给 Pi 解决冲突
            </button>
          </div>
        </div>

        <div v-if="worktreeError" class="git-error">
          <span>{{ worktreeError }}</span>
          <button type="button" class="icon-btn small" title="关闭" @click="worktreeError = ''" v-html="icons.close" />
        </div>
        <p v-if="!hasRepo" class="list-empty">当前项目还不是 Git 仓库</p>
        <p v-else-if="!overview?.hasCommits" class="list-empty">提交第一个版本后才能创建隔离工作区</p>
        <div class="git-worktree-list">
          <div
            v-for="worktree in worktrees"
            :key="worktree.path"
            class="git-worktree-item"
          >
            <div
              class="git-worktree-row"
              :class="{ primary: worktree.primary, active: isWorktreeActive(worktree), missing: !worktree.exists }"
            >
              <span class="git-worktree-icon" v-html="icons.branch" />
              <div class="git-worktree-main">
                <div class="git-worktree-title-row">
                  <strong>{{ worktree.branch || (worktree.head ? worktree.head.slice(0, 7) : 'detached HEAD') }}</strong>
                  <span v-if="!worktree.primary && worktree.ahead" class="git-wt-badge ahead" :title="`领先基础分支 ${worktree.ahead} 个提交`">↑{{ worktree.ahead }}</span>
                  <span v-if="!worktree.primary && worktree.behind" class="git-wt-badge behind" :title="`落后基础分支 ${worktree.behind} 个提交`">↓{{ worktree.behind }}</span>
                  <span v-if="!worktree.primary && worktree.dirty" class="git-wt-badge dirty" title="该工作区有未提交改动">未提交</span>
                </div>
                <small v-if="!worktree.primary && worktree.baseBranch" class="git-worktree-base">
                  目标 {{ worktree.baseBranch }}<template v-if="worktree.baseRef && worktree.baseRef !== worktree.baseBranch"> · 起点 {{ worktree.baseRef }}</template>
                </small>
                <small :title="worktree.path">{{ worktree.path }}</small>
              </div>
              <span v-if="worktree.primary" class="git-worktree-tag">主工作区</span>
              <span v-else-if="worktree.managed" class="git-worktree-tag">隔离</span>
              <span v-else class="git-worktree-tag">外部</span>
              <div class="git-worktree-actions">
                <button
                  v-if="!worktree.primary && worktree.branch && worktree.exists"
                  type="button"
                  class="git-wt-merge-trigger"
                  :class="{ active: mergingWorktreePath === worktree.path }"
                  :title="`将 ${worktree.branch} 合并到 ${worktree.baseBranch || '基础分支'}`"
                  :disabled="Boolean(worktreeBusy)"
                  @click="toggleMergeWorktreeForm(worktree)"
                >
                  合并
                </button>
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

            <form
              v-if="mergingWorktreePath === worktree.path"
              class="git-worktree-form git-worktree-merge-form"
              @submit.prevent="submitMergeWorktree(worktree)"
            >
              <div class="git-wt-form-title">合并 {{ worktree.branch }} 到基础分支</div>
              <div class="git-wt-field">
                <span>目标基础分支</span>
                <SelectMenu
                  v-model="mergeTargetBranch"
                  :options="baseBranchOptions"
                  size="sm"
                  width="100%"
                  aria-label="选择合并目标分支"
                />
              </div>
              <div class="git-wt-field">
                <span>合并方式</span>
                <div class="git-wt-strategies" role="radiogroup" aria-label="合并方式">
                  <button
                    v-for="opt in [
                      { id: 'squash', label: '压缩 (Squash)', desc: '压成 1 个提交' },
                      { id: 'merge', label: '合并 (Merge)', desc: '保留分支历史' },
                      { id: 'rebase', label: '变基 (Rebase)', desc: '线性快进合并' },
                    ]"
                    :key="opt.id"
                    type="button"
                    class="git-wt-strategy-btn"
                    :class="{ active: mergeStrategy === opt.id }"
                    :title="opt.desc"
                    @click="mergeStrategy = opt.id as GitWorktreeMergeStrategy"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <label v-if="mergeStrategy !== 'rebase'" class="git-wt-field">
                <span>提交说明（可选）</span>
                <input
                  v-model="mergeMessage"
                  class="git-wt-input"
                  :placeholder="`留空自动生成合并 ${worktree.branch} 的说明`"
                  spellcheck="false"
                />
              </label>
              <p v-if="worktree.dirty" class="git-wt-form-warn">该工作区仍有未提交改动，请先提交后再合并。</p>
              <p v-else-if="!worktree.ahead" class="git-wt-form-hint">该分支暂无领先于目标分支的新提交。</p>
              <div class="git-wt-form-actions">
                <button type="button" class="btn small" @click="mergingWorktreePath = ''">取消</button>
                <button
                  type="submit"
                  class="btn small primary"
                  :disabled="Boolean(worktreeBusy) || Boolean(worktree.dirty) || !worktree.ahead"
                >
                  {{ worktreeBusy === worktree.path ? "合并中…" : `合并到 ${mergeTargetBranch}` }}
                </button>
              </div>
            </form>
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
        <div class="git-changes-filter">
          <input v-model="filter" aria-label="筛选变更文件" placeholder="筛选文件路径…" />
          <button type="button" :class="{ active: sessionOnly }" :aria-pressed="sessionOnly" title="只显示本会话 Agent 修改过的文件" @click="sessionOnly = !sessionOnly">Agent</button>
        </div>
        <p v-if="view === 'session'" class="git-view-hint">会话工具记录的快照，不代表当前 Git 状态，也不表示这些文件一定已提交。点击文件查看当时的 Diff。</p>
        <div class="git-tree">
          <p v-if="!sections.length" class="list-empty">
            {{ filter || sessionOnly ? '没有匹配的文件' : view === 'session' ? '本会话暂无文件快照' : hasRepo ? '工作区干净，没有未提交的更改' : '本会话还没有修改文件' }}
          </p>

          <section v-for="section in sections" :key="section.id" class="git-group">
            <div class="git-group-head">
              <button class="git-group-toggle" type="button" :aria-expanded="!section.collapsed" @click="toggleGroupCollapse(section)">
                <span class="git-caret" :class="{ open: !section.collapsed }" v-html="icons.chevronRight" />
                <span class="git-group-name">{{ section.label }}</span>
                <span class="git-group-count">{{ section.total }}</span>
              </button>
              <button v-if="section.id !== 'committed'" class="git-section-action" type="button" :disabled="!canOperate" @click="toggleSection(section)">{{ section.id === 'staged' ? '取消暂存' : '全部暂存' }}</button>
            </div>

            <template v-if="!section.collapsed">
              <div
                v-for="row in section.rows"
                :key="row.id"
                class="git-tree-row"
                :class="{ folder: row.kind === 'folder', active: row.change && isActive(row.change, section) }"
                :style="{ '--depth': row.depth }"
                role="button"
                tabindex="0"
                :title="row.path"
                @click="openRow(section, row)"
                @keydown.enter.prevent="openRow(section, row)"
                @keydown.space.prevent="openRow(section, row)"
              >
                <span
                  v-for="level in row.depth"
                  :key="`rail-${level}`"
                  class="git-rail"
                  :style="{ left: `calc(var(--git-tree-base, 6px) + ${level - 1} * var(--git-tree-indent, 20px) + 7px)` }"
                />
                <span v-if="row.kind === 'folder'" class="git-caret" :class="{ open: !collapsedFolders.has(`${section.id}:${row.path}`) }" v-html="icons.chevronRight" />
                <span v-else class="git-caret" />
                <span class="git-file-icon" aria-hidden="true" v-html="row.kind === 'folder' ? icons.folder : icons.file" />
                <span class="git-tree-name">{{ row.name }}</span>
                <template v-if="row.kind === 'folder'">
                  <span class="git-group-count">{{ row.count }} 个文件</span>
                </template>
                <template v-else-if="row.change">
                  <span v-if="row.change.agentTouched && section.id !== 'committed'" class="git-agent-dot" title="本会话中 Agent 修改过" />
                  <span v-if="section.id !== 'committed'" class="git-tree-badge" :data-kind="badgeKind(row.change)">{{ section.id === 'staged' ? row.change.index : badgeCode(row.change) }}</span>
                  <span class="git-row-actions" @keydown.stop>
                    <button v-if="section.id !== 'committed'" type="button" class="icon-btn small" :title="section.id === 'staged' ? '取消暂存此文件' : '暂存此文件'" :disabled="!canOperate" @click.stop="stageRow(section, row)" v-html="section.id === 'staged' ? icons.minus : icons.plus" />
                    <button type="button" class="icon-btn small" title="在代码编辑器中打开源码" @click.stop="onRowOpen(row)" v-html="icons.code" />
                    <button type="button" class="icon-btn small" title="在资源管理器中显示" @click.stop="onRowReveal(row)" v-html="icons.reveal" />
                  </span>
                </template>
              </div>
            </template>
          </section>
        </div>

        <div v-if="hasRepo && view === 'changes'" class="git-sc-commit">
          <div class="git-commit-summary"><strong>提交到 {{ overview?.branch }}</strong><span>{{ stagedCount }} 个文件已暂存</span></div>
          <template v-if="overview?.canWrite">
            <textarea
              ref="commitInput"
              v-model="commitMessage"
              class="git-commit-input"
              rows="4"
              spellcheck="false"
              maxlength="5000"
              aria-label="提交消息"
              placeholder="提交消息（Ctrl/Cmd+Enter 提交）"
              @input="autosizeCommit"
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
