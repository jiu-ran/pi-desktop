<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { TERMINAL_STATUS_LABEL, formatTerminalDuration, type TerminalTask } from "../../services/terminal.ts";
import { baseName, displayProjectName, icons } from "../../shared/util.ts";

const { workbench, terminal } = useKernel();
const state = terminal.state;
const task = terminal.activeTask;
const tasks = terminal.sortedTasks;

const inputEl = ref<HTMLInputElement | null>(null);
const outputEl = ref<HTMLElement | null>(null);
const stick = ref(true);
const resizing = ref(false);
const copied = ref(false);

const cwd = computed(() => workbench.state.activeCwd);
const cwdLabel = computed(() => displayProjectName(cwd.value) || "未打开项目");
const statusLabel = computed(() => task.value ? TERMINAL_STATUS_LABEL[task.value.status] : "");
const isRunning = computed(() => task.value?.status === "running" || task.value?.status === "stopping");
const finishedCount = computed(() => state.tasks.filter((item) => item.status !== "running" && item.status !== "stopping").length);

const examples = ["npm run dev", "npm test", "git status"];

let resizeStartY = 0;
let resizeStartHeight = 0;

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

function submit(): void {
  const command = state.input.trim();
  if (!command || state.starting) return;
  void terminal.run(command);
}

function onInputKey(event: KeyboardEvent): void {
  if (event.isComposing) return;
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
    terminal.hide();
  }
}

function useExample(command: string): void {
  state.input = command;
  focusInput();
}

function selectTask(id: string): void {
  terminal.select(id);
  stick.value = true;
  scrollLatest(true);
}

function rerun(item: TerminalTask): void {
  state.input = item.command;
  terminal.select(item.id);
  focusInput();
}

async function copyOutput(): Promise<void> {
  if (!task.value?.output) return;
  try {
    await navigator.clipboard.writeText(task.value.output);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1200);
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

watch(() => task.value?.output, () => scrollLatest());
watch(() => task.value?.id, () => {
  stick.value = true;
  void nextTick(() => scrollLatest(true));
});
watch(() => state.open, (open) => {
  if (!open) return;
  void nextTick(() => {
    focusInput();
    scrollLatest(true);
  });
});
watch(() => state.activeId, () => {
  stick.value = true;
  void nextTick(() => scrollLatest(true));
});

onBeforeUnmount(stopResize);
onMounted(() => {
  focusInput();
  scrollLatest(true);
});
</script>

<template>
  <section
    v-if="state.open"
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
        <strong>终端与后台任务</strong>
        <span v-if="terminal.runningCount.value" class="terminal-running-pill">
          {{ terminal.runningCount.value }} 个运行中
        </span>
        <span v-else-if="tasks.length" class="terminal-idle-pill">{{ tasks.length }} 个任务</span>
      </div>
      <div class="terminal-head-actions">
        <button
          class="terminal-head-btn"
          type="button"
          title="清理已结束的任务"
          :disabled="!finishedCount"
          @click="terminal.clearFinished()"
        >
          清理已结束
        </button>
        <button class="icon-btn" type="button" title="收起终端 (Ctrl/Cmd+`)" @click="terminal.hide()" v-html="icons.close" />
      </div>
    </header>

    <div class="terminal-body">
      <aside class="terminal-tasks" aria-label="后台任务列表">
        <div class="terminal-tasks-head">
          <span>任务</span>
          <span class="terminal-tasks-count">{{ tasks.length }}</span>
        </div>
        <div v-if="tasks.length" class="terminal-task-list">
          <button
            v-for="item in tasks"
            :key="item.id"
            class="terminal-task"
            :class="{ active: item.id === task?.id }"
            :aria-pressed="item.id === task?.id"
            type="button"
            :title="`${item.command}\n${item.cwd}`"
            @click="selectTask(item.id)"
          >
            <span class="terminal-task-dot" :data-status="statusClass(item)" />
            <span class="terminal-task-main">
              <span class="terminal-task-command">{{ item.command }}</span>
              <span class="terminal-task-meta">
                <span>{{ TERMINAL_STATUS_LABEL[item.status] }}</span>
                <span>·</span>
                <span>{{ elapsed(item) }}</span>
                <span v-if="item.cwd !== cwd" class="terminal-task-cwd">· {{ taskCwd(item) }}</span>
              </span>
            </span>
          </button>
        </div>
        <div v-else class="terminal-tasks-empty">还没有后台任务</div>
      </aside>

      <section class="terminal-output">
        <template v-if="task">
          <div class="terminal-output-head">
            <div class="terminal-output-meta">
              <span class="terminal-status-dot" :data-status="task.status" />
              <span class="terminal-output-state">{{ statusLabel }}</span>
              <span class="terminal-output-divider">·</span>
              <code class="terminal-output-command" :title="task.command">{{ task.command }}</code>
              <span v-if="task.exitCode != null" class="terminal-output-exit" :data-ok="task.exitCode === 0">
                退出码 {{ task.exitCode }}
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
                {{ task.status === "stopping" ? "停止中" : "停止" }}
              </button>
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
                title="清空当前任务输出"
                :disabled="!task.output"
                @click="terminal.clearOutput(task.id)"
                v-html="icons.trash"
              />
              <button
                class="icon-btn small"
                type="button"
                title="重新填入命令"
                @click="rerun(task)"
                v-html="icons.refresh"
              />
              <button class="icon-btn small" type="button" title="在文件管理器中打开任务目录" @click="revealCwd(task.cwd)" v-html="icons.reveal" />
            </div>
          </div>
          <div ref="outputEl" class="terminal-output-scroll" @scroll.passive="onOutputScroll">
            <div v-if="!task.output" class="terminal-output-placeholder">
              {{ isRunning ? "等待命令输出…" : "这个任务没有输出。" }}
            </div>
            <pre v-else class="terminal-output-text">{{ task.output }}</pre>
            <div v-if="task.truncated" class="terminal-output-truncated">输出过长，仅保留最近部分内容。</div>
          </div>
          <footer class="terminal-output-footer">
            <span class="terminal-task-cwd" :title="task.cwd">{{ task.shell }} · {{ task.cwd }}</span>
            <span>{{ elapsed(task) }}</span>
          </footer>
        </template>

        <div v-else class="terminal-empty">
          <span class="terminal-empty-icon" v-html="icons.terminal" />
          <strong>运行命令，查看后台任务</strong>
          <p v-if="terminal.available">构建、开发服务器或测试都可以在这里后台运行，不会阻塞对话。</p>
          <p v-else>终端功能仅在桌面端可用。</p>
          <div class="terminal-sample-row">
            <button v-for="sample in examples" :key="sample" class="terminal-sample" type="button" @click="useExample(sample)">
              {{ sample }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <footer class="terminal-composer">
      <div class="terminal-input-row">
        <span class="terminal-prompt" aria-hidden="true">❯</span>
        <input
          ref="inputEl"
          v-model="state.input"
          class="terminal-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          placeholder="输入命令，Enter 运行；↑ ↓ 查看历史"
          aria-label="终端命令"
          :disabled="!terminal.available"
          @keydown="onInputKey"
        />
        <button
          class="terminal-run-btn"
          type="button"
          :disabled="!terminal.available || !state.input.trim() || state.starting"
          @click="submit"
        >
          {{ state.starting ? "启动中…" : "运行" }}
        </button>
        <button
          v-if="isRunning"
          class="terminal-input-stop"
          type="button"
          :disabled="task?.status === 'stopping'"
          @click="task && terminal.stop(task.id)"
        >
          停止
        </button>
      </div>
      <div class="terminal-composer-meta">
        <button class="terminal-cwd" type="button" :title="cwd ? `在文件管理器中打开 ${cwd}` : '未打开项目'" @click="revealCwd()">
          <span class="terminal-cwd-icon" v-html="icons.folder" />
          {{ cwdLabel }}
        </button>
        <span>Enter 运行 · ↑↓ 历史 · Ctrl/Cmd+` 收起 · 不支持交互式输入</span>
      </div>
    </footer>
  </section>
</template>
