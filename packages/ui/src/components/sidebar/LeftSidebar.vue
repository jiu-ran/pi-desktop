<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { displayProjectName, icons, projectPathKey, relativeTime } from "../../shared/util.ts";
import { openCloneDialog } from "../../services/clone-dialog.ts";
import { askConfirm, askPrompt, openMenu } from "./ui.ts";

export type SessionWorkState = "running" | "compacting" | "error" | "done" | "active" | "idle";

/**
 * 1 区域（左侧边栏）：管理项目目录与会话（任务）。
 * 内置标准 Vue 组件，不经过插件系统。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;
const query = ref("");
const collapsed = reactive<Record<string, boolean>>({});
const cache = reactive<Record<string, any[]>>({});
const completedUnread = reactive<Record<string, boolean>>({});
const finishedAt = reactive<Record<string, number>>({});

const offEvent = bus.on(
  "pi:event",
  ({ cwd, sessionFile, event, workspace }: { cwd: string; sessionFile?: string; event: any; workspace: any }) => {
    const targetFile = sessionFile || workspace?.sessionFile;
    if (event?.type === "agent_settled" && targetFile) {
      finishedAt[targetFile] = Date.now();
      const viewingNow = cwd === state.activeCwd && workspace?.sessionFile === targetFile;
      if (!viewingNow) {
        completedUnread[targetFile] = true;
      }
    }
  },
);
onBeforeUnmount(offEvent);

const projects = computed(() => {
  const seen = new Set<string>();
  const list: string[] = [];
  // 打开中的工作区优先；recent 里同一个目录可能使用不同的分隔符或大小写，
  // 必须按可比较路径去重，否则侧栏会出现两个同名项目。
  for (const cwd of [
    ...[...workbench.workspaces.values()].map((ws) => ws.cwd),
    ...state.recent,
  ]) {
    const key = projectPathKey(cwd);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(cwd);
  }
  return list;
});

function sessionsOf(cwd: string): any[] {
  const ws = workbench.workspaces.get(cwd);
  if (ws?.status === "ready") return ws.sessions;
  return cache[cwd] ?? [];
}

async function load(cwd: string): Promise<void> {
  if (workbench.workspaces.get(cwd)?.status === "ready" || cache[cwd]) return;
  try {
    cache[cwd] = await workbench.listSessions(cwd);
  } catch {
    cache[cwd] = [];
  }
}

watch(
  projects,
  (list) => {
    for (const cwd of list) {
      if (!(cwd in collapsed)) collapsed[cwd] = cwd !== state.activeCwd;
      if (!collapsed[cwd]) load(cwd);
    }
  },
  { immediate: true },
);
watch(
  () => state.activeCwd,
  (cwd) => {
    if (cwd) {
      collapsed[cwd] = false;
      load(cwd);
    }
  },
);

function toggle(cwd: string): void {
  collapsed[cwd] = !collapsed[cwd];
  if (!collapsed[cwd]) load(cwd);
}

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  return projects.value
    .map((cwd) => {
      const ws = workbench.workspaces.get(cwd);
      const all = sessionsOf(cwd);
      const sessions = q ? all.filter((s: any) => String(s.title ?? "").toLowerCase().includes(q)) : all;
      return {
        cwd,
        ws,
        name: displayProjectName(cwd),
        branch: ws?.branch ?? "",
        count: all.length,
        sessions,
        open: q ? sessions.length > 0 : !collapsed[cwd],
        visible: !q || sessions.length > 0 || displayProjectName(cwd).toLowerCase().includes(q),
      };
    })
    .filter((group) => group.visible);
});

function isGroupCurrent(group: any, item: any): boolean {
  if (!group.ws?.sessionFile || !item?.path) return false;
  return group.ws.sessionFile.replace(/\\/g, "/").toLowerCase() === item.path.replace(/\\/g, "/").toLowerCase();
}

function isActive(group: any, item: any): boolean {
  return projectPathKey(group.cwd) === projectPathKey(state.activeCwd) && isGroupCurrent(group, item);
}

function isRunning(group: any, item: any): boolean {
  return Boolean(
    group.ws?.isSessionStreaming?.(item.path) ||
      group.ws?.isSessionCompacting?.(item.path) ||
      (isGroupCurrent(group, item) && (group.ws?.streaming || group.ws?.compacting)),
  );
}

function queuedCount(group: any, item: any): number {
  const thread = group.ws?.getThread?.(item?.path);
  if (!thread) return 0;
  return (thread.queue?.steering?.length ?? 0) + (thread.queue?.followUp?.length ?? 0);
}

function taskState(group: any, item: any): {
  kind: SessionWorkState;
  badge: string;
  tooltip: string;
} {
  const currentInGroup = isGroupCurrent(group, item);
  const active = isActive(group, item);
  const sessionCompacting =
    group.ws?.isSessionCompacting?.(item.path) || (currentInGroup && Boolean(group.ws?.compacting));
  const sessionStreaming =
    group.ws?.isSessionStreaming?.(item.path) || (currentInGroup && Boolean(group.ws?.streaming));

  if (sessionCompacting) {
    return {
      kind: "compacting",
      badge: "整理中",
      tooltip: "正在压缩并整理会话上下文",
    };
  }
  if (sessionStreaming) {
    const q = queuedCount(group, item);
    return {
      kind: "running",
      badge: q > 0 ? `运行中 · +${q}` : "运行中",
      tooltip: q > 0 ? `Agent 正在运行（队列中有 ${q} 条待处理消息）` : "Agent 正在执行此任务（支持并行切换）",
    };
  }
  if (currentInGroup && group.ws?.status === "error") {
    return {
      kind: "error",
      badge: "异常",
      tooltip: group.ws?.error || "会话进程连接异常",
    };
  }
  if (completedUnread[item.path]) {
    return {
      kind: "done",
      badge: "已完成",
      tooltip: "后台任务刚刚执行完成，点击查看",
    };
  }
  if (active) {
    return {
      kind: "active",
      badge: finishedAt[item.path] ? "已完成" : "",
      tooltip: "当前活动会话（就绪）",
    };
  }
  return {
    kind: "idle",
    badge: "",
    tooltip: "历史会话",
  };
}

async function selectSession(group: any, item: any): Promise<void> {
  delete completedUnread[item.path];
  await workbench.openSession(group.cwd, item.path);
}

async function newTask(cwd: string): Promise<void> {
  await workbench.open(cwd);
  await workbench.newSession();
}

const fail = (error: any) => bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
const info = (text: string) => bus.emit("notify", { level: "info", text });

async function removeTask(group: any, item: any): Promise<void> {
  if (isRunning(group, item)) {
    fail(new Error("任务正在运行，请先停止再删除"));
    return;
  }
  const ok = await askConfirm({
    title: "删除任务？",
    message: `「${item.title}」的会话文件将移入回收站，可以从回收站恢复。`,
    confirmLabel: "删除",
    danger: true,
  });
  if (!ok) return;
  try {
    const sessions = await workbench.deleteSession(group.cwd, item.path);
    if (cache[group.cwd]) cache[group.cwd] = sessions;
    info("已将任务移入回收站");
  } catch (error) {
    fail(error);
  }
}

async function removeProject(group: any): Promise<void> {
  if (group.ws?.hasAnyRunning) {
    fail(new Error("该项目有任务正在运行，请先停止"));
    return;
  }
  await load(group.cwd);
  const count = sessionsOf(group.cwd).length;
  const ok = await askConfirm({
    title: `移除项目「${group.name}」？`,
    message: "会停止该项目的 Pi 进程并从列表中移除，不会删除项目目录下的任何文件。",
    confirmLabel: "移除",
    danger: true,
    check: count ? { label: `同时删除该项目的 ${count} 个任务（移入回收站）`, value: false } : null,
  });
  if (!ok) return;
  try {
    const result = await workbench.removeProject(group.cwd, { deleteSessions: ok.checked });
    // 用户在「未保存草稿」二次确认里取消：保持原状，不提示错误。
    if (result?.cancelled) return;
    delete cache[group.cwd];
    delete collapsed[group.cwd];
    info(
      ok.checked
        ? `已移除项目，${result.deleted} 个任务已移入回收站${result.failed ? `，${result.failed} 个删除失败` : ""}`
        : "已移除项目",
    );
  } catch (error) {
    fail(error);
  }
}

async function clearProject(group: any): Promise<void> {
  await load(group.cwd);
  const items = sessionsOf(group.cwd).filter((item: any) => !isRunning(group, item));
  if (!items.length) {
    info("这个项目没有可删除的任务");
    return;
  }
  const ok = await askConfirm({
    title: `删除「${group.name}」的全部任务？`,
    message: `${items.length} 个会话文件将移入回收站，项目本身保留在列表中。`,
    confirmLabel: "全部删除",
    danger: true,
  });
  if (!ok) return;
  let failed = 0;
  for (const item of items) {
    try {
      const sessions = await workbench.deleteSession(group.cwd, item.path);
      if (cache[group.cwd]) cache[group.cwd] = sessions;
    } catch {
      failed += 1;
    }
  }
  info(failed ? `已删除 ${items.length - failed} 个任务，${failed} 个失败` : `已将 ${items.length} 个任务移入回收站`);
}

function projectMenu(event: MouseEvent, group: any): void {
  openMenu(event, [
    { label: "新建任务", icon: icons.plus, run: () => newTask(group.cwd).catch(fail) },
    { label: "在文件管理器中显示", icon: icons.folder, run: () => workbench.reveal(group.cwd) },
    { label: "复制路径", icon: icons.copy, run: () => navigator.clipboard.writeText(group.cwd).then(() => info("已复制路径")) },
    { separator: true },
    { label: "删除全部空闲任务…", icon: icons.trash, danger: true, run: () => clearProject(group) },
    { label: "移除项目…", icon: icons.close, danger: true, disabled: group.ws?.hasAnyRunning, run: () => removeProject(group) },
  ]);
}

function taskMenu(event: MouseEvent, group: any, item: any): void {
  const running = isRunning(group, item);
  openMenu(event, [
    {
      label: "打开",
      icon: icons.chat,
      run: () => selectSession(group, item).catch(fail),
    },
    {
      label: "重命名任务…",
      icon: icons.text,
      disabled: !isActive(group, item),
      run: () => renameTask(group, item),
    },
    { label: "在文件管理器中显示会话文件", icon: icons.folder, run: () => workbench.reveal(item.path) },
    { separator: true },
    { label: "删除任务…", icon: icons.trash, danger: true, disabled: running, run: () => removeTask(group, item) },
  ]);
}

async function renameTask(group: any, item: any): Promise<void> {
  if (!isActive(group, item)) return;
  const name = await askPrompt({
    title: "重命名任务",
    message: "名称会显示在左侧任务列表与任务信息中。",
    label: "任务名称",
    value: item.title ?? "",
    confirmLabel: "保存",
  });
  if (!name) return;
  if (!isActive(group, item)) return;
  await workbench.renameSession(name);
  info("已重命名任务");
}

/** 「+」按钮的两个入口：本地文件夹、从 Git 克隆 */
function openProjectMenu(event: MouseEvent): void {
  openMenu(event, [
    { label: "打开文件夹…", icon: icons.folder, hint: "Ctrl+O", run: () => void workbench.chooseAndOpen() },
    { label: "从 Git 克隆…", icon: icons.branch, run: () => openCloneDialog() },
  ]);
}
</script>

<template>
  <div class="tasks pane-body">
    <div class="tasks-head">
      <span class="tasks-title">项目与会话</span>
      <button class="icon-btn" title="打开文件夹，或从 Git 克隆 (Ctrl+O)" aria-label="打开文件夹或克隆仓库" @click="openProjectMenu" v-html="icons.folderAdd" />
    </div>
    <div class="tasks-search">
      <span class="tasks-search-icon" v-html="icons.search" />
      <input v-model="query" placeholder="搜索项目或任务" />
      <button
        v-if="query"
        type="button"
        class="tasks-search-clear"
        title="清除搜索"
        aria-label="清除搜索"
        @click="query = ''"
      >×</button>
    </div>

    <div class="tasks-list">
      <section v-for="group in groups" :key="group.cwd" class="project" :class="{ current: group.cwd === state.activeCwd }">
        <div
          class="project-row"
          :title="group.cwd"
          role="button"
          tabindex="0"
          @click="toggle(group.cwd)"
          @keydown.enter="toggle(group.cwd)"
          @contextmenu="projectMenu($event, group)"
        >
          <span class="project-caret" v-html="group.open ? icons.chevronDown : icons.chevronRight" />
          <span class="project-name">{{ group.name }}</span>
          <span v-if="group.branch" class="project-branch"><span v-html="icons.branch" />{{ group.branch }}</span>
          <span v-if="group.count" class="project-count" :title="`${group.count} 个任务`">{{ group.count > 99 ? "99+" : group.count }}</span>
          <span v-if="group.ws?.status === 'starting'" class="project-status starting">
            <span class="mini-spinner" />启动中
          </span>
          <span v-else-if="(group.ws?.runningSessionCount ?? 0) > 1" class="project-status running">
            <span class="project-status-dot" />{{ group.ws.runningSessionCount }} 并行中
          </span>
          <span v-else-if="group.ws?.compacting" class="project-status compacting">
            <span class="project-status-dot" />整理中
          </span>
          <span v-else-if="group.ws?.hasAnyRunning" class="project-status running">
            <span class="project-status-dot" />运行中
          </span>
          <span class="project-actions">
            <button class="icon-btn small" title="在此项目新建并行任务" @click.stop="newTask(group.cwd)" v-html="icons.plus" />
            <button class="icon-btn small" title="更多操作" @click.stop="projectMenu($event, group)" v-html="icons.more" />
          </span>
        </div>

        <ul v-if="group.open" class="task-list">
          <li v-for="item in group.sessions" :key="item.id" class="task-item" @contextmenu="taskMenu($event, group, item)">
            <button
              class="task-row"
              :class="[
                `state-${taskState(group, item).kind}`,
                { active: isActive(group, item), running: isRunning(group, item) },
              ]"
              :title="`${item.title} — ${taskState(group, item).tooltip}`"
              @click="selectSession(group, item)"
            >
              <span
                class="task-state"
                :data-state="taskState(group, item).kind"
                :title="taskState(group, item).tooltip"
              >
                <span
                  v-if="taskState(group, item).kind === 'running' || taskState(group, item).kind === 'compacting'"
                  class="task-orbit"
                />
                <span
                  v-else-if="taskState(group, item).kind === 'done'"
                  class="task-check"
                  v-html="icons.check"
                />
                <span v-else class="task-dot" />
              </span>
              <span class="task-title">{{ item.title }}</span>
              <span
                v-if="taskState(group, item).badge"
                class="task-badge"
                :data-state="taskState(group, item).kind"
              >
                <span
                  v-if="taskState(group, item).kind === 'running' || taskState(group, item).kind === 'compacting'"
                  class="task-badge-pulse"
                />
                {{ taskState(group, item).badge }}
              </span>
              <span v-else class="task-time">{{ relativeTime(item.timestamp) }}</span>
            </button>
            <span class="task-actions">
              <button
                class="icon-btn small"
                title="删除任务"
                :disabled="isRunning(group, item)"
                @click.stop="removeTask(group, item)"
                v-html="icons.trash"
              />
            </span>
          </li>
          <li v-if="!group.sessions.length" class="task-empty">{{ query ? "没有匹配的任务" : "还没有任务" }}</li>
        </ul>
      </section>

      <div v-if="!projects.length" class="tasks-empty">
        <p>还没有打开项目</p>
        <span>打开本地目录后即可创建任务。</span>
        <button class="btn" @click="workbench.chooseAndOpen()">打开项目目录</button>
      </div>
    </div>
  </div>
</template>
