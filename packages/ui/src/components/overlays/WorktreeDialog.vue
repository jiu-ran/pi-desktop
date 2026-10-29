<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SelectMenu, { type SelectOption } from "../shared/SelectMenu.vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { closeWorktreeDialog, worktreeDialogState } from "../../services/worktree-dialog.ts";
import { displayProjectName, icons, relativeTime } from "../../shared/util.ts";
import type { GitBranch, GitCommitNode, GitOverview, GitWorktree } from "../../env.d.ts";

const { workbench, bus } = useKernel();

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const overview = ref<GitOverview | null>(null);
const branches = ref<GitBranch[]>([]);
const worktrees = ref<GitWorktree[]>([]);
const sessions = ref<Array<{ id: string; path: string; title: string; empty?: boolean; timestamp?: number }>>([]);

// 1. 分支策略与命名
const branchMode = ref<"create" | "existing">("create");
const taskName = ref("");
const customBranchName = ref("");
const branchNameTouched = ref(false);
const existingBranchRef = ref("");
const remoteLocalBranchName = ref("");
const remoteLocalBranchTouched = ref(false);

// 2. 起点阶段与合并目标分支
const startKind = ref<"local" | "remote" | "commit">("local");
const startPoint = ref("");
const baseBranch = ref("");
const baseBranchTouched = ref(false);

// 3. Worktree 存放目录
const parentLocation = ref("");
const folderName = ref("");
const folderNameTouched = ref(false);

// 4. 对话加载与创建后行为
const selectedSessionFile = ref("");
const sessionLoadMode = ref<"clone" | "quote">("clone");
const initialPrompt = ref("");
const sendImmediately = ref(false);
const openAfterCreate = ref(true);

const targetCwd = computed(() => worktreeDialogState.cwd || workbench.active.value?.cwd || "");
const repoName = computed(() => displayProjectName(overview.value?.root || targetCwd.value));

function slugify(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.lock$/i, "")
    .slice(0, 40)
    .replace(/^[._-]+|[._-]+$/g, "");
}

const taskSlug = computed(() => {
  const stripped = taskName.value.trim().replace(/^pi[/-]+/i, "");
  return slugify(stripped);
});

const existingSlug = computed(() => {
  const selected = branches.value.find((b) => b.ref === existingBranchRef.value);
  if (!selected) return "worktree";
  const raw = selected.remote
    ? remoteLocalBranchName.value || selected.name.slice(selected.name.indexOf("/") + 1)
    : selected.name;
  return slugify(raw.replace(/^pi[/-]+/i, "")) || "worktree";
});

const currentSlug = computed(() => {
  if (branchMode.value === "existing") {
    return existingSlug.value;
  }
  return taskSlug.value;
});

const defaultBranchName = computed(() => {
  if (branchMode.value === "existing") {
    if (selectedExistingBranch.value?.remote) {
      return remoteLocalBranchName.value.trim() || existingSlug.value;
    }
    return selectedExistingBranch.value?.name ?? "";
  }
  return taskSlug.value ? `pi/${taskSlug.value}` : "";
});

const defaultParentLocation = computed(() => overview.value?.worktreeRoot || "");
const defaultFolderName = computed(() => {
  const prefix = overview.value?.repoKey ? `${overview.value.repoKey}-` : "";
  const slug = branchMode.value === "existing" ? existingSlug.value : taskSlug.value;
  return slug ? `${prefix}${slug}` : `${prefix}worktree`;
});

const pathSeparator = computed(() => {
  const sample = parentLocation.value || targetCwd.value || "";
  return sample.includes("\\") ? "\\" : "/";
});

const targetDirPreview = computed(() => {
  const dir = parentLocation.value.trim().replace(/[\\/]+$/, "");
  const leaf = (folderName.value.trim() || defaultFolderName.value).replace(/^[\\/]+|[\\/]+$/g, "");
  if (!dir) return leaf;
  return `${dir}${pathSeparator.value}${leaf}`;
});

const isCustomDirectory = computed(() => {
  const norm = (s: string) => s.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const defParent = norm(defaultParentLocation.value);
  const curParent = norm(parentLocation.value);
  const defLeaf = norm(defaultFolderName.value);
  const curLeaf = norm(folderName.value);
  return (defParent && curParent !== defParent) || (defLeaf && curLeaf !== defLeaf);
});

const localBranches = computed(() => branches.value.filter((item) => !item.remote));
const remoteBranches = computed(() => branches.value.filter((item) => item.remote));
const recentCommits = computed<GitCommitNode[]>(() => (overview.value?.commits ?? []).slice(0, 30));

const defaultBaseBranchName = computed(() => {
  const current = localBranches.value.find((item) => item.current && !item.name.startsWith("pi/"));
  if (current) return current.name;
  const main = localBranches.value.find((item) => item.name === "main" || item.name === "master");
  if (main) return main.name;
  return localBranches.value[0]?.name ?? "";
});

// 起点阶段下拉项
const startLocalOptions = computed<SelectOption[]>(() =>
  localBranches.value.map((item) => ({
    value: item.ref,
    label: item.name,
    hint: `${item.current ? "当前 · " : ""}${item.hash}`,
  })),
);

const startRemoteOptions = computed<SelectOption[]>(() =>
  remoteBranches.value.map((item) => ({
    value: item.ref,
    label: item.name,
    hint: item.hash,
  })),
);

const startCommitOptions = computed<SelectOption[]>(() =>
  recentCommits.value.map((commit) => ({
    value: commit.hash,
    label: `${commit.shortHash} · ${commit.subject}`,
    hint: commit.relativeTime,
  })),
);

// 检出已有分支下拉项
const existingBranchOptions = computed<SelectOption[]>(() => {
  const items: SelectOption[] = [];
  for (const b of localBranches.value) {
    const occupied = Boolean(b.current || b.worktreePath || worktrees.value.some((w) => w.branch === b.name));
    items.push({
      value: b.ref,
      label: `${b.name}（本地）`,
      hint: occupied ? "已在工作区检出" : b.hash,
      disabled: occupied,
    });
  }
  for (const b of remoteBranches.value) {
    items.push({
      value: b.ref,
      label: `${b.name}（远程）`,
      hint: `跟踪 · ${b.hash}`,
    });
  }
  return items;
});

const selectedExistingBranch = computed(() =>
  branches.value.find((b) => b.ref === existingBranchRef.value) ?? null,
);

// 合并目标分支下拉项（包含「暂不绑定」）
const baseBranchOptions = computed<SelectOption[]>(() => {
  const list: SelectOption[] = localBranches.value.map((item) => ({
    value: item.name,
    label: item.name,
    hint: item.name === defaultBaseBranchName.value ? "推荐主分支" : item.hash,
  }));
  list.push({
    value: "",
    label: "暂不绑定合并目标分支",
    hint: "后续合并时再选",
  });
  return list;
});

// 会话加载下拉项
const sessionOptions = computed<SelectOption[]>(() => {
  const activeWs = workbench.findWorkspace(targetCwd.value);
  const currentFile = activeWs?.sessionFile || "";
  const list: SelectOption[] = [
    {
      value: "",
      label: "不加载历史对话（新建空白对话）",
      hint: "默认",
    },
  ];
  for (const s of sessions.value) {
    const isCurrent = Boolean(currentFile && s.path.replace(/\\/g, "/").toLowerCase() === currentFile.replace(/\\/g, "/").toLowerCase());
    list.push({
      value: s.path,
      label: s.title || "未命名对话",
      hint: isCurrent ? "当前对话" : relativeTime(s.timestamp) || "历史对话",
    });
  }
  return list;
});

// 当任务名或分支模式改变时，自动同步未被用户手动改过的默认分支名和目录名
watch(
  [currentSlug, branchMode],
  () => {
    if (branchMode.value === "create" && !branchNameTouched.value) {
      customBranchName.value = defaultBranchName.value;
    }
    if (!folderNameTouched.value) {
      folderName.value = defaultFolderName.value;
    }
  },
);

function onTaskNameInput(): void {
  if (branchMode.value === "create" && !branchNameTouched.value) {
    customBranchName.value = defaultBranchName.value;
  }
  if (!folderNameTouched.value) {
    folderName.value = defaultFolderName.value;
  }
}

function onCustomBranchInput(): void {
  branchNameTouched.value = customBranchName.value.trim() !== defaultBranchName.value;
}

function resetBranchName(): void {
  branchNameTouched.value = false;
  customBranchName.value = defaultBranchName.value;
}

function onFolderNameInput(): void {
  folderNameTouched.value = folderName.value.trim() !== defaultFolderName.value;
}

function resetDirectory(): void {
  parentLocation.value = defaultParentLocation.value;
  folderNameTouched.value = false;
  folderName.value = defaultFolderName.value;
}

function selectStartKind(kind: "local" | "remote" | "commit"): void {
  startKind.value = kind;
  if (kind === "local") {
    const current = localBranches.value.find((item) => item.current) ?? localBranches.value[0];
    startPoint.value = current?.ref ?? "HEAD";
    if (!baseBranchTouched.value && current && !current.name.startsWith("pi/")) {
      baseBranch.value = current.name;
    }
  } else if (kind === "remote") {
    startPoint.value = remoteBranches.value[0]?.ref ?? "";
  } else {
    startPoint.value = recentCommits.value[0]?.hash ?? "";
  }
}

function onStartPointChange(val: string | number | boolean): void {
  const refStr = String(val);
  startPoint.value = refStr;
  if (baseBranchTouched.value) return;
  if (startKind.value === "local") {
    const match = localBranches.value.find((b) => b.ref === refStr);
    if (match && !match.name.startsWith("pi/")) baseBranch.value = match.name;
  } else if (startKind.value === "remote") {
    const match = remoteBranches.value.find((b) => b.ref === refStr);
    if (match) {
      const stripped = match.name.includes("/") ? match.name.slice(match.name.indexOf("/") + 1) : match.name;
      const local = localBranches.value.find((b) => b.name === stripped);
      if (local) baseBranch.value = local.name;
    }
  }
}

function onExistingBranchChange(val: string | number | boolean): void {
  const refStr = String(val);
  existingBranchRef.value = refStr;
  const match = branches.value.find((b) => b.ref === refStr);
  if (match?.remote && !remoteLocalBranchTouched.value) {
    remoteLocalBranchName.value = match.name.includes("/")
      ? match.name.slice(match.name.indexOf("/") + 1)
      : match.name;
  }
  if (!folderNameTouched.value) {
    folderName.value = defaultFolderName.value;
  }
}

async function browseParentDirectory(): Promise<void> {
  if (busy.value) return;
  try {
    const picked = await workbench.chooseDirectory();
    if (picked) parentLocation.value = picked;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

const canSubmit = computed(() => {
  if (busy.value || loading.value || !overview.value?.isRepo || !overview.value?.hasCommits) return false;
  if (branchMode.value === "existing") {
    if (!existingBranchRef.value) return false;
    if (selectedExistingBranch.value?.remote && !remoteLocalBranchName.value.trim()) return false;
    return Boolean(targetDirPreview.value.trim());
  }
  return Boolean(
    customBranchName.value.trim() &&
    startPoint.value.trim() &&
    targetDirPreview.value.trim(),
  );
});

async function initializeDialog(): Promise<void> {
  const cwd = targetCwd.value;
  error.value = "";
  busy.value = false;
  if (!cwd) {
    error.value = "请先打开一个 Git 仓库项目";
    return;
  }
  loading.value = true;
  try {
    const activeWs = workbench.findWorkspace(cwd);
    const [ov, br, wt, sessList] = await Promise.all([
      workbench.gitOverview(cwd),
      workbench.gitBranches(cwd),
      workbench.gitWorktrees(cwd),
      activeWs?.status === "ready" ? Promise.resolve(activeWs.sessions) : workbench.listSessions(cwd).catch(() => []),
    ]);
    overview.value = ov;
    branches.value = br;
    worktrees.value = wt;
    sessions.value = (sessList ?? []).filter((s: any) => !s.empty);

    // 预填任务名与初始草稿
    const presetPrompt = worktreeDialogState.initialPrompt || (activeWs?.draft ?? "");
    initialPrompt.value = presetPrompt;
    sendImmediately.value = false;
    openAfterCreate.value = true;

    // 预选要加载的对话
    const requestedSession = worktreeDialogState.sessionFile;
    if (requestedSession && sessions.value.some((s) => s.path === requestedSession)) {
      selectedSessionFile.value = requestedSession;
    } else if (activeWs?.sessionFile && (activeWs.blocks?.length ?? 0) > 0 && sessions.value.some((s) => s.path === activeWs.sessionFile)) {
      selectedSessionFile.value = activeWs.sessionFile;
    } else {
      selectedSessionFile.value = "";
    }
    sessionLoadMode.value = "clone";

    // 根据预设或对话标题生成初始任务标识
    const selectedSess = sessions.value.find((s) => s.path === selectedSessionFile.value);
    const seedName =
      worktreeDialogState.initialName ||
      selectedSess?.title ||
      presetPrompt.split(/\r?\n/)[0]?.slice(0, 24) ||
      "feature";
    taskName.value = slugify(seedName) || `worktree-${wt.length}`;

    branchMode.value = "create";
    branchNameTouched.value = false;
    customBranchName.value = defaultBranchName.value;

    const firstAvailableExisting = existingBranchOptions.value.find((item) => !item.disabled);
    existingBranchRef.value = String(firstAvailableExisting?.value ?? "");
    remoteLocalBranchTouched.value = false;
    const existingMatch = branches.value.find((b) => b.ref === existingBranchRef.value);
    remoteLocalBranchName.value = existingMatch?.remote
      ? existingMatch.name.slice(existingMatch.name.indexOf("/") + 1)
      : "";

    startKind.value = "local";
    const currentLocal = localBranches.value.find((item) => item.current) ?? localBranches.value[0];
    startPoint.value = currentLocal?.ref ?? "HEAD";

    baseBranchTouched.value = false;
    baseBranch.value = defaultBaseBranchName.value;

    parentLocation.value = ov.worktreeRoot || "";
    folderNameTouched.value = false;
    folderName.value = defaultFolderName.value;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
  }
}

watch(
  () => worktreeDialogState.open,
  (open) => {
    if (open) void initializeDialog();
  },
  { flush: "post" },
);

function close(): void {
  if (busy.value) return;
  closeWorktreeDialog();
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const cwd = targetCwd.value;
  busy.value = true;
  error.value = "";
  try {
    const useCloneSession = Boolean(selectedSessionFile.value && sessionLoadMode.value === "clone");
    const useQuoteSession = Boolean(selectedSessionFile.value && sessionLoadMode.value === "quote");
    const promptText = initialPrompt.value.trim();

    const finalTaskName =
      taskName.value.trim() ||
      (branchMode.value === "create"
        ? slugify(customBranchName.value.replace(/^pi[/-]+/i, ""))
        : currentSlug.value) ||
      "worktree";

    const createRes = await workbench.createGitWorktree(
      finalTaskName,
      {
        branchMode: branchMode.value,
        branchName:
          branchMode.value === "create"
            ? customBranchName.value.trim()
            : selectedExistingBranch.value?.remote
              ? remoteLocalBranchName.value.trim()
              : undefined,
        existingBranch: branchMode.value === "existing" ? existingBranchRef.value : undefined,
        startPoint: branchMode.value === "create" ? startPoint.value.trim() || "HEAD" : undefined,
        baseBranch: baseBranch.value,
        targetDir: isCustomDirectory.value ? targetDirPreview.value.trim() : undefined,
        sourceSessionFile: useCloneSession ? selectedSessionFile.value : undefined,
      },
      cwd,
    );

    const newPath = createRes.worktree.path;
    const shouldOpen = openAfterCreate.value || useCloneSession || useQuoteSession || Boolean(promptText);

    if (shouldOpen) {
      if (useCloneSession && createRes.sessionFile) {
        await workbench.openSession(newPath, createRes.sessionFile);
      } else {
        await workbench.open(newPath);
      }

      if (useQuoteSession && selectedSessionFile.value) {
        const pickedSession = sessions.value.find((s) => s.path === selectedSessionFile.value);
        await workbench.addSessionAttachment({
          path: selectedSessionFile.value,
          title: pickedSession?.title,
        });
      }

      if (promptText) {
        const targetWs = workbench.findWorkspace(newPath) ?? workbench.active.value;
        if (targetWs) {
          targetWs.draft = promptText;
        }
        bus.emit("composer:set", { cwd: newPath, text: promptText });
        if (sendImmediately.value) {
          await workbench.send(promptText);
        }
      }
    }

    bus.emit("notify", {
      level: "info",
      text: createRes.sessionFile
        ? `${createRes.message}，并已加载所选对话`
        : createRes.message,
    });
    busy.value = false;
    closeWorktreeDialog();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    busy.value = false;
  }
}

function onKey(event: KeyboardEvent): void {
  if (!worktreeDialogState.open || event.key !== "Escape") return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="worktreeDialogState.open" class="modal-backdrop" @mousedown.self="close">
    <form class="modal worktree-dialog" role="dialog" aria-label="新建 Git Worktree（隔离工作区与对话）" @submit.prevent="submit">
      <div class="worktree-dialog-head">
        <div>
          <h3 class="modal-title"><span v-html="icons.branch" /> 新建 Git Worktree（隔离工作区）</h3>
          <p v-if="overview?.isRepo" class="worktree-dialog-sub">
            仓库：<strong>{{ repoName }}</strong>
            <span>·</span>
            当前分支：<code>{{ overview.branch }}</code>
          </p>
        </div>
        <button type="button" class="icon-btn small" title="关闭 (Esc)" :disabled="busy" @click="close" v-html="icons.close" />
      </div>

      <div v-if="loading" class="worktree-dialog-loading">
        <span class="mini-spinner" /> 正在读取仓库分支、提交与会话信息…
      </div>

      <div v-else-if="!overview?.isRepo" class="worktree-dialog-empty">
        当前项目不是 Git 仓库，请先在 Git 面板初始化仓库后再创建隔离工作区。
      </div>

      <div v-else-if="!overview.hasCommits" class="worktree-dialog-empty">
        当前仓库还没有任何提交，请先完成首次提交（Commit）后再创建隔离工作区。
      </div>

      <div v-else class="worktree-dialog-body">
        <!-- 1. 分支策略与命名 -->
        <section class="wt-section">
          <div class="wt-section-head">
            <span class="wt-section-title">1. 分支策略与名称</span>
            <div class="git-wt-kind-tabs" role="tablist" aria-label="分支策略">
              <button
                type="button"
                class="git-wt-kind-tab"
                :class="{ active: branchMode === 'create' }"
                :disabled="busy"
                @click="branchMode = 'create'"
              >新建分支</button>
              <button
                type="button"
                class="git-wt-kind-tab"
                :class="{ active: branchMode === 'existing' }"
                :disabled="busy"
                @click="branchMode = 'existing'"
              >检出已有分支</button>
            </div>
          </div>

          <template v-if="branchMode === 'create'">
            <div class="wt-grid-2">
              <div class="clone-field">
                <label class="clone-label" for="wt-task-name">任务标识（简称）</label>
                <input
                  id="wt-task-name"
                  ref="nameInput"
                  v-model="taskName"
                  class="clone-input"
                  placeholder="例如 fix-auth 或 feat-export"
                  spellcheck="false"
                  autocomplete="off"
                  :disabled="busy"
                  @input="onTaskNameInput"
                />
              </div>
              <div class="clone-field">
                <div class="wt-label-row">
                  <label class="clone-label" for="wt-branch-name">新分支名称（可自定义修改）</label>
                  <button
                    v-if="branchNameTouched"
                    type="button"
                    class="wt-link-btn"
                    :disabled="busy"
                    @click="resetBranchName"
                  >恢复默认 ({{ defaultBranchName || 'pi/...' }})</button>
                </div>
                <input
                  id="wt-branch-name"
                  v-model="customBranchName"
                  class="clone-input"
                  placeholder="例如 pi/fix-auth 或 feat/fix-auth"
                  spellcheck="false"
                  autocomplete="off"
                  :disabled="busy"
                  @input="onCustomBranchInput"
                />
              </div>
            </div>
          </template>

          <template v-else>
            <div class="clone-field">
              <label class="clone-label">选择要检出的分支</label>
              <SelectMenu
                :model-value="existingBranchRef"
                :options="existingBranchOptions"
                :disabled="busy"
                placeholder="选择本地或远程分支"
                width="100%"
                @update:model-value="onExistingBranchChange"
              />
            </div>
            <div v-if="selectedExistingBranch?.remote" class="clone-field">
              <label class="clone-label" for="wt-remote-local">本地跟踪分支名称</label>
              <input
                id="wt-remote-local"
                v-model="remoteLocalBranchName"
                class="clone-input"
                placeholder="输入要创建的本地跟踪分支名"
                spellcheck="false"
                :disabled="busy"
                @input="remoteLocalBranchTouched = true"
              />
            </div>
          </template>
        </section>

        <!-- 2. 起点阶段与合并目标分支 -->
        <section class="wt-section">
          <div class="wt-section-head">
            <span class="wt-section-title">2. 起点阶段与合并目标</span>
            <div v-if="branchMode === 'create'" class="git-wt-kind-tabs" role="tablist" aria-label="起点阶段类型">
              <button
                type="button"
                class="git-wt-kind-tab"
                :class="{ active: startKind === 'local' }"
                :disabled="busy"
                @click="selectStartKind('local')"
              >本地分支</button>
              <button
                type="button"
                class="git-wt-kind-tab"
                :class="{ active: startKind === 'remote' }"
                :disabled="busy || !remoteBranches.length"
                @click="selectStartKind('remote')"
              >远程分支</button>
              <button
                type="button"
                class="git-wt-kind-tab"
                :class="{ active: startKind === 'commit' }"
                :disabled="busy || !recentCommits.length"
                @click="selectStartKind('commit')"
              >指定提交</button>
            </div>
          </div>

          <div class="wt-grid-2">
            <div v-if="branchMode === 'create'" class="clone-field">
              <label class="clone-label">基于阶段（Start Point）</label>
              <SelectMenu
                v-if="startKind === 'local'"
                :model-value="startPoint"
                :options="startLocalOptions"
                :disabled="busy"
                placeholder="选择起点本地分支"
                width="100%"
                @update:model-value="onStartPointChange"
              />
              <SelectMenu
                v-else-if="startKind === 'remote'"
                :model-value="startPoint"
                :options="startRemoteOptions"
                :disabled="busy"
                placeholder="选择起点远程分支"
                width="100%"
                @update:model-value="onStartPointChange"
              />
              <div v-else class="wt-commit-stack">
                <SelectMenu
                  :model-value="startPoint"
                  :options="startCommitOptions"
                  :disabled="busy"
                  placeholder="从最近提交中选择"
                  width="100%"
                  @update:model-value="(val) => (startPoint = String(val))"
                />
                <input
                  v-model="startPoint"
                  class="clone-input"
                  placeholder="或直接输入任意 Commit Hash / Tag"
                  spellcheck="false"
                  :disabled="busy"
                />
              </div>
            </div>

            <div class="clone-field">
              <label class="clone-label">完成后合并回目标分支</label>
              <SelectMenu
                :model-value="baseBranch"
                :options="baseBranchOptions"
                :disabled="busy"
                placeholder="选择目标本地分支"
                width="100%"
                @update:model-value="(val) => { baseBranch = String(val); baseBranchTouched = true; }"
              />
            </div>
          </div>
        </section>

        <!-- 3. Worktree 存放目录 -->
        <section class="wt-section">
          <div class="wt-section-head">
            <span class="wt-section-title">3. Worktree 存放位置</span>
            <button
              v-if="isCustomDirectory"
              type="button"
              class="wt-link-btn"
              :disabled="busy"
              @click="resetDirectory"
            >恢复默认托管目录</button>
          </div>
          <div class="wt-grid-2">
            <div class="clone-field">
              <label class="clone-label" for="wt-parent-dir">存放父文件夹</label>
              <span class="clone-location">
                <input
                  id="wt-parent-dir"
                  v-model="parentLocation"
                  class="clone-input"
                  placeholder="选择或输入存放父目录"
                  spellcheck="false"
                  :disabled="busy"
                />
                <button
                  type="button"
                  class="icon-btn clone-browse"
                  title="浏览选择文件夹"
                  aria-label="浏览选择文件夹"
                  :disabled="busy"
                  @click="browseParentDirectory"
                  v-html="icons.folder"
                />
              </span>
            </div>
            <div class="clone-field">
              <label class="clone-label" for="wt-folder-name">子目录名称</label>
              <input
                id="wt-folder-name"
                v-model="folderName"
                class="clone-input"
                placeholder="工作区文件夹名"
                spellcheck="false"
                :disabled="busy"
                @input="onFolderNameInput"
              />
            </div>
          </div>
          <p class="clone-target">
            将创建到 <code>{{ targetDirPreview }}</code>
          </p>
        </section>

        <!-- 4. 加载对话与初始任务 -->
        <section class="wt-section">
          <div class="wt-section-head">
            <span class="wt-section-title">4. 对话加载与初始任务</span>
          </div>

          <div class="clone-field">
            <label class="clone-label">关联 / 加载已有对话到新 Worktree</label>
            <SelectMenu
              :model-value="selectedSessionFile"
              :options="sessionOptions"
              :disabled="busy"
              placeholder="选择是否加载对话"
              width="100%"
              @update:model-value="(val) => (selectedSessionFile = String(val))"
            />
          </div>

          <div v-if="selectedSessionFile" class="wt-radio-group" role="radiogroup" aria-label="对话加载方式">
            <label class="wt-radio">
              <input v-model="sessionLoadMode" type="radio" value="clone" :disabled="busy" />
              <span><strong>完整复制对话历史</strong>（在新 Worktree 中直接加载并继续该对话）</span>
            </label>
            <label class="wt-radio">
              <input v-model="sessionLoadMode" type="radio" value="quote" :disabled="busy" />
              <span><strong>作为 @上下文引用</strong>（新建空白对话，并将所选对话作为上下文附件注入）</span>
            </label>
          </div>

          <div class="clone-field">
            <div class="wt-label-row">
              <label class="clone-label" for="wt-initial-prompt">初始任务指令 / 草稿（可选）</label>
              <label v-if="initialPrompt.trim()" class="wt-inline-check">
                <input v-model="sendImmediately" type="checkbox" :disabled="busy" />
                <span>创建后立即发送给 Pi 执行</span>
              </label>
            </div>
            <textarea
              id="wt-initial-prompt"
              v-model="initialPrompt"
              class="clone-input wt-prompt-textarea"
              rows="2"
              placeholder="可选：输入要让新 Worktree 的 Pi Agent 执行的任务描述（若不勾选立即发送，将自动填入新工作区输入框）"
              :disabled="busy"
            />
          </div>

          <label class="wt-inline-check">
            <input v-model="openAfterCreate" type="checkbox" :disabled="busy || Boolean(selectedSessionFile) || Boolean(initialPrompt.trim())" />
            <span>创建完成后立即打开并切换到该隔离工作区</span>
          </label>
        </section>
      </div>

      <p v-if="error" class="clone-error">{{ error }}</p>

      <div class="modal-actions">
        <button type="button" class="btn" :disabled="busy" @click="close">取消</button>
        <button type="submit" class="btn primary" :disabled="!canSubmit">
          <span v-if="busy" class="mini-spinner" />
          {{
            busy
              ? "正在创建…"
              : selectedSessionFile
                ? "创建 Worktree 并加载对话"
                : openAfterCreate
                  ? "创建并打开 Worktree"
                  : "创建 Worktree"
          }}
        </button>
      </div>
    </form>
  </div>
</template>
