<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons, relativeTime } from "../../shared/util.ts";
import { askConfirm, openMenu } from "./ui.ts";

/**
 * 任务导航（参考 Air 的多项目视图）：按项目分组，组内是 Pi 的会话。
 * 未启动的项目也能展开查看历史会话，点击会话时才启动对应的 pi 进程。
 */
const { workbench, bus } = useKernel();
const state = workbench.state;
const query = ref("");
const collapsed = reactive({});
const cache = reactive({});

const projects = computed(() => {
  const open = [...workbench.workspaces.values()].map((ws) => ws.cwd);
  return [...new Set([...open, ...state.recent])];
});

function sessionsOf(cwd) {
  const ws = workbench.workspaces.get(cwd);
  if (ws?.status === "ready") return ws.sessions;
  return cache[cwd] ?? [];
}

async function load(cwd) {
  if (workbench.workspaces.get(cwd)?.status === "ready" || cache[cwd]) return;
  try {
    cache[cwd] = await workbench.listSessions(cwd);
  } catch {
    cache[cwd] = [];
  }
}

// 默认展开当前项目，其余折叠；折叠的项目展开时再读历史
watch(projects, (list) => {
  for (const cwd of list) {
    if (!(cwd in collapsed)) collapsed[cwd] = cwd !== state.activeCwd;
    if (!collapsed[cwd]) load(cwd);
  }
}, { immediate: true });
watch(() => state.activeCwd, (cwd) => { if (cwd) { collapsed[cwd] = false; load(cwd); } });

function toggle(cwd) {
  collapsed[cwd] = !collapsed[cwd];
  if (!collapsed[cwd]) load(cwd);
}

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  return projects.value.map((cwd) => {
    const ws = workbench.workspaces.get(cwd);
    const all = sessionsOf(cwd);
    const sessions = q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all;
    return {
      cwd,
      ws,
      name: baseName(cwd),
      branch: ws?.branch ?? "",
      sessions,
      open: q ? sessions.length > 0 : !collapsed[cwd],
      visible: !q || sessions.length > 0 || baseName(cwd).toLowerCase().includes(q),
    };
  }).filter((group) => group.visible);
});

function isActive(group, item) {
  return group.cwd === state.activeCwd && item.path === group.ws?.sessionFile;
}
function isRunning(group, item) {
  return isActive(group, item) && group.ws?.streaming;
}

async function newTask(cwd) {
  await workbench.open(cwd);
  await workbench.newSession();
}

const fail = (error) => bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
const info = (text) => bus.emit("notify", { level: "info", text });

/** 删除一个任务（会话文件移入回收站） */
async function removeTask(group, item) {
  if (isRunning(group, item)) { fail(new Error("任务正在运行，请先停止再删除")); return; }
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

/** 移除项目：停止其 pi 进程并从列表移除；可勾选同时删除全部任务。项目目录本身不动。 */
async function removeProject(group) {
  if (group.ws?.streaming) { fail(new Error("该项目有任务正在运行，请先停止")); return; }
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
    delete cache[group.cwd];
    delete collapsed[group.cwd];
    info(ok.checked ? `已移除项目，${result.deleted} 个任务已移入回收站${result.failed ? `，${result.failed} 个删除失败` : ""}` : "已移除项目");
  } catch (error) {
    fail(error);
  }
}

async function clearProject(group) {
  await load(group.cwd);
  const items = sessionsOf(group.cwd).filter((item) => !isRunning(group, item));
  if (!items.length) { info("这个项目没有可删除的任务"); return; }
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

function projectMenu(event, group) {
  openMenu(event, [
    { label: "新建任务", icon: icons.plus, run: () => newTask(group.cwd).catch(fail) },
    { label: "在文件管理器中显示", icon: icons.folder, run: () => workbench.reveal(group.cwd) },
    { label: "复制路径", icon: icons.copy, run: () => navigator.clipboard.writeText(group.cwd).then(() => info("已复制路径")) },
    { separator: true },
    { label: "删除全部任务…", icon: icons.trash, danger: true, disabled: group.ws?.streaming, run: () => clearProject(group) },
    { label: "移除项目…", icon: icons.close, danger: true, disabled: group.ws?.streaming, run: () => removeProject(group) },
  ]);
}

function taskMenu(event, group, item) {
  const running = isRunning(group, item);
  openMenu(event, [
    { label: "打开", icon: icons.chat, disabled: group.ws?.streaming && !isActive(group, item), run: () => workbench.openSession(group.cwd, item.path).catch(fail) },
    { label: "在文件管理器中显示会话文件", icon: icons.folder, run: () => workbench.reveal(item.path) },
    { separator: true },
    { label: "删除任务…", icon: icons.trash, danger: true, disabled: running, run: () => removeTask(group, item) },
  ]);
}
</script>

<template>
  <div class="tasks">
    <div class="tasks-head">
      <span class="tasks-title">任务</span>
      <button class="icon-btn" title="打开项目目录 (Ctrl+O)" @click="workbench.chooseAndOpen()" v-html="icons.folder" />
    </div>
    <div class="tasks-search">
      <span class="tasks-search-icon" v-html="icons.search" />
      <input v-model="query" placeholder="搜索任务" />
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
          <span v-if="group.ws?.status === 'starting'" class="mini-spinner" />
          <span class="project-actions">
            <button class="icon-btn small" title="在此项目新建任务" @click.stop="newTask(group.cwd)" v-html="icons.plus" />
            <button class="icon-btn small" title="更多操作" @click.stop="projectMenu($event, group)" v-html="icons.more" />
          </span>
        </div>

        <ul v-if="group.open" class="task-list">
          <li v-for="item in group.sessions" :key="item.id" class="task-item" @contextmenu="taskMenu($event, group, item)">
            <button
              class="task-row"
              :class="{ active: isActive(group, item) }"
              :disabled="group.ws?.streaming && !isActive(group, item)"
              :title="item.title"
              @click="workbench.openSession(group.cwd, item.path)"
            >
              <span class="task-state" :class="{ running: isRunning(group, item) }">
                <span v-if="isRunning(group, item)" class="mini-spinner" />
                <span v-else v-html="icons.checkCircle" />
              </span>
              <span class="task-title">{{ item.title }}</span>
              <span class="task-time">{{ relativeTime(item.timestamp) }}</span>
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
        <p>还没有打开过项目。</p>
        <button class="btn" @click="workbench.chooseAndOpen()">打开项目目录</button>
      </div>
    </div>
  </div>
</template>
