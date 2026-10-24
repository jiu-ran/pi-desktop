<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { formatTokens, icons, relativeTime, thinkingLabel } from "../../shared/util.ts";
import { formatBytes, imageDataUrl } from "../../shared/attachments.ts";
import { contextBar, formatCost, usageParts } from "../../shared/session-stats.ts";
import { applyMention, parseMentionToken, removeMentionToken } from "../../shared/mentions.ts";
import { filterCommands, mergeCommands, parseSlash, type SlashCommandItem } from "../../services/slash-commands.ts";
import { appSettings } from "../../services/settings.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import Picker from "./Picker.vue";
import SlashMenu from "./SlashMenu.vue";
import ImageLightbox from "./ImageLightbox.vue";
import Widgets from "../overlays/Widgets.vue";

const { workbench, slashCommands, bus } = useKernel();
const ws = computed(() => workbench.active.value);
const input = ref<HTMLTextAreaElement | null>(null);
const mode = computed({
  get: () => appSettings.streamingMode,
  set: (val: "followUp" | "steer") => {
    appSettings.streamingMode = val;
  },
});
const cursor = ref(0);
const dismissed = ref("");
const options = ref<Array<{ value: string; label: string; hint?: string }>>([]);
const optionsLoading = ref(false);
const busy = ref(false);
const pathPicker = ref(false);
const pathCursor = ref(0);
const pathItems = ref<WorkspaceEntry[]>([]);
const pathList = ref<HTMLElement | null>(null);
const pathLoading = ref(false);
let pathRequest = 0;

const draft = computed({
  get: () => ws.value?.draft ?? "",
  set: (value: string) => {
    if (ws.value) ws.value.draft = value;
  },
});

const queued = computed(() => [...(ws.value?.queue.steering ?? []), ...(ws.value?.queue.followUp ?? [])]);
const attachments = computed(() => ws.value?.attachments ?? []);
const imageAttachments = computed(() =>
  attachments.value.filter((item: any) => item.image && item.data),
);
const fileAttachments = computed(() =>
  attachments.value.filter((item: any) => !item.image || !item.data),
);
const imagePreviewIndex = ref<number | null>(null);
function previewAttachment(item: any): void {
  const index = imageAttachments.value.findIndex((entry: any) => entry.path === item.path);
  if (index >= 0) imagePreviewIndex.value = index;
}
const hasHistory = computed(() => (ws.value?.blocks.length ?? 0) > 0);

const modelItems = computed(() =>
  (ws.value?.models ?? []).map((m: any) => ({
    value: `${m.provider}/${m.id}`,
    label: m.name || m.id,
    hint: m.provider,
    model: m,
  })),
);
const modelValue = computed(() => (ws.value?.model ? `${ws.value.model.provider}/${ws.value.model.id}` : ""));
const modelLabel = computed(() => ws.value?.model?.name || ws.value?.model?.id || "选择模型");
const levelItems = computed(() =>
  (ws.value?.levels ?? []).map((level: string) => ({ value: level, label: thinkingLabel(level), hint: level })),
);
const modeItems = [
  { value: "followUp", label: "排队", hint: "当前任务结束后发送" },
  { value: "steer", label: "引导", hint: "插入到当前任务" },
];

// ---------- 上下文占用统计 ----------
const stats = ref<any>(null);
const statsOpen = ref(false);
let statsReqId = 0;

async function refreshStats(): Promise<void> {
  const currentWs = ws.value;
  if (!currentWs || currentWs.status !== "ready") {
    stats.value = null;
    return;
  }
  if (currentWs.sessionFile?.startsWith("__optimistic_")) {
    stats.value = {
      contextUsage: {
        tokens: 0,
        contextWindow: currentWs.model?.contextWindow ?? 200000,
        percent: 0,
      },
      tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    return;
  }
  const reqId = ++statsReqId;
  try {
    const result = await workbench.call("getSessionStats");
    if (reqId === statsReqId) {
      stats.value = result;
    }
  } catch {
    if (reqId === statsReqId) {
      stats.value = null;
    }
  }
}

watch(
  () => [ws.value?.cwd, ws.value?.sessionFile, ws.value?.status, ws.value?.model?.id],
  refreshStats,
  { immediate: true },
);

const offStats = bus.on("pi:event", ({ event }: { event: any }) => {
  if (
    event?.type === "agent_settled" ||
    event?.type === "compaction_end" ||
    event?.type === "turn_end" ||
    event?.type === "message_end"
  ) {
    refreshStats();
  }
});
onBeforeUnmount(offStats);

const contextUsage = computed(() => {
  if (stats.value?.contextUsage) return stats.value.contextUsage;
  const u = ws.value?.usage;
  const win = u?.contextWindow ?? ws.value?.model?.contextWindow ?? 200000;
  if (ws.value?.status === "ready") {
    const tokens = u?.contextTokens ?? u?.totalTokens ?? u?.input ?? 0;
    const pct = win > 0 ? (tokens / win) * 100 : 0;
    return { tokens, contextWindow: win, percent: pct };
  }
  return null;
});

const contextPercent = computed<number | null>(() =>
  contextUsage.value?.percent == null ? null : Math.min(100, Math.max(0, Math.round(contextUsage.value.percent))),
);

const contextLevel = computed<"low" | "mid" | "high">(() => {
  const pct = contextPercent.value ?? 0;
  if (pct > 80) return "high";
  if (pct > 50) return "mid";
  return "low";
});

// 用量明细弹层：格式化逻辑移植自 ThinkRail 的 SessionStatsBar（Apache-2.0）。
const statsParts = computed(() => (stats.value ? usageParts(stats.value, false) : []));
const statsBar = computed(() => contextBar(contextPercent.value));
const statsCost = computed(() => formatCost(stats.value?.cost));
const statsCounts = computed(() => {
  const s = stats.value;
  if (!s) return "暂无";
  return `${s.userMessages ?? 0} 轮提问 · ${s.assistantMessages ?? 0} 条回复 · ${s.toolCalls ?? 0} 次工具`;
});

watch(
  () => ws.value?.sessionFile,
  () => {
    statsOpen.value = false;
  },
);

// 打开弹层时刷新一次，避免显示上一次 turn 的快照。
async function toggleStats(): Promise<void> {
  statsOpen.value = !statsOpen.value;
  if (statsOpen.value) await refreshStats();
}

const contextTooltip = computed(() => {
  const c = contextUsage.value;
  if (!c) return "";
  const base = `上下文占用：${contextPercent.value ?? 0}%（${formatTokens(c.tokens)} / ${formatTokens(c.contextWindow)} tokens）`;
  const t = stats.value?.tokens;
  if (!t) return base;
  return `${base}\n累计 Token：${formatTokens(t.total)}（输入 ${formatTokens(t.input)} · 输出 ${formatTokens(t.output)} · 缓存 ${formatTokens(t.cacheRead)}）`;
});

// ---------- 斜杠命令 ----------
const allCommands = computed(() => mergeCommands(slashCommands, ws.value?.commands ?? []));
const parsed = computed(() => parseSlash(draft.value));
const exact = computed<SlashCommandItem | null>(() =>
  parsed.value ? allCommands.value.find((c) => c.name === parsed.value!.name) ?? null : null,
);

const menuMode = computed<"commands" | "options" | null>(() => {
  if (!parsed.value || dismissed.value === draft.value) return null;
  if (!parsed.value.hasArg) return "commands";
  if (exact.value?.local?.options) return "options";
  return null;
});
const commandItems = computed(() =>
  menuMode.value === "commands" && parsed.value ? filterCommands(allCommands.value, parsed.value.name) : [],
);
const optionItems = computed(() => {
  if (menuMode.value !== "options" || !parsed.value) return [];
  const q = parsed.value.arg.toLowerCase();
  const current =
    exact.value?.name === "model" ? modelValue.value : exact.value?.name === "thinking" ? ws.value?.thinking : "";
  return options.value
    .filter((o) => !q || `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q))
    .map((o) => ({ ...o, current: o.value === current }));
});
const menuItems = computed<any[]>(() => (menuMode.value === "options" ? optionItems.value : commandItems.value));
const pathToken = computed(() => parseMentionToken(draft.value));

/**
 * `@` 选择器里的「对话」候选：当前项目下除本会话之外的会话。
 * 引用会话不是插入路径，而是加一枚附件——发送时由主进程压成上下文块。
 */
const SESSION_SUGGESTIONS = 5;
const sessionRows = computed(() => {
  if (!pathPicker.value) return [];
  const list = (ws.value?.sessions ?? []) as any[];
  const current = ws.value?.sessionFile ?? "";
  const query = (pathToken.value?.query ?? "").trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return list
    .filter((item) => item?.path && item.path !== current && !item.empty)
    .filter((item) => {
      if (!words.length) return true;
      const haystack = String(item.title ?? "").toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, SESSION_SUGGESTIONS);
});
const pickerCount = computed(() => sessionRows.value.length + pathItems.value.length);

watch(
  () => [pathPicker.value, draft.value, ws.value?.cwd],
  async () => {
    const token = pathToken.value;
    if (!pathPicker.value || !token || !ws.value) {
      pathItems.value = [];
      pathLoading.value = false;
      if (pathPicker.value && !token) pathPicker.value = false;
      return;
    }
    const request = ++pathRequest;
    pathLoading.value = true;
    try {
      const result = await workbench.completePaths(token.query);
      if (request === pathRequest) {
        pathItems.value = result;
        pathCursor.value = 0;
      }
    } catch (error) {
      if (request === pathRequest) {
        pathItems.value = [];
        notifyError(error);
      }
    } finally {
      if (request === pathRequest) pathLoading.value = false;
    }
  },
);
watch(
  () => [menuMode.value, parsed.value?.name, parsed.value?.arg],
  () => {
    cursor.value = 0;
  },
);
watch(
  () => [pathCursor.value, pickerCount.value, pathPicker.value],
  async () => {
    await nextTick();
    const list = pathList.value;
    const item = list?.querySelector?.(".path-picker-item.active");
    item?.scrollIntoView({ block: "nearest" });
  },
);

watch(
  () => (menuMode.value === "options" ? exact.value?.key ?? "" : ""),
  async (key) => {
    options.value = [];
    if (!key || !exact.value?.local?.options) return;
    optionsLoading.value = true;
    try {
      options.value = (await exact.value.local.options()) ?? [];
    } catch (error) {
      notifyError(error);
    } finally {
      optionsLoading.value = false;
    }
  },
);

function notifyError(error: any): void {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

async function runLocal(cmd: SlashCommandItem, arg: string): Promise<void> {
  if (!cmd.local) return;
  draft.value = "";
  busy.value = true;
  try {
    await cmd.local.run(arg);
  } catch (error) {
    notifyError(error);
  } finally {
    busy.value = false;
    nextTick(focus);
  }
}

function pickCommand(cmd: SlashCommandItem | null, complete = false): void {
  if (!cmd) return;
  if (complete || (cmd.local && (cmd.args || cmd.local.options))) {
    draft.value = `/${cmd.name} `;
    nextTick(focus);
    return;
  }
  if (cmd.local) runLocal(cmd, "");
  else {
    draft.value = `/${cmd.name}`;
    submit();
  }
}

function pickOption(option: any): void {
  if (option && exact.value?.local) runLocal(exact.value, option.value);
}

function pick(item: any, complete = false): void {
  if (menuMode.value === "options") pickOption(item);
  else pickCommand(item, complete);
}

async function addFiles(): Promise<void> {
  try {
    await workbench.chooseFiles();
  } catch (error) {
    notifyError(error);
  }
}

async function addFolder(): Promise<void> {
  try {
    await workbench.chooseFolder();
  } catch (error) {
    notifyError(error);
  }
}

function removeAttachment(file: string): void {
  workbench.removeAttachment(file);
}

function onAtKey(event: KeyboardEvent): void {
  if (event.key !== "@" || event.ctrlKey || event.metaKey || event.altKey) return;
  // 键盘事件先于字符插入，要等这一轮事件处理完再看输入框内容。
  // 不用 requestAnimationFrame：窗口被遮挡时它可能一直不触发，选择器就打不开。
  setTimeout(() => {
    pathPicker.value = Boolean(pathToken.value);
  }, 0);
}

function closePathPicker(): void {
  pathPicker.value = false;
  pathItems.value = [];
  pathLoading.value = false;
  pathCursor.value = 0;
  pathRequest += 1;
}

/** 选中「对话」：去掉输入框里的 @query，把这个会话加成附件。 */
async function pickSession(session: any): Promise<void> {
  if (!session) return;
  const rest = removeMentionToken(draft.value);
  try {
    await workbench.addSessionAttachment(session);
    draft.value = rest;
  } catch (error) {
    notifyError(error);
    return;
  }
  closePathPicker();
  await nextTick();
  focus();
}

/** 回车/点击统一入口：会话在前、路径在后。 */
async function pickPickerRow(index: number): Promise<void> {
  const sessions = sessionRows.value;
  if (index < sessions.length) {
    await pickSession(sessions[index]);
    return;
  }
  await pickPath(pathItems.value[index - sessions.length]);
}

async function pickPath(item: WorkspaceEntry): Promise<void> {
  if (!item) return;
  const token = pathToken.value;
  if (!token) return;
  const mention = applyMention(draft.value, token, item.relative || item.name, item.kind === "folder");
  draft.value = mention.text;
  await nextTick();
  const el = input.value;
  if (el) {
    el.focus();
    el.setSelectionRange(mention.cursor, mention.cursor);
  }
  if (mention.keepOpen) {
    // 目录：保留选择器，继续补全子路径
    pathPicker.value = true;
  } else {
    closePathPicker();
  }
}

function pathIcon(item: WorkspaceEntry): { icon: string; className: string } {
  if (item.kind === "folder") return { icon: icons.folder, className: "folder" };
  const ext = item.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (["yml", "yaml"].includes(ext)) return { icon: icons.file, className: "yaml" };
  if (["xml", "html"].includes(ext)) return { icon: icons.code, className: "xml" };
  if (["json", "jsonl"].includes(ext)) return { icon: icons.json, className: "json" };
  if (["js", "ts", "jsx", "tsx", "vue", "svelte"].includes(ext)) return { icon: icons.code, className: "js" };
  if (["jar", "zip", "gz", "7z", "rar"].includes(ext)) return { icon: icons.archive, className: "archive" };
  if (["md", "txt", "log", "csv"].includes(ext)) return { icon: icons.text, className: "text" };
  return { icon: icons.file, className: "file" };
}

const attachMenu = ref(false);
const dragOver = ref(false);

function hasDroppablePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes("Files") || types.includes("application/x-pi-paths");
}

function onDragEnter(event: DragEvent): void {
  if (!hasDroppablePayload(event.dataTransfer)) return;
  event.preventDefault();
  dragOver.value = true;
}

function onDragOver(event: DragEvent): void {
  if (!hasDroppablePayload(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dragOver.value = true;
}

function onDragLeave(event: DragEvent): void {
  const current = event.currentTarget as HTMLElement | null;
  const related = event.relatedTarget as Node | null;
  if (current && related && current.contains(related)) return;
  dragOver.value = false;
}

async function onDrop(event: DragEvent): Promise<void> {
  if (!hasDroppablePayload(event.dataTransfer)) return;
  event.preventDefault();
  dragOver.value = false;
  const paths = workbench.extractDroppedPaths(event.dataTransfer);
  if (!paths.length) return;
  try {
    await workbench.addFiles(paths);
    nextTick(focus);
  } catch (error) {
    notifyError(error);
  }
}

function onWindowDragOver(event: DragEvent): void {
  if (hasDroppablePayload(event.dataTransfer)) {
    event.preventDefault();
  }
}

function onWindowDrop(event: DragEvent): void {
  if (hasDroppablePayload(event.dataTransfer)) {
    event.preventDefault();
    dragOver.value = false;
  }
}

function closeAttachMenu(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target?.closest?.(".attach-popover") && !target?.closest?.(".bar-btn.attach")) attachMenu.value = false;
}

// ---------- Ctrl+V 粘贴图片 ----------
const PASTE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/bmp"];
const PASTE_IMAGE_MAX = 6;

function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    if (!PASTE_IMAGE_TYPES.includes((item.type || "").toLowerCase())) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (PASTE_IMAGE_TYPES.includes((file.type || "").toLowerCase())) files.push(file);
    }
  }
  return files;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取剪贴板图片失败"));
    reader.readAsDataURL(file);
  });
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  if (!ws.value) return;
  const files = clipboardImageFiles(event.clipboardData);
  if (!files.length) return; // 普通文本粘贴交给默认行为
  event.preventDefault();
  const picked = files.slice(0, PASTE_IMAGE_MAX);
  if (files.length > PASTE_IMAGE_MAX) notifyError(new Error(`一次最多粘贴 ${PASTE_IMAGE_MAX} 张图片`));
  for (const file of picked) {
    try {
      const data = await readAsDataUrl(file);
      await workbench.addPastedImage({ name: file.name || "pasted", mimeType: file.type, data });
    } catch (error) {
      notifyError(pasteError(error));
    }
  }
  await nextTick();
  focus();
}

/** 开发模式下前端热更新而主进程未重启时，给出可操作的提示 */
function pasteError(error: any): Error {
  const message = String(error?.message ?? error ?? "");
  if (message.includes("No handler registered")) {
    return new Error("主进程还是旧版本：请完全退出并重新启动应用后再粘贴图片");
  }
  return error instanceof Error ? error : new Error(message || "粘贴图片失败");
}

function autosize(): void {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
}
watch(draft, () => nextTick(autosize));

function focus(): void {
  // 会话加载完成、附件添加等异步回调会再次聚焦输入框；
  // 如果用户已经在快速打开 / 搜索 / 设置等输入框里，不能把焦点抢回来。
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== input.value) {
    if (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
  }
  input.value?.focus();
}

async function submit(): Promise<void> {
  const text = draft.value;
  if ((!text.trim() && !attachments.value.length) || busy.value) return;
  if (exact.value?.local && parsed.value) {
    await runLocal(exact.value, parsed.value.arg);
    return;
  }
  draft.value = "";
  const sent = await workbench.send(text, { mode: mode.value });
  // 发送失败（附件失效、Worker 未就绪等）时把正文放回输入框，避免用户白打一段字。
  if (!sent && !draft.value) draft.value = text;
}

async function stop(): Promise<void> {
  const returned = await workbench.stop();
  if (returned) draft.value = [draft.value, returned].filter(Boolean).join("\n");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (pathPicker.value) {
    const count = pickerCount.value;
    if (event.key === "ArrowDown" && count) {
      pathCursor.value = (pathCursor.value + 1) % count;
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp" && count) {
      pathCursor.value = (pathCursor.value - 1 + count) % count;
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      closePathPicker();
      event.preventDefault();
      return;
    }
    if (((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") && count) {
      void pickPickerRow(pathCursor.value);
      event.preventDefault();
      return;
    }
  }
  if (menuMode.value) {
    const count = menuItems.value.length;
    if (event.key === "ArrowDown" && count) {
      cursor.value = (cursor.value + 1) % count;
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp" && count) {
      cursor.value = (cursor.value - 1 + count) % count;
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      dismissed.value = draft.value;
      event.preventDefault();
      return;
    }
    if (event.key === "Tab" && count) {
      pick(menuItems.value[cursor.value], true);
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      if (count && !(menuMode.value === "options" && !optionItems.value.length)) {
        event.preventDefault();
        pick(menuItems.value[cursor.value]);
        return;
      }
    }
  }
  if (event.key === "Enter") {
    const useCtrl = appSettings.sendShortcut === "ctrl-enter";
    const shouldSend = useCtrl ? event.ctrlKey || event.metaKey : !event.shiftKey && !event.ctrlKey && !event.metaKey;
    if (shouldSend) {
      event.preventDefault();
      submit();
      return;
    }
  }
  if (event.key === "Escape" && ws.value?.streaming) stop();
}

const offSet = bus.on("composer:set", ({ cwd, sessionFile, text }: { cwd: string; sessionFile?: string; text: string }) => {
  const target = workbench.workspaces.get(cwd);
  if (!target) return;
  if (sessionFile) {
    const thread = target.getThread?.(sessionFile);
    if (thread) {
      thread.draft = text;
      return;
    }
  }
  target.draft = text;
});
onBeforeUnmount(offSet);
onMounted(() => {
  focus();
  autosize();
  document.addEventListener("pointerdown", closeAttachMenu);
  document.addEventListener("click", closeAttachMenu);
  window.addEventListener("dragover", onWindowDragOver);
  window.addEventListener("drop", onWindowDrop);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeAttachMenu);
  document.removeEventListener("click", closeAttachMenu);
  window.removeEventListener("dragover", onWindowDragOver);
  window.removeEventListener("drop", onWindowDrop);
});
watch(
  () => ws.value?.sessionFile,
  () => nextTick(focus),
);

const placeholder = computed(() => {
  if (ws.value?.streaming) return "继续输入，将按所选方式加入当前任务…";
  return hasHistory.value ? "继续这个任务，输入 / 使用命令" : "描述一个任务，输入 / 使用命令";
});
const argHint = computed(() => {
  if (!exact.value || !parsed.value?.hasArg || parsed.value.arg || menuMode.value) return "";
  return exact.value.args || "";
});
</script>

<template>
  <div class="composer-wrap">
    <div class="composer-inner">
      <Widgets />

      <div v-if="queued.length" class="queue-strip">
        <span class="queue-label">待发送 {{ queued.length }}</span>
        <span v-for="(item, i) in queued" :key="i" class="queue-chip" :title="item">{{ item }}</span>
      </div>

      <div
        class="composer"
        :class="{ busy: ws?.streaming, 'drag-over': dragOver }"
        @mousedown.self="focus"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.stop="onDrop"
        @paste="onPaste"
      >
        <div v-if="dragOver" class="composer-drop-mask">
          <span class="composer-drop-icon" v-html="icons.folder" />
          <span>释放鼠标以添加文件或文件夹</span>
        </div>
        <div v-if="pathPicker" class="path-picker" @mousedown.stop>
          <div class="path-picker-head">
            <div class="path-picker-title">
              <span class="path-picker-at">@</span>
              <span>对话 · 文件</span>
              <span v-if="pathToken?.query" class="path-picker-query">{{ pathToken.query }}</span>
            </div>
            <button class="path-picker-close" title="关闭（Esc）" aria-label="关闭" @click="closePathPicker">×</button>
          </div>
          <div ref="pathList" class="path-picker-list" role="listbox" aria-label="对话、文件和文件夹">
            <template v-if="sessionRows.length">
              <div class="path-picker-section">引用对话</div>
              <button
                v-for="(item, index) in sessionRows"
                :key="item.path"
                class="path-picker-item path-picker-session"
                :class="{ active: index === pathCursor }"
                :aria-selected="index === pathCursor"
                role="option"
                @mouseenter="pathCursor = index"
                @click="pickSession(item)"
              >
                <span class="path-item-icon session" v-html="icons.chat" />
                <span class="path-item-name">{{ item.title || "未命名会话" }}</span>
                <span class="path-item-relative">{{ relativeTime(item.timestamp) }}</span>
              </button>
            </template>
            <div v-if="pathLoading" class="path-picker-state"><span class="mini-spinner" />正在搜索…</div>
            <template v-if="pathItems.length">
              <div v-if="sessionRows.length" class="path-picker-section">文件与文件夹</div>
              <button
                v-for="(item, index) in pathItems"
                :key="item.path"
                class="path-picker-item"
                :class="{ active: sessionRows.length + index === pathCursor }"
                :aria-selected="sessionRows.length + index === pathCursor"
                role="option"
                @mouseenter="pathCursor = sessionRows.length + index"
                @click="pickPath(item)"
              >
                <span class="path-item-icon" :class="pathIcon(item).className" v-html="pathIcon(item).icon" />
                <span class="path-item-name">{{ item.name }}</span>
                <span class="path-item-relative">{{ item.relative }}</span>
              </button>
            </template>
            <div v-if="!pathLoading && !pickerCount" class="path-picker-state">没有匹配的对话、文件或文件夹</div>
          </div>
          <div class="path-picker-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span><kbd>Enter</kbd> 选中</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span v-if="pickerCount" class="path-picker-count">{{ pickerCount }} 项</span>
          </div>
        </div>
        <SlashMenu
          v-if="menuMode"
          :mode="menuMode"
          :items="menuItems"
          :cursor="cursor"
          :command="exact"
          :loading="optionsLoading"
          @hover="(i) => (cursor = i)"
          @pick="(item) => pick(item)"
        />

        <div class="composer-field">
          <div v-if="attachments.length" class="attachment-strip">
            <div
              v-for="item in imageAttachments"
              :key="item.path"
              class="attachment-thumb"
              :title="`${item.name}（点击预览）`"
            >
              <button type="button" class="attachment-thumb-open" @click="previewAttachment(item)">
                <img :src="imageDataUrl(item.mimeType, item.data)" :alt="item.name" />
              </button>
              <button type="button" class="attachment-thumb-remove" title="移除图片" @click="removeAttachment(item.path)">×</button>
            </div>
            <span
              v-for="item in fileAttachments"
              :key="item.path"
              class="attachment-chip"
              :class="{ session: item.kind === 'session' }"
              :title="item.kind === 'session' ? `引用对话：${item.name}` : item.path"
            >
              <span
                class="attachment-chip-icon"
                v-html="item.kind === 'session' ? icons.chat : item.kind === 'folder' ? icons.folder : icons.attach"
              />
              <span>{{ item.name }}</span>
              <span v-if="item.kind === 'session' && item.messages" class="attachment-chip-meta">{{ item.messages }} 条</span>
              <span v-else-if="item.size" class="attachment-chip-meta">{{ formatBytes(item.size) }}</span>
              <button type="button" :title="item.kind === 'session' ? '移除对话引用' : '移除附件'" @click="removeAttachment(item.path)">×</button>
            </span>
          </div>
          <textarea
            ref="input"
            v-model="draft"
            rows="1"
            :placeholder="placeholder"
            spellcheck="false"
            @keydown="onKeydown"
            @keyup="onAtKey"
          />
          <span v-if="argHint" class="arg-hint" aria-hidden="true"><span class="arg-ghost">{{ draft }}</span>{{ argHint }}</span>
        </div>

        <div class="composer-bar">
          <div class="composer-left">
            <div class="attach-wrap">
              <button class="bar-btn attach" title="添加文件或文件夹（@）" @click="attachMenu = !attachMenu" v-html="icons.plus" />
              <div v-if="attachMenu" class="attach-popover" @mousedown.stop>
                <button @click="addFiles(); attachMenu = false"><span v-html="icons.attach" />添加文件</button>
                <button @click="addFolder(); attachMenu = false"><span v-html="icons.folder" />添加文件夹</button>
              </div>
            </div>
            <Picker
              v-if="modelItems.length"
              :items="modelItems"
              :value="modelValue"
              :label="modelLabel"
              :icon="icons.model"
              :title="`模型：${modelValue}`"
              filterable
              @pick="(item) => workbench.setModel(item.model)"
            />
            <Picker
              v-if="levelItems.length > 1"
              :items="levelItems"
              :value="ws?.thinking"
              :label="`思考：${thinkingLabel(ws?.thinking ?? 'off')}`"
              :icon="icons.brain"
              title="思考等级"
              @pick="(item) => workbench.setThinking(String(item.value))"
            />
          </div>
          <div class="composer-right">
            <button
              v-if="contextUsage"
              type="button"
              class="composer-context"
              :data-level="contextLevel"
              :title="contextTooltip"
              :aria-expanded="statsOpen"
              aria-label="查看会话用量"
              @click="toggleStats"
            >
              <svg class="context-ring" viewBox="0 0 20 20" aria-hidden="true">
                <circle class="context-ring-track" cx="10" cy="10" r="7.5" />
                <circle
                  class="context-ring-fill"
                  cx="10"
                  cy="10"
                  r="7.5"
                  :stroke-dasharray="`${((contextPercent ?? 0) / 100) * 47.12} 47.12`"
                />
              </svg>
              <span class="composer-context-pct">{{ contextPercent ?? "-" }}%</span>
            </button>
            <button
              v-if="statsOpen && stats"
              type="button"
              class="composer-stats-backdrop"
              aria-label="关闭会话统计"
              @click="statsOpen = false"
            />
            <div v-if="statsOpen && stats" class="composer-stats-pop" role="dialog" aria-label="会话统计">
              <div class="composer-stats-title">会话用量</div>
              <div class="composer-stats-row">
                <span>上下文</span>
                <span class="composer-stats-value">
                  <span class="composer-stats-bar">{{ statsBar }}</span>
                  {{ contextPercent ?? "-" }}% · {{ formatTokens(contextUsage?.tokens ?? 0) }}/{{ formatTokens(contextUsage?.contextWindow ?? 0) }}
                </span>
              </div>
              <div class="composer-stats-row">
                <span>累计</span>
                <span class="composer-stats-value">{{ statsParts.length ? statsParts.join(" · ") : "暂无" }}</span>
              </div>
              <div class="composer-stats-row">
                <span>费用</span>
                <span class="composer-stats-value">{{ statsCost }}</span>
              </div>
              <div class="composer-stats-row">
                <span>消息</span>
                <span class="composer-stats-value">{{ statsCounts }}</span>
              </div>
            </div>
            <Picker
              v-if="ws?.streaming"
              :items="modeItems"
              :value="mode"
              :label="mode === 'steer' ? '引导' : '排队'"
              title="运行中发送的方式"
              align="right"
              @pick="(item) => (mode = item.value === 'steer' ? 'steer' : 'followUp')"
            />
            <button v-if="ws?.streaming" class="send-btn stop" title="停止（Esc）" @click="stop">
              <span v-html="icons.stop" />停止
            </button>
            <button
              class="send-btn"
              :class="{ ready: (draft.trim() || attachments.length) && !busy }"
              :disabled="(!draft.trim() && !attachments.length) || busy"
              :title="appSettings.sendShortcut === 'ctrl-enter' ? 'Ctrl+Enter 发送 · Enter 换行' : 'Enter 发送 · Shift+Enter 换行'"
              @click="submit"
            >
              <span v-if="busy" class="mini-spinner" />
              <span v-else class="send-icon" v-html="icons.send" />
              {{ exact?.local ? "执行" : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <ImageLightbox v-model:index="imagePreviewIndex" :items="imageAttachments.map((item: any) => ({ src: imageDataUrl(item.mimeType, item.data), name: item.name }))" />
  </div>
</template>
