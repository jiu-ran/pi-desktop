<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useKernel } from "../../kernel/use-kernel.ts";
import type { TerminalTask } from "../../services/terminal.ts";
import { pushToast } from "../../services/extension-ui.ts";
import { appSettings } from "../../services/settings.ts";
import { createTerminalWheelHandler } from "../../shared/terminal-wheel.ts";

/**
 * 一个 PTY 会话对应一个独立 xterm 屏幕。
 *
 * 收起面板/切换任务只隐藏屏幕，不重放日志，因此备用屏幕、光标、鼠标模式
 * 和滚动位置都会保留。任务数据与按键始终绑定 task.id，不能发给另一会话。
 */
const props = defineProps<{ task: TerminalTask; active: boolean }>();
const emit = defineEmits<{
  selection: [text: string];
  copied: [];
  size: [size: { cols: number; rows: number }];
}>();
const { terminal, workbench } = useKernel();
const hostEl = ref<HTMLElement | null>(null);
const grid = ref({ cols: props.task.cols || 100, rows: props.task.rows || 30 });
const ready = ref(false);
let screen: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let observer: ResizeObserver | null = null;
let offData: (() => void) | null = null;
let fitTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;
let restoring = false;
let queuedData: string[] = [];

function applyTheme(): void {
  if (!screen) return;
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const theme: ITheme = {
    background: color("--term-bg", "#111214"),
    foreground: color("--term-fg", "#d7dae0"),
    cursor: color("--ansi-bright-green", "#b5e890"),
    cursorAccent: color("--term-bg", "#111214"),
    selectionBackground: color("--accent-soft", "rgba(42, 125, 235, 0.3)"),
    black: color("--ansi-black", "#5c6370"),
    red: color("--ansi-red", "#e06c75"),
    green: color("--ansi-green", "#98c379"),
    yellow: color("--ansi-yellow", "#e5c07b"),
    blue: color("--ansi-blue", "#61afef"),
    magenta: color("--ansi-magenta", "#c678dd"),
    cyan: color("--ansi-cyan", "#56b6c2"),
    white: color("--ansi-white", "#c8ccd4"),
    brightBlack: color("--ansi-bright-black", "#7f848e"),
    brightRed: color("--ansi-bright-red", "#ff7b86"),
    brightGreen: color("--ansi-bright-green", "#b5e890"),
    brightYellow: color("--ansi-bright-yellow", "#ffd68a"),
    brightBlue: color("--ansi-bright-blue", "#82c4ff"),
    brightMagenta: color("--ansi-bright-magenta", "#e09eff"),
    brightCyan: color("--ansi-bright-cyan", "#7fd6e0"),
    brightWhite: color("--ansi-bright-white", "#f0f2f5"),
  };
  screen.options.theme = theme;
}

function initialize(): void {
  if (screen || disposed || !hostEl.value || !props.active) return;
  screen = new Terminal({
    cols: props.task.cols || 100,
    rows: props.task.rows || 30,
    cursorBlink: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    cursorStyle: "bar",
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
    fontSize: appSettings.codeFontSize,
    lineHeight: 1.25,
    scrollback: 6000,
    convertEol: false,
    macOptionIsMeta: true,
    disableStdin: props.task.status !== "running",
  });
  const currentScreen = screen;
  fitAddon = new FitAddon();
  currentScreen.loadAddon(fitAddon);
  currentScreen.open(hostEl.value);
  currentScreen.textarea?.setAttribute("aria-label", "终端输入");
  currentScreen.textarea?.addEventListener("focus", onFocus);
  currentScreen.textarea?.addEventListener("blur", onBlur);
  applyTheme();

  currentScreen.onData((data) => {
    // 初次接回宿主快照时，历史 DSR/DA 等查询不应再次向正在运行的程序发送回应。
    if (!restoring && !disposed && props.task.status === "running") {
      void terminal.writePty(props.task.id, data);
    }
  });
  currentScreen.onBinary((data) => {
    if (!restoring && !disposed && props.task.status === "running") {
      void terminal.writePty(props.task.id, data, true);
    }
  });
  currentScreen.onResize(() => {
    if (!restoring) syncSize();
  });
  currentScreen.onSelectionChange(() => {
    if (props.active) emit("selection", currentScreen.getSelection());
  });
  currentScreen.attachCustomKeyEventHandler(onKey);
  currentScreen.attachCustomWheelEventHandler(createTerminalWheelHandler({
    getState: () => ({
      alternate: currentScreen.buffer.active.type === "alternate",
      // X10 只上报按下事件，不含滚轮；其余鼠标模式让程序按原生协议滚动。
      mouseTracking: currentScreen.modes.mouseTrackingMode !== "none" && currentScreen.modes.mouseTrackingMode !== "x10",
    }),
    send: (data) => {
      if (!restoring && !disposed && props.active && props.task.status === "running") {
        void terminal.writePty(props.task.id, data);
      }
    },
  }));

  restoring = true;
  const cached = props.task.output;
  offData = terminal.onData(props.task.id, (text) => {
    if (disposed) return;
    if (restoring) queuedData.push(text);
    else currentScreen.write(text);
  });
  const restored = () => {
    if (disposed || screen !== currentScreen) return;
    restoring = false;
    ready.value = true;
    for (const text of queuedData) currentScreen.write(text);
    queuedData = [];
    scheduleFit();
    if (props.active) currentScreen.focus();
  };
  if (cached) currentScreen.write(cached, restored);
  else restored();

  observer = new ResizeObserver(scheduleFit);
  observer.observe(hostEl.value);
  // 字体完成加载后再适配一次，避免默认字体的字宽导致 PTY 列数与屏幕不一致。
  void document.fonts.ready.then(() => {
    if (!disposed) scheduleFit();
  });
}

function syncSize(): void {
  if (!screen || !props.active || restoring || disposed) return;
  grid.value = { cols: screen.cols, rows: screen.rows };
  emit("size", grid.value);
  if (props.task.status === "running") {
    void terminal.resizePty(props.task.id, screen.cols, screen.rows);
  }
}

function fit(): void {
  if (!screen || !fitAddon || !props.active || restoring || disposed) return;
  const rect = hostEl.value?.getBoundingClientRect();
  if (!rect || rect.width < 20 || rect.height < 16) return;
  try {
    fitAddon.fit();
    // 不依赖 onResize 是否触发：首次挂载、回到同尺寸任务时也要同步宿主。
    syncSize();
  } catch {
    // 视图刚切换或字体未准备好时由 ResizeObserver 的下一次回调重试。
  }
}

function scheduleFit(): void {
  if (fitTimer || disposed || !props.active) return;
  fitTimer = setTimeout(() => {
    fitTimer = null;
    fit();
  }, 24);
}

async function activate(): Promise<void> {
  await nextTick();
  if (!props.active || disposed) return;
  initialize();
  fit();
  emit("selection", screen?.getSelection() || "");
}

function onFocus(): void {
  void window.piDesktop?.setTerminalFocus?.(true).catch(() => {});
}

function onBlur(): void {
  void window.piDesktop?.setTerminalFocus?.(false).catch(() => {});
}

function focus(): void {
  void activate().then(() => {
    if (!disposed && props.active && !restoring) screen?.focus();
  });
}

async function copySelection(): Promise<boolean> {
  const text = screen?.getSelection() || "";
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    emit("copied");
    return true;
  } catch {
    pushToast("warning", "无法复制终端选中内容，请检查剪贴板权限");
    return false;
  }
}

async function paste(): Promise<void> {
  if (props.task.status !== "running" || !props.active || restoring) return;
  const target = screen;
  try {
    const text = await navigator.clipboard.readText();
    // 读取剪贴板期间可能已经切换任务，不能把内容粘到离开的会话。
    if (text && !disposed && props.active && screen === target && props.task.status === "running") {
      target?.paste(text);
      target?.focus();
    }
  } catch {
    pushToast("warning", "无法读取剪贴板，请使用系统粘贴操作");
  }
}

function onKey(event: KeyboardEvent): boolean {
  if (event.type !== "keydown") return true;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  const copy = (mod && event.shiftKey && key === "c") || (event.metaKey && key === "c")
    || (event.ctrlKey && event.key === "Insert");
  const clipboardPaste = (mod && event.shiftKey && key === "v") || (event.metaKey && key === "v")
    || (event.ctrlKey && !event.shiftKey && key === "v" && window.piDesktop?.platform === "win32")
    || (event.shiftKey && event.key === "Insert");
  if (!copy && !clipboardPaste) return true;
  event.preventDefault();
  event.stopPropagation();
  if (copy) void copySelection();
  else void paste();
  return false;
}

function size(): { cols: number; rows: number } {
  return { cols: screen?.cols || 100, rows: screen?.rows || 30 };
}

defineExpose({ focus, copySelection, paste, size });

watch(() => props.active, (active) => {
  if (active) void activate();
  else screen?.blur();
}, { flush: "post" });
watch(() => workbench.state.theme, () => void nextTick(applyTheme));
watch(() => appSettings.codeFontSize, (size) => {
  if (screen) screen.options.fontSize = size;
  void nextTick(scheduleFit);
});
watch(() => props.task.status, (status) => {
  if (screen) screen.options.disableStdin = status !== "running";
});
onMounted(() => {
  if (props.active) void activate();
});
onDeactivated(() => screen?.blur());
onBeforeUnmount(() => {
  disposed = true;
  offData?.();
  observer?.disconnect();
  if (fitTimer) clearTimeout(fitTimer);
  queuedData = [];
  if (screen?.textarea === document.activeElement) onBlur();
  screen?.textarea?.removeEventListener("focus", onFocus);
  screen?.textarea?.removeEventListener("blur", onBlur);
  screen?.dispose();
  screen = null;
  fitAddon = null;
});
</script>

<template>
  <div
    ref="hostEl"
    class="terminal-xterm"
    :data-task-id="task.id"
    :data-cols="grid.cols"
    :data-rows="grid.rows"
    :data-terminal-ready="ready"
    @click="focus"
  />
</template>
