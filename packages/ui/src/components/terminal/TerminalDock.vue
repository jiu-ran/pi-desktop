<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import PtyTerminal from "./PtyTerminal.vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { TERMINAL_STATUS_LABEL, formatTerminalDuration, type TerminalTask } from "../../services/terminal.ts";
import { renderTerminalHtml, stripTerminalAnsi, terminalPlainText } from "../../shared/terminal-text.ts";
import { appSettings, openSettingsModal } from "../../services/settings.ts";
import { baseName, displayProjectName, icons } from "../../shared/util.ts";

const { workbench, terminal } = useKernel();
const state = terminal.state;
const task = terminal.activeTask;
const tasks = terminal.sortedTasks;

const inputEl = ref<HTMLInputElement | null>(null);
const outputEl = ref<HTMLElement | null>(null);
const ptySize = ref({ cols: 100, rows: 30 });
interface PtyScreen { focus: () => void; copySelection: () => Promise<boolean>; paste: () => Promise<void> }
const ptyScreens = new Map<string, PtyScreen>();
const stick = ref(true);
const resizing = ref(false);
const copied = ref(false);
const selection = ref("");
const wrap = ref(loadWrap());
const secret = ref(false);
const shellChoice = ref("");
const backgroundNote = ref("");

const cwd = computed(() => workbench.state.activeCwd);
const composerCwd = computed(() => (interactive.value && task.value ? task.value.cwd : cwd.value));
const composerCwdLabel = computed(() => displayProjectName(composerCwd.value) || "未打开项目");
const statusLabel = computed(() => (task.value ? TERMINAL_STATUS_LABEL[task.value.status] : ""));
const isRunning = computed(() => task.value?.status === "running" || task.value?.status === "stopping");
const interactive = computed(() => Boolean(task.value?.interactive));
const pty = computed(() => Boolean(task.value?.pty));
const ptyTasks = computed(() => state.tasks.filter((item) => item.pty));
const terminalTasks = computed(() => tasks.value.filter((item) => item.pty));
const commandTasks = computed(() => tasks.value.filter((item) => !item.pty));
// 同时存在长驻终端和一次性命令时分组显示，避免两类型任务混在一起。
const taskGroups = computed(() => {
  const grouped = terminalTasks.value.length > 0 && commandTasks.value.length > 0;
  return [
    { key: "pty", label: grouped ? "终端" : "", items: terminalTasks.value },
    { key: "command", label: grouped ? "后台命令" : "", items: commandTasks.value },
  ];
});
const legacyInteractive = computed(() => interactive.value && !pty.value);
const ptyRunning = computed(() => pty.value && isRunning.value);
const interactiveRunning = computed(() => interactive.value && isRunning.value);
const shellEnded = computed(() => interactive.value && !isRunning.value);
const canStartTerminal = computed(() => terminal.supportsPty || terminal.supportsShell);
const startLabel = computed(() => (terminal.supportsPty ? "新建终端" : "新建交互会话"));
const finishedCount = computed(() => state.tasks.filter((item) => item.status !== "running" && item.status !== "stopping").length);
const outputHtml = computed(() => (task.value && !task.value.pty ? renderTerminalHtml(task.value.output) : ""));
const inputPlaceholder = computed(() => {
  if (pty.value) return "在后台运行一次性命令，Enter 运行；不会发送到当前终端";
  if (shellEnded.value) return "会话已结束，点击“新建会话”继续";
  if (secret.value) return "输入密码，Enter 发送";
  if (interactiveRunning.value) return "输入命令或 SQL，Enter 发送；Ctrl+Enter 后台运行";
  return "输入命令，Enter 运行；↑ ↓ 查看历史";
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
      ? "上方终端直接输入 · 下方 Enter 后台运行 · ↑↓ 历史"
      : "终端已结束 · 下方 Enter 后台运行 · ↑↓ 历史";
  }
  if (interactiveRunning.value) return "交互会话 · Enter 发送 · Ctrl+Enter 后台运行 · Ctrl+L 清屏";
  return "Enter 运行 · ↑↓ 历史 · Ctrl+C 停止 · Ctrl+L 清屏 · Ctrl/Cmd+` 收起";
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

function taskCwd(item: TerminalTask): string {
  return displayProjectName(item.cwd) || baseName(item.cwd);
}

function statusClass(item: TerminalTask): string {
  return item.status;
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

function onPtySelection(id: string, text: string): void {
  if (id === task.value?.id) selection.value = text;
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

async function copySelection(): Promise<void> {
  await ptyScreens.get(task.value?.id || "")?.copySelection();
}

function pasteTerminal(): void {
  void ptyScreens.get(task.value?.id || "")?.paste();
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
  () => task.value?.id,
  () => {
    if (secret.value) state.input = "";
    secret.value = false;
    selection.value = "";
    copied.value = false;
    backgroundNote.value = "";
    stick.value = true;
    void nextTick(() => {
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
    if (!pty.value) scrollLatest(true);
  },
);

onDeactivated(stopResize);
onBeforeUnmount(() => {
  stopResize();
  if (copyTimer) clearTimeout(copyTimer);
  if (noteTimer) clearTimeout(noteTimer);
});
onMounted(() => {
  if (state.open) focusTerminal();
  void nextTick(() => detectPasswordPrompt());
  scrollLatest(true);
});
</script>

<template>
  <section
    v-show="state.open && state.enabled"
    class="terminal-dock"
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
        <span class="terminal-head-icon" v-html="icons.terminal" />
        <strong>终端</strong>
        <span v-if="terminal.runningCount.value" class="terminal-running-pill">
          {{ terminal.runningCount.value }} 个运行中
        </span>
        <span v-else-if="tasks.length" class="terminal-idle-pill">{{ tasks.length }} 个任务</span>
        <select
          v-if="tasks.length"
          class="terminal-task-select"
          :value="task?.id ?? ''"
          aria-label="切换后台任务"
          @change="onTaskSelect"
        >
          <option v-for="item in tasks" :key="item.id" :value="item.id">
            {{ item.pty ? "终端 · " : "" }}{{ item.command }}
          </option>
        </select>
      </div>
      <div class="terminal-head-actions">
        <button
          v-if="canStartTerminal"
          class="icon-btn"
          type="button"
          :title="terminal.supportsPty ? `新建终端 · ${terminal.defaultProfile.value}` : '新建交互会话'"
          :aria-label="startLabel"
          :disabled="state.starting"
          @click="startTerminal"
          v-html="icons.plus"
        />
        <select
          v-if="terminal.supportsPty"
          class="terminal-profile-select"
          :value="shellChoice"
          :disabled="state.starting"
          aria-label="选择 shell 新建终端"
          title="临时使用其他 shell 新建终端；不修改默认配置"
          @pointerdown="terminal.refreshProfiles()"
          @change="chooseShell"
        >
          <option value="" disabled>其他 shell…</option>
          <option v-for="profile in state.profiles" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
          <option v-if="appSettings.terminalCustomPath" value="custom">自定义终端</option>
          <option value="settings">终端设置…</option>
        </select>
        <button class="icon-btn" type="button" title="终端设置" @click="openSettingsModal('terminal')" v-html="icons.gear" />
        <button
          v-if="finishedCount"
          class="terminal-head-btn"
          type="button"
          title="清理已结束的任务"
          @click="terminal.clearFinished()"
        >
          清理已结束
        </button>
        <button class="icon-btn" type="button" title="收起终端 (Ctrl/Cmd+`)" @click="terminal.hide()" v-html="icons.close" />
      </div>
    </header>

    <div class="terminal-body">
      <aside v-if="tasks.length" class="terminal-tasks" aria-label="后台任务列表">
        <div class="terminal-tasks-head">
          <span>任务</span>
          <span class="terminal-tasks-count">{{ tasks.length }}</span>
        </div>
        <div class="terminal-task-list">
          <template v-for="group in taskGroups" :key="group.key">
            <div v-if="group.label" class="terminal-task-group">
              <span>{{ group.label }}</span>
              <span>{{ group.items.length }}</span>
            </div>
            <button
              v-for="item in group.items"
              :key="item.id"
              class="terminal-task"
              :class="{ active: item.id === task?.id }"
              :aria-pressed="item.id === task?.id"
              type="button"
              :title="`${item.command}
${item.cwd}`"
              @click="selectTask(item.id)"
            >
              <span class="terminal-task-dot" :data-status="statusClass(item)" />
              <span class="terminal-task-main">
                <span class="terminal-task-command">
                  <span v-if="item.interactive" class="terminal-task-kind">{{ item.pty ? "终端" : "会话" }}</span>
                  {{ item.command }}
                </span>
                <span class="terminal-task-meta">
                  <span>{{ TERMINAL_STATUS_LABEL[item.status] }}</span>
                  <span>·</span>
                  <span>{{ elapsed(item) }}</span>
                  <span v-if="item.cwd !== cwd" class="terminal-task-cwd">· {{ taskCwd(item) }}</span>
                </span>
              </span>
            </button>
          </template>
        </div>
      </aside>

      <section class="terminal-output">
        <template v-if="task">
          <div class="terminal-output-head">
            <div class="terminal-output-meta">
              <span class="terminal-status-dot" :data-status="task.status" />
              <span class="terminal-output-state">{{ statusLabel }}</span>
              <span class="terminal-output-elapsed">{{ elapsed(task) }}</span>
              <span v-if="task.exitCode != null && task.status !== 'stopped'" class="terminal-output-exit" :data-ok="task.exitCode === 0">
                退出 {{ task.exitCode }}
              </span>
            </div>
            <div class="terminal-output-actions">
              <button
                v-if="isRunning"
                class="terminal-stop-btn"
                type="button"
                :disabled="task.status === 'stopping'"
                @click="terminal.stop(task.id)"
              >
                <span v-html="icons.stop" />
                {{ task.status === "stopping" ? "停止中" : stopLabel }}
              </button>
              <button
                v-if="pty"
                class="icon-btn small"
                type="button"
                :title="copied ? '已复制' : '复制选中内容'"
                :disabled="!selection"
                @click="copySelection"
                v-html="copied ? icons.check : icons.copy"
              />
              <button
                v-if="pty"
                class="terminal-head-btn"
                type="button"
                title="粘贴到终端 (Ctrl+Shift+V)"
                :disabled="!ptyRunning"
                @click="pasteTerminal"
              >粘贴</button>
              <template v-if="!pty">
                <button
                  class="icon-btn small"
                  :class="{ 'is-on': wrap }"
                  type="button"
                  :title="wrap ? '关闭自动换行' : '自动换行'"
                  :aria-pressed="wrap"
                  @click="toggleWrap"
                  v-html="icons.wrap"
                />
                <button
                  class="icon-btn small"
                  type="button"
                  :title="copied ? '已复制' : '复制全部输出'"
                  :disabled="!task.output"
                  @click="copyOutput"
                  v-html="copied ? icons.check : icons.copy"
                />
                <button
                  class="icon-btn small"
                  type="button"
                  title="清屏 (Ctrl/Cmd+L)"
                  :disabled="!task.output"
                  @click="clearActiveOutput"
                  v-html="icons.trash"
                />
                <button
                  v-if="!interactive"
                  class="icon-btn small"
                  type="button"
                  title="重新填入命令"
                  @click="rerun(task)"
                  v-html="icons.refresh"
                />
              </template>
              <button class="icon-btn small" type="button" title="在文件管理器中打开任务目录" @click="revealCwd(task.cwd)" v-html="icons.reveal" />
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
                @selection="onPtySelection(item.id, $event)"
                @copied="markCopied"
                @size="ptySize = $event"
              />
            </div>
            <div
              v-if="!pty"
              ref="outputEl"
              class="terminal-output-scroll"
              :class="{ 'is-nowrap': !wrap }"
              @scroll.passive="onOutputScroll"
            >
              <div class="terminal-command-line">
                <span class="terminal-command-prompt" aria-hidden="true">❯</span>
                <span class="terminal-command-text" :title="task.interactive ? `${task.shell} · ${task.cwd}` : task.command">
                  {{ task.interactive ? (task.pty ? "终端" : "交互式会话") : task.command }}
                </span>
                <span class="terminal-command-meta">{{ task.shell }} · {{ task.cwd }}</span>
              </div>
              <div v-if="!task.output" class="terminal-output-placeholder">
                {{ isRunning ? (task.interactive ? "会话已启动，输入命令开始…" : "等待命令输出…") : "这个任务没有输出。" }}
                <span v-if="isRunning" class="terminal-cursor" aria-hidden="true" />
              </div>
              <pre v-else class="terminal-output-text" :class="{ 'is-running': isRunning }" v-html="outputHtml" />
              <div v-if="task.truncated" class="terminal-output-truncated">输出过长，仅保留最近部分内容。</div>
            </div>
            <button v-if="!pty && !stick" class="terminal-jump" type="button" @click="scrollLatest(true)">
              回到最新
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        </template>

        <div v-else class="terminal-empty">
          <div class="terminal-empty-inner">
          <div class="terminal-empty-main">
              <div class="terminal-empty-top">
                <span class="terminal-empty-mark" aria-hidden="true">
                  <span>❯</span>
                  <i />
                </span>
                <div class="terminal-empty-copy">
                  <strong>在项目目录中运行命令</strong>
                  <p v-if="terminal.available">
                    下方输入框运行一次性后台命令；需要 Claude Code、Codex、Pi、vim 等全屏程序时新建终端。
                  </p>
                  <p v-else>终端功能仅在桌面端可用。</p>
                </div>
                <div v-if="terminal.available" class="terminal-empty-actions">
                  <span v-if="terminal.supportsPty" class="terminal-empty-badge">{{ terminal.defaultProfile.value }}</span>
                  <button
                    v-if="canStartTerminal"
                    class="terminal-empty-start"
                    type="button"
                    :disabled="state.starting"
                    @click="startTerminal"
                  >
                    <span v-html="icons.terminal" />
                    {{ startLabel }}
                  </button>
                </div>
              </div>
              <div class="terminal-quick">
                <div class="terminal-quick-head">
                  <span>{{ state.history.length ? "最近命令" : "快速开始" }}</span>
                  <span>点击填入命令</span>
                </div>
                <div class="terminal-quick-grid">
                  <button
                    v-for="item in quickCommands"
                    :key="item.command"
                    class="terminal-quick-item"
                    type="button"
                    :title="item.command"
                    @click="useExample(item.command)"
                  >
                    <span class="terminal-quick-icon" v-html="item.recent ? icons.history : icons.terminal" />
                    <span class="terminal-quick-copy">
                      <code>{{ item.command }}</code>
                      <small>{{ item.label }}</small>
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div class="terminal-empty-foot">
            <span><kbd>Enter</kbd> 运行</span>
            <span><kbd>Ctrl C</kbd> 停止</span>
            <span><kbd>Ctrl L</kbd> 清屏</span>
            <span><kbd>Ctrl `</kbd> 收起</span>
            <span class="terminal-empty-foot-note">命令在项目目录中执行，不阻塞对话。</span>
          </div>
          </div>
        </div>
      </section>
    </div>

    <footer class="terminal-composer" :class="{ 'is-terminal': pty }">
      <div class="terminal-input-row">
        <span class="terminal-prompt" aria-hidden="true">❯</span>
        <input
          ref="inputEl"
          v-model="state.input"
          class="terminal-input"
          :type="secret && !pty ? 'password' : 'text'"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          :placeholder="inputPlaceholder"
          :aria-label="pty ? '后台命令' : secret ? '密码输入' : '终端命令'"
          :disabled="!terminal.available"
          @keydown="onInputKey"
        />
        <button
          v-if="interactiveRunning && !pty"
          class="icon-btn small terminal-secret"
          :class="{ 'is-on': secret }"
          type="button"
          :title="secret ? '显示输入' : '隐藏输入（用于密码）'"
          :aria-pressed="secret"
          @click="secret = !secret"
          v-html="secret ? icons.eyeOff : icons.eye"
        />
        <button
          class="terminal-run-btn"
          type="button"
          :disabled="!terminal.available || state.starting || (!shellEnded && !state.input.trim())"
          @click="submit"
        >
          {{ state.starting ? (pty ? "提交中…" : interactiveRunning ? "发送中…" : "启动中…") : runLabel }}
        </button>
        <button
          v-if="pty && !ptyRunning"
          class="terminal-new-inline"
          type="button"
          :disabled="state.starting"
          @click="startTerminal"
        >
          新建终端
        </button>
        <button
          v-else-if="isRunning && !pty"
          class="terminal-input-stop"
          type="button"
          :disabled="task?.status === 'stopping'"
          @click="task && terminal.stop(task.id)"
        >
          {{ task?.status === "stopping" ? "停止中" : stopLabel }}
        </button>
      </div>
      <div class="terminal-composer-meta">
        <button class="terminal-cwd" type="button" :title="composerCwd ? `在文件管理器中打开 ${composerCwd}` : '未打开项目'" @click="revealCwd(composerCwd)">
          <span class="terminal-cwd-icon" v-html="icons.folder" />
          {{ composerCwdLabel }}
        </button>
        <span class="terminal-footer-hint" :class="{ 'is-note': backgroundNote }" :title="footerHint">{{ footerHint }}</span>
      </div>
    </footer>
  </section>
</template>
