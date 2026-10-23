<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import PtyTerminal from "./PtyTerminal.vue";
import "../../styles/terminal.css";
import { useKernel } from "../../kernel/use-kernel.ts";
import { TERMINAL_STATUS_LABEL, formatTerminalDuration, type TerminalTask } from "../../services/terminal.ts";
import { renderTerminalHtml, stripTerminalAnsi, terminalPlainText } from "../../shared/terminal-text.ts";
import { appSettings, openSettingsModal } from "../../services/settings.ts";
import { displayProjectName, icons } from "../../shared/util.ts";

const { workbench, terminal } = useKernel();
const state = terminal.state;
const task = terminal.activeTask;
const tasks = terminal.sortedTasks;

const inputEl = ref<HTMLInputElement | null>(null);
const outputEl = ref<HTMLElement | null>(null);
const tabsEl = ref<HTMLElement | null>(null);
const tabsOverflow = ref(false);
const tabsAtEnd = ref(false);
const tabsAtStart = ref(true);
const ptySize = ref({ cols: 100, rows: 30 });
interface PtyScreen { focus: () => void }
const ptyScreens = new Map<string, PtyScreen>();
const stick = ref(true);
const resizing = ref(false);
const copied = ref(false);
const wrap = ref(loadWrap());
const secret = ref(false);
const shellChoice = ref("");
const backgroundNote = ref("");

const cwd = computed(() => workbench.state.activeCwd);
// 一次性命令实际在当前项目启动，不继承 PTY 内的 cd 或另一项目会话的目录。
const composerCwd = computed(() => (legacyInteractive.value && task.value ? task.value.cwd : cwd.value));
const composerCwdLabel = computed(() => displayProjectName(composerCwd.value) || "未打开项目");
const statusLabel = computed(() => (task.value ? TERMINAL_STATUS_LABEL[task.value.status] : ""));
const isRunning = computed(() => task.value?.status === "running" || task.value?.status === "stopping");
const interactive = computed(() => Boolean(task.value?.interactive));
const pty = computed(() => Boolean(task.value?.pty));
const ptyTasks = computed(() => state.tasks.filter((item) => item.pty));
const taskGroups = computed(() => [
  // 交互终端按创建顺序排（CMD 1..n），后台命令按最新优先，与创建时间语义一致。
  { key: "pty", label: "交互终端", items: ptyTasks.value },
  { key: "command", label: "后台命令", items: tasks.value.filter((item) => !item.pty) },
]);
const legacyInteractive = computed(() => interactive.value && !pty.value);
const ptyRunning = computed(() => pty.value && isRunning.value);
const interactiveRunning = computed(() => interactive.value && isRunning.value);
const shellEnded = computed(() => interactive.value && !isRunning.value);
const canStartTerminal = computed(() => terminal.supportsPty || terminal.supportsShell);
const startLabel = computed(() => (terminal.supportsPty ? "新建终端" : "新建交互会话"));
const finishedCount = computed(() => state.tasks.filter((item) => item.status !== "running" && item.status !== "stopping").length);
const outputHtml = computed(() => (task.value && !task.value.pty ? renderTerminalHtml(task.value.output) : ""));
const inputPlaceholder = computed(() => {
  if (pty.value) return "输入后台命令，不会发送到上方终端";
  if (shellEnded.value) return "会话已结束，点击“新建会话”继续";
  if (secret.value) return "输入密码，Enter 发送";
  if (interactiveRunning.value) return "输入命令或 SQL，Enter 发送";
  return "输入构建、测试或其他后台命令…";
});
const runLabel = computed(() => {
  if (pty.value) return "后台运行";
  if (shellEnded.value) return "新建会话";
  return interactiveRunning.value ? "发送" : "运行";
});
const stopLabel = computed(() => (interactive.value ? "结束" : "停止"));
const footerHint = computed(() => {
  if (backgroundNote.value) return backgroundNote.value;
  if (pty.value) {
    return ptyRunning.value
      ? "选中 Ctrl+C 复制 · Ctrl+V 粘贴 · 无选中 Ctrl+C 中断"
      : "终端已结束 · 此处仍可运行后台命令";
  }
  if (interactiveRunning.value) return "交互会话 · Enter 发送 · Ctrl+Enter 后台运行 · Ctrl+L 清屏";
  return "Enter 运行 · ↑↓ 历史 · Ctrl+L 清屏";
});

const examples = [
  { command: "npm run dev", label: "启动开发服务器", recent: false },
  { command: "npm run build", label: "构建生产包", recent: false },
  { command: "npm test", label: "运行测试", recent: false },
  { command: "git status", label: "查看 Git 状态", recent: false },
];

const quickCommands = computed(() => {
  const seen = new Set<string>();
  const recent: Array<{ command: string; label: string; recent: boolean }> = [];
  for (const command of state.history) {
    if (seen.has(command)) continue;
    seen.add(command);
    recent.push({ command, label: "最近运行", recent: true });
    if (recent.length >= 4) break;
  }
  return recent.length ? recent : examples;
});

let resizeStartY = 0;
let resizeStartHeight = 0;
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function loadWrap(): boolean {
  try {
    return localStorage.getItem("pi-desktop:terminal:wrap") !== "0";
  } catch {
    return true;
  }
}

function saveWrap(value: boolean): void {
  try {
    localStorage.setItem("pi-desktop:terminal:wrap", value ? "1" : "0");
  } catch {
    // 隐私模式下无法持久化时只影响下次打开。
  }
}

function toggleWrap(): void {
  wrap.value = !wrap.value;
  saveWrap(wrap.value);
}

function elapsed(item: TerminalTask): string {
  return formatTerminalDuration((item.endedAt ?? state.now) - item.startedAt);
}

function shortShell(item: TerminalTask): string {
  const shell = item.shell || item.command;
  return shell.split(" · ").pop() || shell;
}

const ptyLabelCount = computed(() => {
  const counts = new Map<string, number>();
  for (const item of ptyTasks.value) counts.set(shortShell(item), (counts.get(shortShell(item)) || 0) + 1);
  return counts;
});

function taskLabel(item: TerminalTask): string {
  // 标签只显示短名：shell 配置可能是“系统默认 · CMD”，完整信息放在 title。
  if (!item.pty) return item.command;
  const shell = shortShell(item);
  if ((ptyLabelCount.value.get(shell) || 0) < 2) return shell;
  // 多个同名终端时用创建序号区分，避免标签完全一样。
  const ordinal = ptyTasks.value.filter((other) => shortShell(other) === shell).findIndex((other) => other.id === item.id);
  return `${shell} ${ordinal + 1}`;
}

function taskTitle(item: TerminalTask): string {
  return [item.pty ? "交互终端" : "后台命令", item.command, item.cwd, TERMINAL_STATUS_LABEL[item.status]].join(" · ");
}

function revealActiveTab(): void {
  const active = tabsEl.value?.querySelector<HTMLElement>(".terminal-tab.active");
  if (active && state.open) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  updateTabsOverflow();
}

/** 标签能全部放下时不显示重复的“全部任务”下拉，放下时用它兜底。 */
function updateTabsOverflow(): void {
  const el = tabsEl.value;
  tabsOverflow.value = Boolean(el && el.scrollWidth > el.clientWidth + 2);
  onTabsScroll();
}

function onTabsScroll(): void {
  const el = tabsEl.value;
  tabsAtEnd.value = !el || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
  tabsAtStart.value = !el || el.scrollLeft <= 2;
}

/** 标签导航只接管自身的方向键，不影响 xterm 按键与滚轮。 */
function onTabKey(event: KeyboardEvent): void {
  const buttons = [...(tabsEl.value?.querySelectorAll<HTMLButtonElement>(".terminal-tab-main") || [])];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at < 0 || event.ctrlKey || event.metaKey || event.altKey) return;
  let next = at;
  if (event.key === "ArrowRight") next = (at + 1) % buttons.length;
  else if (event.key === "ArrowLeft") next = (at - 1 + buttons.length) % buttons.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else return;
  event.preventDefault();
  const id = buttons[next]?.dataset.taskId;
  if (!id) return;
  terminal.select(id);
  // 切换后 xterm 可能拿到焦点，用两级回调把焦点留在标签上，保证方向键连续可用。
  void nextTick(() => {
    const target = tabsEl.value?.querySelector<HTMLButtonElement>(`[data-task-id="${id}"]`);
    target?.focus();
    requestAnimationFrame(() => target?.focus());
  });
}

/** 标签行不显示滚动条；纵向滚轮在溢出时横向滚动，便于发现后面的任务。 */
function onTabsWheel(event: WheelEvent): void {
  const el = tabsEl.value;
  if (!el || !tabsOverflow.value || event.ctrlKey || event.shiftKey) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const before = el.scrollLeft;
  el.scrollLeft = before + event.deltaY;
  if (el.scrollLeft !== before) event.preventDefault();
}

function fillHistory(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const command = select.value;
  select.value = "";
  if (command && !secret.value) useExample(command);
}

function focusInput(): void {
  nextTick(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
  });
}

function scrollLatest(force = false): void {
  const el = outputEl.value;
  if (!el) return;
  if (!force && !stick.value) return;
  nextTick(() => {
    el.scrollTop = el.scrollHeight;
    stick.value = true;
  });
}

function onOutputScroll(): void {
  const el = outputEl.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

function scrollToLatestNow(): void {
  const scroller = outputEl.value;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  stick.value = true;
}

function detectPasswordPrompt(): void {
  if (!legacyInteractive.value || !interactiveRunning.value) return;
  // 旧的管道式会话没有 PTY；mysql / sudo 等程序仍会打印密码提示，
  // 看到提示后自动切到密码输入，避免密码明文留在输入框和会话历史里。
  const tail = stripTerminalAnsi((task.value?.output ?? "").slice(-240)).slice(-200);
  const lastLine = tail.split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  if (!lastLine.startsWith("❯ ") && /(?:password|密码)[^\r\n]{0,80}[:：]\s*$/i.test(lastLine)) {
    if (!secret.value) {
      // 提示出现前可能残留了下一条命令的草稿，不能把它当成密码发送。
      state.input = "";
    }
    secret.value = true;
  }
}

function setPtyScreen(id: string, screen: any): void {
  if (screen) ptyScreens.set(id, screen as PtyScreen);
  else ptyScreens.delete(id);
}

function focusTerminal(): void {
  if (!pty.value) {
    focusInput();
    return;
  }
  void nextTick(() => {
    if (state.open) ptyScreens.get(task.value?.id || "")?.focus();
  });
}

function markCopied(): void {
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
    copyTimer = null;
  }, 1200);
}

/** 关闭标签：运行中的任务先结束进程树再移除，已结束的直接移除。 */
async function closeTask(item: TerminalTask): Promise<void> {
  await terminal.close(item.id);
}

function closeTitle(item: TerminalTask): string {
  if (item.status === "running" || item.status === "stopping") return "结束并关闭（终止该窗格的进程树；仅中断当前程序请按 Ctrl+C）";
  return "关闭此任务";
}

function submit(): void {
  if (pty.value) {
    void submitBackground();
    return;
  }
  if (shellEnded.value) {
    void startTerminal();
    return;
  }
  const text = state.input;
  if (!text.trim() || state.starting) return;
  scrollToLatestNow();
  if (interactiveRunning.value) {
    const hidden = secret.value;
    if (hidden) {
      // 先清空输入再走异步 IPC，避免密码在输入框里多停留一帧。
      state.input = "";
      secret.value = false;
    }
    void terminal.send(text, { secret: hidden });
    return;
  }
  void terminal.run(text);
}

/** 把当前输入作为一次性后台任务启动；终端打开时也不抢走终端视图。 */
async function submitBackground(): Promise<void> {
  const command = state.input.trim();
  if (!command || state.starting || secret.value) return;
  if (pty.value) {
    const ok = await terminal.run(command, { background: true });
    if (ok) flashBackgroundNote(`已提交后台任务：${command}`);
    return;
  }
  scrollToLatestNow();
  void terminal.run(command);
}

let noteTimer: ReturnType<typeof setTimeout> | null = null;
function flashBackgroundNote(text: string): void {
  backgroundNote.value = text;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    backgroundNote.value = "";
    noteTimer = null;
  }, 2800);
}

async function chooseShell(event: Event): Promise<void> {
  const id = (event.target as HTMLSelectElement).value;
  shellChoice.value = "";
  (event.target as HTMLSelectElement).value = "";
  if (id === "settings") { openSettingsModal("terminal"); return; }
  if (id) {
    await terminal.startPty(ptySize.value.cols, ptySize.value.rows, id);
    focusTerminal();
  }
}

async function startTerminal(): Promise<void> {
  if (terminal.supportsPty) {
    await terminal.startPty(ptySize.value.cols, ptySize.value.rows);
    focusTerminal();
    return;
  }
  await terminal.startShell();
  focusInput();
}

function clearActiveOutput(): void {
  if (!task.value || pty.value) return;
  terminal.clearOutput(task.value.id);
  if (secret.value) state.input = "";
  secret.value = false;
  scrollLatest(true);
}

function onInputKey(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "l") {
    event.preventDefault();
    clearActiveOutput();
    return;
  }
  if (mod && event.key.toLowerCase() === "c") {
    // 输入框或输出区有选中文本时让浏览器执行复制；没有选中时按终端的
    // 习惯先清空草稿，草稿为空则停止当前任务。
    const selected = window.getSelection()?.toString() ?? "";
    const input = inputEl.value;
    const inputSelected = Boolean(input && input.selectionStart !== input.selectionEnd);
    if (selected || inputSelected) return;
    event.preventDefault();
    if (state.input) {
      state.input = "";
      return;
    }
    // 后台命令输入框里的 Ctrl+C 只清空草稿；结束终端用终端自己的 Ctrl+C。
    if (isRunning.value && task.value && !pty.value) void terminal.stop(task.value.id);
    return;
  }
  if (mod && event.key.toLowerCase() === "u") {
    event.preventDefault();
    state.input = "";
    return;
  }
  if (event.key === "Enter" && mod && interactiveRunning.value) {
    event.preventDefault();
    submitBackground();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === "ArrowUp" && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    terminal.historyUp();
    nextTick(() => inputEl.value?.setSelectionRange(state.input.length, state.input.length));
    return;
  }
  if (event.key === "ArrowDown" && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    terminal.historyDown();
    nextTick(() => inputEl.value?.setSelectionRange(state.input.length, state.input.length));
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.input) state.input = "";
    else terminal.hide();
  }
}

function useExample(command: string): void {
  state.input = command;
  focusInput();
}

function selectTask(id: string): void {
  terminal.select(id);
  stick.value = true;
  void nextTick(() => {
    if (pty.value) focusTerminal();
    else scrollLatest(true);
  });
}

function onTaskSelect(event: Event): void {
  selectTask((event.target as HTMLSelectElement).value);
}

function rerun(item: TerminalTask): void {
  state.input = item.command;
  terminal.select(item.id);
  focusInput();
}

async function copyOutput(): Promise<void> {
  if (!task.value?.output || pty.value) return;
  try {
    await navigator.clipboard.writeText(terminalPlainText(task.value.output));
    markCopied();
  } catch {
    // 剪贴板权限被拒绝时不打断终端使用。
  }
}

function revealCwd(target = cwd.value): void {
  if (target) void window.piDesktop?.reveal(target);
}

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizing.value = true;
  resizeStartY = event.clientY;
  resizeStartHeight = state.height;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
  event.preventDefault();
}

function onResizeMove(event: PointerEvent): void {
  if (!resizing.value) return;
  terminal.setHeight(resizeStartHeight + (resizeStartY - event.clientY));
}

function stopResize(): void {
  if (!resizing.value) return;
  resizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
}

function onResizeKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    terminal.setHeight(state.height + step);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    terminal.setHeight(state.height - step);
  }
}

watch(
  () => (task.value?.pty ? "" : task.value?.output),
  () => {
    if (pty.value) return;
    // 只跟随后台任务的日志；PTY 屏幕由自身缓冲区管理滚动。
    if (stick.value) scrollLatest(true);
    detectPasswordPrompt();
  },
);
watch(
  () => state.tasks.length,
  () => void nextTick(updateTabsOverflow),
);
watch(
  () => task.value?.id,
  () => {
    if (secret.value) state.input = "";
    secret.value = false;
    copied.value = false;
    backgroundNote.value = "";
    stick.value = true;
    void nextTick(() => {
      revealActiveTab();
      if (!pty.value) {
        detectPasswordPrompt();
        scrollLatest(true);
      }
    });
  },
);
watch(interactiveRunning, (running) => {
  if (!running) {
    if (secret.value) state.input = "";
    secret.value = false;
  }
});
watch(
  () => state.open,
  (open) => {
    if (!open) return;
    void terminal.refreshProfiles();
    focusTerminal();
    void nextTick(revealActiveTab);
    if (!pty.value) scrollLatest(true);
  },
);

onDeactivated(stopResize);
let tabsObserver: ResizeObserver | null = null;
onBeforeUnmount(() => {
  stopResize();
  tabsObserver?.disconnect();
  tabsObserver = null;
  if (copyTimer) clearTimeout(copyTimer);
  if (noteTimer) clearTimeout(noteTimer);
});
onMounted(() => {
  if (state.open) focusTerminal();
  void nextTick(() => detectPasswordPrompt());
  scrollLatest(true);
  if (typeof ResizeObserver === "function") {
    tabsObserver = new ResizeObserver(updateTabsOverflow);
    void nextTick(() => {
      if (tabsEl.value) tabsObserver?.observe(tabsEl.value);
      updateTabsOverflow();
    });
  }
});
</script>

<template>
  <section
    v-show="state.open && state.enabled"
    class="terminal-dock"
    :class="{ 'is-compact': state.height <= 220 }"
    :style="{ height: `${state.height}px` }"
    aria-label="终端与后台任务"
  >
    <div
      class="terminal-resizer"
      :class="{ dragging: resizing }"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整终端面板高度"
      :aria-valuemin="160"
      :aria-valuemax="640"
      :aria-valuenow="state.height"
      tabindex="0"
      title="拖动调整终端高度，双击恢复默认"
      @pointerdown="startResize"
      @keydown="onResizeKey"
      @dblclick="terminal.setHeight(280)"
    />

    <header class="terminal-head">
      <div class="terminal-head-title">
        <span class="terminal-head-icon" aria-hidden="true" v-html="icons.terminal" />
        <strong>终端</strong>
        <span v-if="terminal.runningCount.value" class="terminal-running-pill">
          <span class="terminal-status-dot" data-status="running" />
          {{ terminal.runningCount.value }} 运行中
        </span>
        <span v-else class="terminal-idle-pill">{{ tasks.length ? `${tasks.length} 个任务` : composerCwdLabel }}</span>
      </div>
      <div class="terminal-head-actions">
        <div v-if="canStartTerminal" class="terminal-create-group">
          <button
            class="terminal-create-btn"
            type="button"
            :title="`${startLabel} · ${terminal.defaultProfile.value}`"
            :aria-label="startLabel"
            :disabled="state.starting || !cwd"
            @click="startTerminal"
          >
            <span aria-hidden="true" v-html="icons.plus" />
            <span class="terminal-create-label">新建终端</span>
          </button>
          <div v-if="terminal.supportsPty" class="terminal-profile-picker">
            <span aria-hidden="true" v-html="icons.chevronDown" />
            <select
              class="terminal-profile-select"
              :value="shellChoice"
              :disabled="state.starting || !cwd"
              aria-label="选择 shell 新建终端"
              title="选择其他 shell 新建终端，不修改默认配置"
              @pointerdown="terminal.refreshProfiles()"
              @change="chooseShell"
            >
              <option value="" disabled>选择 shell 新建终端</option>
              <option v-for="profile in state.profiles" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
              <option v-if="appSettings.terminalCustomPath" value="custom">自定义终端</option>
              <option value="settings">终端设置…</option>
            </select>
          </div>
        </div>
        <button
          v-if="finishedCount"
          class="icon-btn terminal-clear-finished"
          type="button"
          title="清理所有已结束的任务（不停止运行中的会话）"
          aria-label="清理已结束的任务"
          @click="terminal.clearFinished()"
          v-html="icons.trash"
        />
        <span class="terminal-toolbar-divider" aria-hidden="true" />
        <button class="icon-btn" type="button" title="终端设置" aria-label="终端设置" @click="openSettingsModal('terminal')" v-html="icons.gear" />
        <button class="icon-btn" type="button" title="收起终端 (Ctrl/Cmd+`)" aria-label="收起终端" @click="terminal.hide()" v-html="icons.minus" />
      </div>
    </header>

    <nav v-if="tasks.length" class="terminal-navigation" aria-label="终端与后台任务导航">
      <div ref="tabsEl" role="tablist" aria-label="终端与后台任务标签" class="terminal-tabs" :class="{ 'fade-start': tabsOverflow && !tabsAtStart, 'fade-end': tabsOverflow && !tabsAtEnd }" @keydown="onTabKey" @wheel="onTabsWheel" @scroll.passive="onTabsScroll">
        <template v-for="group in taskGroups" :key="group.key">
          <div v-if="group.items.length" class="terminal-tab-group">
            <span class="terminal-tab-group-label">{{ group.label }} <small>{{ group.items.length }}</small></span>
            <div
              v-for="item in group.items"
              :key="item.id"
              class="terminal-tab"
              :class="{ active: item.id === task?.id }"
            >
              <button
                class="terminal-tab-main"
                :data-task-id="item.id"
                role="tab"
                type="button"
                :aria-selected="item.id === task?.id"
                :title="taskTitle(item)"
                @click="selectTask(item.id)"
              >
                <span class="terminal-tab-icon" aria-hidden="true" v-html="item.pty ? icons.terminal : icons.code" />
                <span class="terminal-tab-label">{{ taskLabel(item) }}</span>
                <span class="terminal-status-dot" :data-status="item.status" />
              </button>
              <button
                class="terminal-tab-close"
                type="button"
                :title="closeTitle(item)"
                :aria-label="`${item.status === 'running' || item.status === 'stopping' ? '结束并关闭' : '关闭'} ${taskLabel(item)}`"
                @click.stop="closeTask(item)"
                v-html="icons.close"
              />
            </div>
          </div>
        </template>
      </div>
      <div v-if="tabsOverflow" class="terminal-all-tasks" title="任务过多，打开下拉列表切换">
        <span aria-hidden="true" v-html="icons.chevronDown" />
        <span>全部</span>
        <select class="terminal-task-select" :value="task?.id ?? ''" aria-label="从全部任务中切换" @change="onTaskSelect">
          <optgroup v-for="group in taskGroups.filter(g => g.items.length)" :key="group.key" :label="group.label">
            <option v-for="item in group.items" :key="item.id" :value="item.id">{{ taskLabel(item) }} · {{ TERMINAL_STATUS_LABEL[item.status] }}</option>
          </optgroup>
        </select>
      </div>
    </nav>

    <div class="terminal-body">
      <section class="terminal-output" aria-label="当前任务输出">
        <template v-if="task">
          <div class="terminal-output-head">
            <div class="terminal-output-meta">
              <span class="terminal-output-state" :data-status="task.status">{{ statusLabel }}</span>
              <span class="terminal-output-elapsed">{{ elapsed(task) }}</span>
              <span class="terminal-output-context" :title="`${task.shell} · ${task.cwd}`">{{ task.shell }} · {{ displayProjectName(task.cwd) }}</span>
              <span v-if="task.exitCode != null && task.status !== 'stopped'" class="terminal-output-exit" :data-ok="task.exitCode === 0">退出码 {{ task.exitCode }}</span>
            </div>
            <div class="terminal-output-actions">
              <template v-if="!pty">
                <button class="icon-btn small" :class="{ 'is-on': wrap }" type="button" :title="wrap ? '关闭自动换行' : '自动换行'" aria-label="自动换行" :aria-pressed="wrap" @click="toggleWrap" v-html="icons.wrap" />
                <button class="icon-btn small" type="button" :title="copied ? '已复制' : '复制全部输出'" aria-label="复制全部输出" :disabled="!task.output" @click="copyOutput" v-html="copied ? icons.check : icons.copy" />
                <button class="icon-btn small" type="button" title="清空输出 (Ctrl/Cmd+L)" aria-label="清空输出" :disabled="!task.output" @click="clearActiveOutput" v-html="icons.trash" />
                <button v-if="!interactive" class="icon-btn small" type="button" title="重新填入命令" aria-label="重新填入命令" @click="rerun(task)" v-html="icons.refresh" />
              </template>
              <button class="icon-btn small terminal-reveal-task" type="button" title="在文件管理器中打开任务目录" aria-label="打开任务目录" @click="revealCwd(task.cwd)" v-html="icons.reveal" />
              <button v-if="isRunning && !pty" class="terminal-stop-btn" type="button" :disabled="task.status === 'stopping'" title="停止此后台任务的进程树" @click="terminal.stop(task.id)">
                <span aria-hidden="true" v-html="icons.stop" />
                {{ task.status === 'stopping' ? '停止中' : stopLabel }}
              </button>
            </div>
          </div>
          <div class="terminal-stage">
            <div v-show="pty" class="terminal-pty-screens">
              <PtyTerminal
                v-for="item in ptyTasks"
                v-show="item.id === task.id"
                :key="item.id"
                :ref="(screen) => setPtyScreen(item.id, screen)"
                :task="item"
                :active="state.enabled && state.open && item.id === task.id"
                @copied="markCopied"
                @size="ptySize = $event"
              />
            </div>
            <div v-if="!pty" ref="outputEl" class="terminal-output-scroll" :class="{ 'is-nowrap': !wrap }" @scroll.passive="onOutputScroll">
              <div class="terminal-command-line">
                <span class="terminal-command-prompt" aria-hidden="true">$</span>
                <span class="terminal-command-text">{{ task.interactive ? '交互式会话' : task.command }}</span>
              </div>
              <div v-if="!task.output" class="terminal-output-placeholder">
                {{ isRunning ? (task.interactive ? '会话已启动，输入命令开始…' : '等待命令输出…') : '这个任务没有输出。' }}
                <span v-if="isRunning" class="terminal-cursor" aria-hidden="true" />
              </div>
              <pre v-else class="terminal-output-text" v-html="outputHtml" />
              <div v-if="task.truncated" class="terminal-output-truncated">输出过长，仅保留最近部分内容。</div>
            </div>
            <button v-if="!pty && !stick" class="terminal-jump" type="button" @click="scrollLatest(true)">回到最新 <span aria-hidden="true">↓</span></button>
          </div>
        </template>

        <div v-else class="terminal-empty">
          <div class="terminal-empty-inner">
            <div class="terminal-empty-heading">
              <strong>你的本地命令工作台</strong>
              <span>独立运行，不打断对话</span>
            </div>
            <div class="terminal-launchers">
              <button class="terminal-launcher" type="button" :disabled="!canStartTerminal || state.starting || !cwd" @click="startTerminal">
                <span class="terminal-launcher-icon" aria-hidden="true" v-html="icons.terminal" />
                <span class="terminal-launcher-copy">
                  <strong>交互终端 <small>{{ terminal.defaultProfile.value }}</small></strong>
                  <span>运行 Pi、Claude Code、Codex、vim 等交互程序</span>
                </span>
                <span class="terminal-launcher-action">新建 <span aria-hidden="true" v-html="icons.plus" /></span>
              </button>
              <button class="terminal-launcher command" type="button" :disabled="!terminal.available || !cwd" @click="focusInput">
                <span class="terminal-launcher-icon" aria-hidden="true" v-html="icons.code" />
                <span class="terminal-launcher-copy">
                  <strong>后台命令 <small>一次一条 · 独立任务</small></strong>
                  <span>在下方输入构建、测试、开发服务器等命令</span>
                </span>
                <span class="terminal-launcher-action">输入 <span aria-hidden="true" v-html="icons.chevronRight" /></span>
              </button>
            </div>
            <div class="terminal-quick">
              <div class="terminal-quick-head"><span>{{ state.history.length ? '最近命令' : '试试这些命令' }}</span><span>点击填入，Enter 运行</span></div>
              <div class="terminal-quick-grid">
                <button v-for="item in quickCommands" :key="item.command" class="terminal-quick-item" type="button" :title="`${item.command} · ${item.label}`" :disabled="!terminal.available || !cwd" @click="useExample(item.command)">
                  <span aria-hidden="true" v-html="item.recent ? icons.history : icons.code" /><code>{{ item.command }}</code>
                </button>
              </div>
            </div>
            <p v-if="!terminal.available || !cwd" class="terminal-empty-warning">{{ !terminal.available ? '终端功能仅在桌面端可用。' : '先打开一个项目目录，再运行命令。' }}</p>
          </div>
        </div>
      </section>
    </div>

    <footer class="terminal-composer" :class="{ 'is-terminal': pty }">
      <div class="terminal-input-row">
        <span class="terminal-input-mode" :title="legacyInteractive ? '输入发送到当前交互会话' : '在当前项目启动独立后台任务，不发送到 PTY'">{{ legacyInteractive ? '会话输入' : '后台命令' }}</span>
        <span class="terminal-prompt" aria-hidden="true">$</span>
        <input ref="inputEl" v-model="state.input" class="terminal-input" :type="secret && !pty ? 'password' : 'text'" spellcheck="false" autocomplete="off" autocapitalize="off" :placeholder="inputPlaceholder" :aria-label="pty ? '后台命令' : secret ? '密码输入' : '终端命令'" :disabled="!terminal.available" @keydown="onInputKey" />
        <select v-if="state.history.length && !secret && !legacyInteractive" class="terminal-history-select" value="" aria-label="填入最近后台命令" title="最近后台命令（选择后填入，不直接执行）" @change="fillHistory">
          <option value="" disabled>历史</option>
          <option v-for="command in state.history" :key="command" :value="command">{{ command }}</option>
        </select>
        <button v-if="interactiveRunning && !pty" class="icon-btn small terminal-secret" :class="{ 'is-on': secret }" type="button" :title="secret ? '显示输入' : '隐藏输入（用于密码）'" :aria-pressed="secret" @click="secret = !secret" v-html="secret ? icons.eyeOff : icons.eye" />
        <button class="terminal-run-btn" type="button" :disabled="!terminal.available || !cwd || state.starting || (!(shellEnded && !pty) && !state.input.trim())" @click="submit">
          {{ state.starting ? '启动中…' : runLabel }}
          <span class="terminal-run-key" aria-hidden="true">↵</span>
        </button>
        <button v-if="pty && !ptyRunning" class="terminal-new-inline" type="button" :disabled="state.starting || !cwd" @click="startTerminal">新建终端</button>
      </div>
      <div class="terminal-composer-meta">
        <button class="terminal-cwd" type="button" :title="composerCwd ? `命令启动目录：${composerCwd}；点击在文件管理器中打开` : '未打开项目'" @click="revealCwd(composerCwd)">
          <span aria-hidden="true" v-html="icons.folder" />
          <span>{{ composerCwdLabel }}</span>
        </button>
        <span class="terminal-footer-hint" :class="{ 'is-note': backgroundNote }" :title="footerHint" role="status">{{ footerHint }}</span>
      </div>
    </footer>
  </section>
</template>
