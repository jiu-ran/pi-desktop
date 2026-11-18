<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { formatTokens, icons, thinkingLabel } from "../../shared/util.ts";
import { formatBytes, imageDataUrl } from "../../shared/attachments.ts";
import { contextBar, formatCost, usageParts } from "../../shared/session-stats.ts";
import { applyMention, parseMentionToken, removeMentionToken } from "../../shared/mentions.ts";
import { planQueueCard, planQueueMove, planQueueView, queueDraftText, queuePreview, splitPromptBlocks, type PromptBlock } from "../../shared/queue-view.ts";
import QuoteEditor from "./QuoteEditor.vue";
import SelectMenu from "../shared/SelectMenu.vue";
import { filterCommands, mergeCommands, parseSlash, type SlashCommandItem } from "../../services/slash-commands.ts";
import { PI_BUILTIN_COMMANDS, findPiCommand, terminalCommandNotice } from "../../shared/pi-commands.ts";
import { bashEditorText, parseBashInput, setBashEditorText, toggleBashMode } from "../../shared/bash-input.ts";
import { appSettings } from "../../services/settings.ts";
import { openWorktreeDialog } from "../../services/worktree-dialog.ts";
import { openMenu } from "../sidebar/ui.ts";
import { EMPTY_HISTORY_STATE, appendPromptHistory, caretOnFirstLine, caretOnLastLine, recallNext, recallPrevious, type PromptHistoryState } from "../../shared/prompt-history.ts";
import { readStorage, writeStorage } from "../../shared/storage.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import Picker from "./Picker.vue";
import ModelThinkingPicker from "./ModelThinkingPicker.vue";
import SlashMenu from "./SlashMenu.vue";
import ImageLightbox from "./ImageLightbox.vue";
import Widgets from "../overlays/Widgets.vue";

const { workbench, slashCommands, bus, plugins } = useKernel();
// 气泡上的「编辑」入口通过 bus 传上来：气泡在对话区，编辑框在输入框上方
const stopQueueEditListener = bus.on("queue:edit", onQueueEditRequest);
onBeforeUnmount(stopQueueEditListener);
const ws = computed(() => workbench.active.value);
const input = ref<HTMLTextAreaElement | null>(null);
/** 发送按钮：发送成功后从这里放一颗光点飞向对话区 */
const sendBtn = ref<HTMLButtonElement | null>(null);

/**
 * 输入框的右键菜单：用应用自己的菜单（和文件树 / 会话列表同一种），
 * 不用 WebView 的原生菜单（Emoji / Writing direction / More tools 那一套，
 * 样式和整窗玻璃视觉不搭，还有一堆用不上的项）。
 *
 * 打开菜单会让 textarea 失焦，所以先把选区记下来，执行命令前再还原。
 */
function openComposerMenu(event: MouseEvent): void {
  const el = input.value;
  if (!el) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const hasSelection = end > start;
  const readOnly = el.readOnly || el.disabled;
  const restore = (): void => {
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
  };
  const command = (name: string) => () => {
    restore();
    document.execCommand(name);
  };
  openMenu(event, [
    { label: "撤销", hint: "Ctrl+Z", disabled: readOnly, run: command("undo") },
    { label: "重做", hint: "Ctrl+Shift+Z", disabled: readOnly, run: command("redo") },
    { separator: true },
    { label: "剪切", hint: "Ctrl+X", disabled: readOnly || !hasSelection, run: command("cut") },
    { label: "复制", hint: "Ctrl+C", disabled: !hasSelection, run: command("copy") },
    { label: "粘贴", hint: "Ctrl+V", disabled: readOnly, run: () => void pasteIntoComposer(start, end) },
    { separator: true },
    {
      label: "全选",
      hint: "Ctrl+A",
      disabled: readOnly,
      run: () => {
        el.focus({ preventScroll: true });
        el.select();
      },
    },
  ]);
}

/** 菜单里的「粘贴」：执行命令拿不到剪贴板，改走宿主读取再插入（失败就提示用快捷键）。 */
async function pasteIntoComposer(start: number, end: number): Promise<void> {
  const el = input.value;
  if (!el) {
    return;
  }
  let text = "";
  try {
    text = (await window.piDesktop?.readClipboard?.()) ?? "";
  } catch {
    text = "";
  }
  if (!text) {
    bus.emit("notify", { level: "warning", text: "读不到剪贴板内容，可以用 Ctrl+V 粘贴" });
    return;
  }
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    const value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
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

/**
 * 发过的内容留在本地（最多 50 条）：↑ / ↓ 在输入框里翻阅。
 * 与草稿分开存 —— 草稿是「没发出去的」，历史是「已经发出去的」。
 */
const PROMPT_HISTORY_KEY = "pi-desktop:prompt-history";

function loadPromptHistory(): string[] {
  try {
    const parsed = JSON.parse(readStorage(PROMPT_HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const promptHistory = ref<string[]>(loadPromptHistory());
const historyState = ref<PromptHistoryState>({ ...EMPTY_HISTORY_STATE });

function rememberPrompt(text: string): void {
  const next = appendPromptHistory(promptHistory.value, text);
  if (next === promptHistory.value) return;
  promptHistory.value = next;
  writeStorage(PROMPT_HISTORY_KEY, JSON.stringify(next));
}

/**
 * ↑ / ↓ 翻历史。只有在「没有选中文字」且光标在首行（↑）/ 末行（↓）时才接管，
 * 否则多行编辑时上下键会被吃掉。返回 true 表示这次事件已经处理。
 */
function recallPrompt(direction: -1 | 1): boolean {
  const element = input.value;
  const current = draft.value;
  if (element && element.selectionStart !== element.selectionEnd) return false;
  const caret = element?.selectionStart ?? current.length;
  const step =
    direction === -1
      ? caretOnFirstLine(current, caret)
        ? recallPrevious(promptHistory.value, historyState.value, current)
        : null
      : caretOnLastLine(current, caret)
        ? recallNext(promptHistory.value, historyState.value)
        : null;
  if (!step) return false;
  historyState.value = step.state;
  draft.value = step.text;
  void nextTick(() => {
    const target = input.value;
    if (!target) return;
    target.selectionStart = target.selectionEnd = target.value.length;
    autosize();
  });
  return true;
}

const draft = computed({
  get: () => ws.value?.draft ?? "",
  set: (value: string) => {
    if (ws.value) ws.value.draft = value;
  },
});

/**
 * 还排在队列里的消息统一列在输入框上方（含插话与排队两种），
 * 对话里那张乐观气泡由 AgentChat 暂时隐藏，避免同一条消息出现两次。
 */
const queuePlan = computed(() =>
  planQueueView((ws.value?.blocks ?? []) as any[], ws.value?.queue ?? { steering: [], followUp: [] }),
);
const queuePending = computed(() => queuePlan.value.entries);
/** 每张待发送卡片的展示内容（正文 + 附件名），与 queuePending 一一对应 */
const queueCards = computed(() => queuePending.value.map((item) => planQueueCard(item.text, 160)));
const queueBusy = ref(false);

/** 排队消息编辑：预填「用户写的话」，附件单独列成标签，支持 Ctrl+V 粘贴图片。 */
const queueEdit = ref<{
  mode: "steer" | "followUp";
  prompt: string;
  blocks: PromptBlock[];
  /** 原来在队列里的位置（取消 / 保存时插回原处） */
  index: number;
  /** 打开编辑时的会话与项目：切换会话 / 项目后要把它放回原来那条队列 */
  cwd: string;
  sessionFile: string;
  thread: any;
} | null>(null);
const queueEditDraft = ref("");
const queueEditBusy = ref(false);
/** 编辑期间新粘贴的附件（保存时由内核重新 prepare 成 <file> 标记） */
const queueEditAdded = ref<Array<{ path: string; name: string }>>([]);
/** 提示词里原有、这次保留下来的附件路径（点 × 从里面删掉就等于删掉这个附件） */
const queueEditKept = ref<string[]>([]);
/** 编辑框里还要显示的原有附件 */
const queueEditBlocks = computed(() =>
  (queueEdit.value?.blocks ?? []).filter((block) => queueEditKept.value.includes(block.path)),
);

async function startQueueEdit(mode: "steer" | "followUp", prompt: string): Promise<void> {
  if (queueBusy.value || queueEdit.value) return;
  queueBusy.value = true;
  try {
    // 先把这条从 Pi 的队列里拿走：引导消息排队期间随时会被投递进当前回合，
    // 用户还在改它就已经发出去了，之后保存也因为队列里找不到而静默失败。
    const held = await workbench.holdQueuedEdit({ mode, text: prompt });
    if (!held.ok) return;
    // 预填只能取「用户写的话」：附件块单独列出来，否则 [文件: …] 标签会被写回提示词，
    // 保存后气泡上就多出一条重复的图片路径。
    const activeWs = ws.value;
    const blocks = splitPromptBlocks(prompt).blocks;
    queueEdit.value = {
      mode,
      prompt,
      blocks,
      index: held.index,
      cwd: activeWs?.cwd ?? "",
      sessionFile: activeWs?.sessionFile ?? "",
      thread: activeWs?.activeThread,
    };
    queueEditDraft.value = queueDraftText(prompt);
    queueEditKept.value = blocks.map((block) => block.path);
    queueEditAdded.value = [];
    nextTick(() => {
      const area = document.querySelector<HTMLTextAreaElement>(".queue-editor textarea");
      area?.focus();
      area?.setSelectionRange(area.value.length, area.value.length);
    });
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}

async function openQueueEdit(entry: { mode: "steer" | "followUp"; prompt: string }): Promise<void> {
  await startQueueEdit(entry.mode, entry.prompt);
}

function resetQueueEdit(): void {
  queueEdit.value = null;
  queueEditDraft.value = "";
  queueEditAdded.value = [];
  queueEditKept.value = [];
}

/** 取消编辑：把原来那条按原位置放回队列（图片也一起带回去）。 */
async function closeQueueEdit(): Promise<void> {
  const entry = queueEdit.value;
  resetQueueEdit();
  if (!entry) return;
  try {
    await workbench.cancelQueuedEdit({ mode: entry.mode, text: entry.prompt }, entry.index, {
      thread: entry.thread,
      cwd: entry.cwd,
    });
  } catch (error) {
    notifyError(error);
  }
}

/** 从队列里定位某条消息的模式（气泡只知道提示词文本）。 */
function queueModeOf(prompt: string): "steer" | "followUp" {
  const queue = ws.value?.queue ?? { steering: [], followUp: [] };
  const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const wanted = normalize(prompt);
  if ((queue.steering ?? []).some((item) => normalize(item) === wanted)) return "steer";
  return "followUp";
}

/** 编辑来自对话气泡的排队消息（气泡自己只知道文本，通过 bus 传上来）。 */
function onQueueEditRequest(payload: { prompt?: string; message?: string } | undefined): void {
  const prompt = String(payload?.prompt ?? "");
  if (!prompt) return;
  startQueueEdit(queueModeOf(prompt), prompt);
}

/** 编辑框里 Ctrl+V 粘贴图片：先落盘，保存时统一 prepare 成附件标记。 */
async function onQueueEditPaste(event: ClipboardEvent): Promise<void> {
  const files = clipboardImageFiles(event.clipboardData);
  if (!files.length) return; // 普通文本粘贴交给默认行为
  event.preventDefault();
  const picked = files.slice(0, PASTE_IMAGE_MAX);
  if (files.length > PASTE_IMAGE_MAX) notifyError(new Error(`一次最多粘贴 ${PASTE_IMAGE_MAX} 张图片`));
  for (const file of picked) {
    try {
      const data = await readAsDataUrl(file);
      const staged = await workbench.stagePastedAttachment({ name: file.name || "pasted", mimeType: file.type, data });
      if (!staged) continue;
      const name = staged.name;
      if (!queueEditAdded.value.some((item) => item.path === staged.path)) {
        queueEditAdded.value = [...queueEditAdded.value, { path: staged.path, name }];
      }
    } catch (error) {
      notifyError(pasteError(error));
    }
  }
  await nextTick();
  document.querySelector<HTMLTextAreaElement>(".queue-editor textarea")?.focus();
}

function removeQueueEditAdded(path: string): void {
  queueEditAdded.value = queueEditAdded.value.filter((item) => item.path !== path);
}

/** 删掉提示词里原有的附件（输入框带过来的图片以前删不掉，只能删编辑时新粘贴的）。 */
function removeQueueEditBlock(path: string): void {
  queueEditKept.value = queueEditKept.value.filter((item) => item !== path);
}

async function saveQueueEdit(): Promise<void> {
  const entry = queueEdit.value;
  const text = queueEditDraft.value.trim();
  if (!entry || queueEditBusy.value) return;
  const kept = queueEditKept.value;
  if (!text && !kept.length && !queueEditAdded.value.length) return;
  queueEditBusy.value = true;
  try {
    // 只有真的删掉过附件才传 keepPaths：没删就原样保留（老提示词里可能有认不出的块）
    const removed = entry.blocks.some((block) => !kept.includes(block.path));
    const ok = await workbench.editQueued(
      { mode: entry.mode, text: entry.prompt },
      {
        message: text,
        keepPaths: removed ? kept : undefined,
        addPaths: queueEditAdded.value.map((item) => item.path),
        index: entry.index,
      },
    );
    if (ok) resetQueueEdit();
  } catch (error) {
    notifyError(error);
  } finally {
    queueEditBusy.value = false;
  }
}

/** 会话引用编辑：改名称与注入的上下文正文。 */
const quoteEditor = ref<{
  open: boolean;
  file: string;
  title: string;
  autoText: string;
  customText?: string;
  messages?: number;
  size?: number;
}>({ open: false, file: "", title: "", autoText: "" });
const quoteBusy = ref(false);

async function openQuoteEditor(item: any): Promise<void> {
  if (!item?.path || item.kind !== "session" || quoteBusy.value) return;
  quoteBusy.value = true;
  try {
    // 先把自动摘要取回来再打开对话框：否则打开后再填充会把用户正在改的内容覆盖掉
    const preview = await workbench.previewSessionQuote(item.path);
    quoteEditor.value = {
      open: true,
      file: item.path,
      title: item.name || preview.title || "",
      autoText: preview.text,
      customText: typeof item.customText === "string" ? item.customText : undefined,
      messages: item.messages,
      size: item.size,
    };
  } catch (error) {
    notifyError(error);
  } finally {
    quoteBusy.value = false;
  }
}

function closeQuoteEditor(): void {
  quoteEditor.value = { ...quoteEditor.value, open: false };
}

function saveQuoteEditor(patch: { name: string; customText: string | null }): void {
  if (!quoteEditor.value.file) return;
  const ok = workbench.setSessionQuote(quoteEditor.value.file, patch);
  if (ok) closeQuoteEditor();
}

/** 撤回单条排队消息：从队列里拿掉，文字回填输入框（拿回来就是要改的）。 */
async function withdrawQueued(item: { mode: "steer" | "followUp"; text: string }): Promise<void> {
  if (queueBusy.value) return;
  queueBusy.value = true;
  try {
    const result = await workbench.withdrawQueued({ mode: item.mode, text: item.text });
    if (!result.ok) return;
    if (result.draft) {
      draft.value = [draft.value, result.draft].filter(Boolean).join("\n");
      nextTick(() => {
        focus();
        const area = document.querySelector<HTMLTextAreaElement>(".composer-input");
        area?.setSelectionRange(area.value.length, area.value.length);
      });
    }
    // 撤回把图片也带回来了：按提示词里的附件块放回输入框（以前只回文字，图片就丢了）
    if (result.attachments?.length) await restoreAttachments(result.attachments);
    // 正在编辑这条的话，把编辑框收起（内容已经撤回，不要再放回队列）
    if (queueEdit.value && normalizePrompt(queueEdit.value.prompt) === normalizePrompt(item.text)) {
      resetQueueEdit();
    }
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}

/** 换投递方式：排队 ↔ 引导（引导立刻插进当前回合，排队等这一轮结束）。 */
async function switchQueuedMode(item: { mode: "steer" | "followUp"; text: string }, mode: "steer" | "followUp"): Promise<void> {
  if (queueBusy.value || item.mode === mode) return;
  queueBusy.value = true;
  try {
    await workbench.changeQueuedMode({ mode: item.mode, text: item.text }, mode);
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}

/* ---------- 拖拽调整顺序 ---------- */
const queueDrag = ref<number | null>(null);
const queueDrop = ref<{ index: number; after: boolean } | null>(null);

/** 落点：卡片上下一半决定插到它前面还是后面 */
function queueDropTarget(index: number, event: DragEvent): { index: number; after: boolean } {
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  return { index, after: event.clientY > rect.top + rect.height / 2 };
}

function onQueueDragStart(index: number, event: DragEvent): void {
  if (queueBusy.value) return;
  queueDrag.value = index;
  queueDrop.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Firefox 里不设数据不会真的开始拖拽
    event.dataTransfer.setData("text/plain", String(index));
  }
}

function onQueueDragOver(index: number, event: DragEvent): void {
  if (queueDrag.value === null) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const target = queueDropTarget(index, event);
  const to = target.index + (target.after ? 1 : 0);
  // 拖到自己身上 / 拖到自己后面一格：没有变化，不画插入线
  queueDrop.value = to === queueDrag.value || to === queueDrag.value + 1 ? null : target;
}

function onQueueDragEnd(): void {
  queueDrag.value = null;
  queueDrop.value = null;
}

async function onQueueDrop(index: number, event: DragEvent): Promise<void> {
  if (queueDrag.value === null || queueBusy.value) {
    onQueueDragEnd();
    return;
  }
  event.preventDefault();
  const { after } = queueDropTarget(index, event);
  const from = queueDrag.value;
  onQueueDragEnd();
  const { entries, changed } = planQueueMove(queuePending.value, from, index + (after ? 1 : 0));
  if (!changed) return;
  queueBusy.value = true;
  try {
    await workbench.reorderQueued(entries.map((entry) => ({ mode: entry.mode, text: entry.text })));
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}

/** 卡片给读屏的名字：第几条、怎么发、写了什么 */
function queueCardLabel(index: number): string {
  const item = queuePending.value[index];
  if (!item) return "";
  const mode = item.mode === "steer" ? "引导" : "排队";
  return `第 ${index + 1} 条，${mode}：${queuePreview(item.text, 60)}`;
}

/** 键盘调整顺序（和拖拽走同一套 planQueueMove + reorderQueued） */
async function moveQueued(index: number, delta: number): Promise<void> {
  if (queueBusy.value) return;
  const to = index + delta;
  if (to < 0 || to >= queuePending.value.length) return;
  const { entries, changed } = planQueueMove(queuePending.value, index, delta > 0 ? to + 1 : to);
  if (!changed) return;
  queueBusy.value = true;
  try {
    await workbench.reorderQueued(entries.map((entry) => ({ mode: entry.mode, text: entry.text })));
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}

function normalizePrompt(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * 撤回回来的附件放回输入框：文件 / 目录走 addFiles，会话引用走 addSessionAttachment
 * （会话可能来自别的项目，不能按普通附件校验）。
 */
async function restoreAttachments(
  items: Array<{ kind: "file" | "directory" | "session"; path: string; name?: string }>,
): Promise<void> {
  const files = items.filter((item) => item.kind !== "session").map((item) => item.path);
  if (files.length) {
    try {
      await workbench.addFiles(files);
    } catch (error) {
      notifyError(error);
    }
  }
  // 会话引用属于 session-quote 插件的能力，核心只发事件（停用插件时自然没人接）
  for (const item of items.filter((entry) => entry.kind === "session")) {
    bus.emit("session-quote:attach", { path: item.path, title: item.name });
  }
}

async function recallQueue(): Promise<void> {
  if (queueBusy.value) return;
  queueBusy.value = true;
  try {
    const recalled = await workbench.recallQueued();
    if (recalled.draft) draft.value = [draft.value, recalled.draft].filter(Boolean).join("\n");
    if (recalled.attachments?.length) await restoreAttachments(recalled.attachments);
    nextTick(focus);
  } catch (error) {
    notifyError(error);
  } finally {
    queueBusy.value = false;
  }
}
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

/** 新会话默认模型：用来在列表里标「默认」，也用来「设为默认」 */
const defaultModelRef = ref("");
const defaultThinkingRef = ref("");
const agentBusy = ref(false);

/** 输入框里的 Agent 选择：与标题栏共用同一份探测结果，按项目记住选择。 */
const agentOptions = computed(() =>
  (workbench.state.agents?.agents ?? []).map((agent: any) => ({
    value: String(agent.kind ?? ""),
    label: String(agent.label ?? agent.kind ?? ""),
    hint: agent.found ? `v${agent.version}` : "未找到",
    disabled: !agent.found || Boolean(agentBusy.value) || Boolean(ws.value?.streaming) || Boolean(ws.value?.hasAnyRunning),
  })),
);

async function onSelectAgent(kind: string | number | boolean): Promise<void> {
  const value = String(kind ?? "");
  if (!value || agentBusy.value) return;
  agentBusy.value = true;
  try {
    await workbench.selectAgentForSession(value);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    agentBusy.value = false;
  }
}

async function reloadDefaultModel(): Promise<void> {
  // Antigravity 的默认模型由 CLI 自己管理，把 Pi 的默认值显示在这里会误导用户。
  if (ws.value?.agent === "antigravity") {
    defaultModelRef.value = "";
    defaultThinkingRef.value = "";
    return;
  }
  if (!workbench.modelDefaults) return;
  try {
    const data = await workbench.modelDefaults();
    const item = data?.effective;
    defaultModelRef.value = item?.provider && item?.model ? `${item.provider}/${item.model}` : "";
    defaultThinkingRef.value = item?.thinkingLevel ?? "";
  } catch {
    defaultModelRef.value = "";
    defaultThinkingRef.value = "";
  }
}

onMounted(() => {
  void reloadDefaultModel();
  if (!workbench.state.agents?.loaded) void workbench.refreshAgents();
});
watch(() => ws.value?.cwd, () => { void reloadDefaultModel(); });

// 切换会话 / 项目时把排队编辑收起来：这条消息已经离开原来的队列，必须放回原会话，
// 否则它既不在队列里、界面上也看不到，等于丢了。
watch(
  () => [ws.value?.cwd, ws.value?.sessionFile],
  () => {
    if (queueEdit.value) void closeQueueEdit();
  },
);

async function onSelectModel(model: any): Promise<void> {
  if (!model) return;
  try {
    await workbench.setModel(model);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

async function onSelectThinking(level: string): Promise<void> {
  try {
    await workbench.setThinking(level);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

/** 一次把当前模型与思考等级写成新会话默认值 */
async function onSetDefaultModelAndThinking(payload: { model: any; thinkingLevel: string }): Promise<void> {
  const { model, thinkingLevel } = payload;
  if (!model || !workbench.setModelDefaults) return;
  if (ws.value?.agent === "antigravity") {
    bus.emit("notify", { level: "info", text: "Antigravity 的默认模型由 CLI 的 settings.json 管理，桌面端不写入 Pi 的默认值" });
    return;
  }
  try {
    await workbench.setModelDefaults({
      scope: "global",
      provider: model.provider,
      model: model.id,
      thinkingLevel,
    });
    await reloadDefaultModel();
    const modelName = model.name || model.id;
    const text = thinkingLevel
      ? `新会话默认：${modelName} · 思考 ${thinkingLabel(thinkingLevel)}`
      : `新会话默认：${modelName}`;
    bus.emit("notify", { level: "info", text });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

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
  // 56% 这种正常占用标成橙色会一直闪人眼，改成 70% 才提示、90% 才告警
  if (pct >= 90) return "high";
  if (pct > 70) return "mid";
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

function closeStats(): void {
  statsOpen.value = false;
}

/**
 * 点弹层外面就收起来。
 *
 * 弹层里的透明遮罩是 `position: fixed`，但输入框是玻璃质感（backdrop-filter），
 * fixed 会相对输入框定位 —— 那块遮罩其实只盖住输入框自己，点聊天区关不掉。
 * 所以这里补一个全局监听；同时监听窗口失焦（点到别的程序 / 桌面）。
 */
function onStatsOutside(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return;
  if (target.closest(".composer-stats-pop") || target.closest(".composer-context")) return;
  closeStats();
}

function bindStatsDismiss(open: boolean): void {
  if (typeof window === "undefined") return;
  if (open) {
    document.addEventListener("pointerdown", onStatsOutside, true);
    window.addEventListener("blur", closeStats);
  } else {
    document.removeEventListener("pointerdown", onStatsOutside, true);
    window.removeEventListener("blur", closeStats);
  }
}

watch(statsOpen, bindStatsDismiss);
onBeforeUnmount(() => bindStatsDismiss(false));

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

/**
 * 菜单里查不到时的一句话解释。
 *
 * Pi 有、桌面端做不了的那几条（/tree、/login…）不进菜单，但用户敲出来得知道
 * 为什么没有——否则看起来就像命令不存在。
 */
const emptyHint = computed(() => {
  if (menuMode.value !== "commands" || commandItems.value.length) return "";
  const query = (parsed.value?.name ?? "").toLowerCase();
  const match = PI_BUILTIN_COMMANDS.find(
    (command) => command.support === "terminal" && (!query || command.name.includes(query)),
  );
  return match ? `/${match.name} 只能在终端里用（Pi 的交互模式功能）` : "";
});
const optionItems = computed(() => {
  if (menuMode.value !== "options" || !parsed.value) return [];
  const q = parsed.value.arg.toLowerCase();
  const current =
    exact.value?.name === "model"
      ? ws.value?.model
        ? `${ws.value.model.provider}/${ws.value.model.id}`
        : ""
      : exact.value?.name === "thinking"
        ? ws.value?.thinking
        : "";
  return options.value
    .filter((o) => !q || `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q))
    .map((o) => ({ ...o, current: o.value === current }));
});
const menuItems = computed<any[]>(() => (menuMode.value === "options" ? optionItems.value : commandItems.value));
const pathToken = computed(() =>
  String(draft.value).trimStart().startsWith("!") ? null : parseMentionToken(draft.value),
);

/**
 * `@` 选择器里的候选分组。
 *
 * 核心只保留 Pi 自带的 `@` 文件 / 文件夹引用；对话引用（本项目、跨项目）都不是
 * Pi 的能力，由插件贡献 —— 停用插件后 `@` 就只剩文件补全。
 */
interface PickerGroup {
  id: string;
  title: string;
  /** 候选类型：会话引用用对话图标，其它来源按默认样式 */
  kind?: "session";
  items: Array<{ id: string; label: string; hint?: string; keywords?: string }>;
  source: any;
}
const pluginGroups = ref<PickerGroup[]>([]);
let pluginRequest = 0;

const pluginItemCount = computed(() => pluginGroups.value.reduce((sum, group) => sum + group.items.length, 0));
const pickerCount = computed(() => pluginItemCount.value + pathItems.value.length);

/** 分组在光标序列里的起始位置（插件分组 → 文件） */
function groupStart(index: number): number {
  let start = 0;
  for (let i = 0; i < index; i += 1) start += pluginGroups.value[i]?.items.length ?? 0;
  return start;
}

watch(
  () => [pathPicker.value, pathToken.value?.query, plugins.mentionSources.length],
  async () => {
    const sources = [...plugins.mentionSources];
    if (!pathPicker.value || !sources.length) {
      pluginGroups.value = [];
      return;
    }
    const request = ++pluginRequest;
    const query = pathToken.value?.query ?? "";
    // 每个来源都要等（可能走宿主调用），全部算完再一次性写入，避免界面闪
    const groups = await Promise.all(
      sources.map(async (source) => {
        try {
          const items = await source.search(query);
          return { id: source.id, title: source.title, kind: source.kind, items: items ?? [], source } as PickerGroup;
        } catch {
          return null;
        }
      }),
    );
    if (request !== pluginRequest) return;
    pluginGroups.value = groups.filter((group): group is PickerGroup => Boolean(group && group.items.length));
  },
  { deep: false },
);

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

/** 选中插件提供的候选（例如引用的对话）：交给来源自己处理。 */
async function pickPluginItem(group: PickerGroup, item: PickerGroup["items"][number]): Promise<void> {
  if (!group?.source) return;
  try {
    await group.source.pick(item);
  } catch (error) {
    notifyError(error);
    return;
  }
  // 这类候选同样是「加附件」，输入框里的 @query 要去掉
  draft.value = removeMentionToken(draft.value);
  closePathPicker();
  await nextTick();
  focus();
}

/** 回车/点击统一入口：插件分组 → 文件。 */
async function pickPickerRow(index: number): Promise<void> {
  let cursor = 0;
  for (const group of pluginGroups.value) {
    if (index < cursor + group.items.length) {
      await pickPluginItem(group, group.items[index - cursor]);
      return;
    }
    cursor += group.items.length;
  }
  await pickPath(pathItems.value[index - cursor]);
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
  const paths = await workbench.extractDroppedPaths(event.dataTransfer);
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

/** 开发模式下前端热更新而宿主未重启时，给出可操作的提示 */
function pasteError(error: any): Error {
  const message = String(error?.message ?? error ?? "");
  if (message.includes("No handler registered")) {
    return new Error("宿主还是旧版本：请完全退出并重新启动应用后再粘贴图片");
  }
  return error instanceof Error ? error : new Error(message || "粘贴图片失败");
}

/**
 * 输入框高度跟随内容。
 *
 * 空输入必须把内联高度交还给 CSS：之前只写「按 scrollHeight 设高度」，
 * 发完一段长文本后切到另一个会话时 draft 没变（都是空），watch 不触发，
 * 输入框就沿用上一段长文本的高度——看起来就是「有时候莫名其妙变高」。
 */
function autosize(): void {
  const el = input.value;
  if (!el) return;
  if (!el.value) {
    el.style.height = "";
    return;
  }
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
}
watch(draft, () => nextTick(() => {
  // `!` / `!!` 前缀不进入 textarea。键盘输入已经在 keydown 里拦下，
  // 这里兜住粘贴 / 输入法等直接走 input 事件的路径，避免前缀闪一下。
  const el = input.value;
  const expected = editorText.value;
  if (el && el.value !== expected) {
    const caret = el.selectionStart ?? expected.length;
    el.value = expected;
    const position = Math.min(caret, expected.length);
    el.selectionStart = el.selectionEnd = position;
  }
  autosize();
}));
// 换会话 / 换项目：draft 可能两边都是空的，必须显式重算一次
watch(() => ws.value?.sessionFile, () => nextTick(autosize));
watch(() => ws.value?.cwd, () => nextTick(autosize));
// 窗口变窄时空输入框的占位文案会换行，高度也要跟着重算
onMounted(() => window.addEventListener("resize", autosize));
onBeforeUnmount(() => window.removeEventListener("resize", autosize));

function focus(): void {
  // 会话加载完成、附件添加等异步回调会再次聚焦输入框；
  // 如果用户已经在快速打开 / 搜索 / 设置等输入框里，不能把焦点抢回来。
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== input.value) {
    if (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
  }
  input.value?.focus();
}

/**
 * 发送成功后让一颗光点从按钮飞向对话区底部：把「消息已经送进会话」这件事
 * 变成一个看得见的动作。只在支持 WAAPI 且没关动效时跑，不阻塞发送。
 */
function flyToConversation(originEl: HTMLElement | null): void {
  if (!originEl || typeof originEl.animate !== "function") return;
  if (document.documentElement.dataset.motion === "off") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const from = originEl.getBoundingClientRect();
  const target =
    document.querySelector(".timeline")?.getBoundingClientRect() ??
    document.querySelector(".chat-body")?.getBoundingClientRect();
  if (!target) return;
  const dot = document.createElement("span");
  dot.className = "send-fly";
  dot.style.left = `${from.left + from.width / 2}px`;
  dot.style.top = `${from.top + from.height / 2}px`;
  document.body.appendChild(dot);
  const toX = target.left + target.width / 2 - (from.left + from.width / 2);
  const toY = target.bottom - (from.top + from.height / 2) - 28;
  const anim = dot.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.7)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.18 },
      { transform: `translate(calc(-50% + ${toX}px), calc(-50% + ${toY}px)) scale(0.35)`, opacity: 0 },
    ],
    { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
  );
  anim.finished.finally(() => dot.remove());
}

async function submit(): Promise<void> {
  const text = draft.value;
  if ((!text.trim() && !attachments.value.length) || busy.value) return;
  // `!` / `!!`：直接跑 shell 命令，不发普通提示词（Pi 会把它记进会话）。
  const bash = bashInput.value;
  if (bash) {
    if (bashRunning.value) {
      bus.emit("notify", { level: "warning", text: "已有命令在运行，先停止它再执行新的命令" });
      return;
    }
    if (!bash.command) {
      bus.emit("notify", {
        level: "warning",
        text: `在 ${bash.excludeFromContext ? "!!" : "!"} 后面输入要运行的命令`,
      });
      return;
    }
    draft.value = "";
    const accepted = await workbench.runBash(bash.command, bash.excludeFromContext);
    // 没真正跑起来（Worker 未就绪等）时把输入还给用户，避免白敲一段命令。
    if (!accepted && !draft.value) draft.value = text;
    if (accepted) {
      rememberPrompt(text);
      historyState.value = { ...EMPTY_HISTORY_STATE };
    }
    nextTick(focus);
    return;
  }
  if (exact.value?.local && parsed.value) {
    await runLocal(exact.value, parsed.value.arg);
    return;
  }
  // Pi 有、但桌面端做不了的命令（/tree、/login、/share…）：它们不进菜单，
  // 但直接敲出来时也不能把 "/login" 当成普通文字发给模型——给一句能照做的说明。
  const unsupported = parsed.value ? findPiCommand(parsed.value.name) : undefined;
  if (unsupported && unsupported.support === "terminal") {
    draft.value = "";
    nextTick(focus);
    bus.emit("notify", { level: "warning", text: terminalCommandNotice(unsupported) });
    return;
  }
  draft.value = "";
  const sent = await workbench.send(text, { mode: mode.value });
  if (sent) flyToConversation(sendBtn.value);
  // 发送失败（附件失效、Worker 未就绪等）时把正文放回输入框，避免用户白打一段字。
  if (!sent && !draft.value) draft.value = text;
  if (sent) {
    rememberPrompt(text);
    historyState.value = { ...EMPTY_HISTORY_STATE };
  }
}

async function stop(): Promise<void> {
  try {
    // 队列里的消息会一起被清空并回填到输入框（只有人写的那部分，不带附件标记）
    const returned = await workbench.stop();
    if (returned) draft.value = [draft.value, returned].filter(Boolean).join("\n");
  } catch (error) {
    notifyError(error);
  }
  nextTick(focus);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  // 第一个 `!` 只切换 shell 模式，不进入输入框；`!` 再按一次切到 `!!`。
  if (event.key === "!" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const target = event.currentTarget as HTMLTextAreaElement | null;
    const atStart = target ? target.selectionStart === 0 && target.selectionEnd === 0 : false;
    if (atStart) {
      const next = toggleBashMode(draft.value);
      if (next !== draft.value) {
        event.preventDefault();
        draft.value = next;
        nextTick(autosize);
        return;
      }
    }
  }
  // 空命令时退格 = 退出 shell 模式（否则只会在空输入框里按一下没反应）。
  if (event.key === "Backspace" && bashInput.value && !bashInput.value.body) {
    event.preventDefault();
    exitBashMode();
    return;
  }
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
  if (
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    recallPrompt(event.key === "ArrowUp" ? -1 : 1)
  ) {
    event.preventDefault();
    return;
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
  if (event.key === "Escape" && bashRunning.value) {
    event.preventDefault();
    void abortBash();
    return;
  }
  if (event.key === "Escape" && ws.value?.streaming) stop();
}

const offSet = bus.on("composer:set", ({ cwd, sessionFile, text }: { cwd: string; sessionFile?: string; text: string }) => {
  const target = workbench.findWorkspace(cwd);
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
  () => {
    historyState.value = { ...EMPTY_HISTORY_STATE };
    nextTick(focus);
  },
);

const placeholder = computed(() => {
  if (bashInput.value) return "输入 shell 命令，Enter 运行…";
  if (ws.value?.streaming) return "继续输入，将按所选方式加入当前任务…";
  return hasHistory.value ? "继续这个任务，输入 / 命令，! 运行 shell" : "描述一个任务，输入 / 命令，! 运行 shell";
});
/**
 * 命令后面的参数占位提示（/resume + 空格 → <会话>）。
 *
 * 直接贴在正文后面画：多行时没法对齐，菜单打开时也不用提示。
 * 用户没打空格时补一个，否则会变成 /resume<会话>。
 */
const argHint = computed(() => {
  if (!exact.value || !parsed.value?.hasArg || parsed.value.arg || menuMode.value) return "";
  const args = (exact.value.args || "").trim();
  if (!args || draft.value.includes("\n")) return "";
  return `${/\s$/.test(draft.value) ? "" : " "}${args}`;
});

// ---------- `!` 命令（Pi TUI 的同一套写法） ----------
const bashInput = computed(() => parseBashInput(draft.value));
const bashRunning = computed(() => Boolean(ws.value?.activeThread?.bashRunning));

/**
 * 输入框里显示的内容：`!` / `!!` 只作为模式前缀，不进入 textarea。
 * 底下仍然存带前缀的字符串，草稿持久化 / 重启恢复后才不会退化成普通消息。
 */
const editorText = computed<string>({
  get: () => bashEditorText(draft.value),
  set: (value) => {
    draft.value = setBashEditorText(draft.value, value);
  },
});

function exitBashMode(): void {
  draft.value = "";
  nextTick(focus);
}

/** 输入框上方的提示：`!` 与 `!!` 的区别必须在动手前说清楚。 */
const bashHint = computed(() => {
  const bash = bashInput.value;
  if (!bash) return null;
  const mark = bash.excludeFromContext ? "!!" : "!";
  if (bashRunning.value) {
    return {
      mark,
      title: "已有命令在运行",
      detail: "按 Esc 或点卡片上的「停止」先中断它",
      exclude: bash.excludeFromContext,
      running: true,
    };
  }
  if (!bash.command) {
    return {
      mark,
      title: "输入要运行的命令",
      detail: bash.excludeFromContext ? "输出只留在会话记录，不交给模型" : "输出会在下一次提问时交给模型",
      exclude: bash.excludeFromContext,
      running: false,
    };
  }
  return {
    mark,
    title: "将在项目目录运行",
    detail: bash.excludeFromContext ? "输出只留在会话记录，不交给模型" : "输出会在下一次提问时交给模型",
    exclude: bash.excludeFromContext,
    running: false,
  };
});

async function abortBash(): Promise<void> {
  await workbench.abortBash();
  nextTick(focus);
}
</script>

<template>
  <div class="composer-wrap">
    <div class="composer-inner">
      <Widgets />

      <!-- 编辑排队消息：清空队列 → 其余原样重新入队 → 这条换成新文字 -->
      <div v-if="queueEdit" class="queue-strip queue-strip-editing">
        <span class="queue-label">
          <span class="queue-dot" />
          编辑排队消息
        </span>
        <div class="queue-editor">
          <!-- 附件单独列出来：提示词里已有的块不会被写进正文，避免重复出一份图片路径 -->
          <div v-if="queueEditBlocks.length || queueEditAdded.length" class="queue-editor-attachments">
            <span
              v-for="block in queueEditBlocks"
              :key="block.path"
              class="queue-attach-chip"
              :title="block.path"
            >
              <span class="queue-attach-icon" v-html="block.kind === 'session' ? icons.message : block.kind === 'directory' ? icons.folder : icons.file" />
              <span class="queue-attach-name">{{ block.name }}</span>
              <button
                type="button"
                class="queue-attach-remove"
                :aria-label="`移除附件：${block.name}`"
                @click="removeQueueEditBlock(block.path)"
              >×</button>
            </span>
            <span
              v-for="item in queueEditAdded"
              :key="item.path"
              class="queue-attach-chip added"
              :title="item.path"
            >
              <span class="queue-attach-icon" v-html="icons.image" />
              <span class="queue-attach-name">{{ item.name }}</span>
              <button
                type="button"
                class="queue-attach-remove"
                :aria-label="`移除附件：${item.name}`"
                @click="removeQueueEditAdded(item.path)"
              >×</button>
            </span>
          </div>
          <textarea
            v-model="queueEditDraft"
            rows="2"
            spellcheck="false"
            placeholder="修改这条要发送的内容（可 Ctrl+V 粘贴图片）"
            @keydown.enter.exact.prevent="saveQueueEdit"
            @keydown.esc.prevent="closeQueueEdit"
            @paste="onQueueEditPaste"
          />
          <div class="queue-editor-actions">
            <span class="queue-editor-hint">
              {{ queueEdit.mode === "steer" ? "插话" : "排队" }} · Enter 保存 · Esc 取消 · Ctrl+V 粘贴图片
            </span>
            <button type="button" class="btn ghost small" @click="closeQueueEdit">取消</button>
            <button
              type="button"
              class="btn primary small"
              :disabled="queueEditBusy || (!queueEditDraft.trim() && !queueEditKept.length && !queueEditAdded.length)"
              @click="saveQueueEdit"
            >
              保存并重新排队
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="queuePending.length" class="queue-strip">
        <!-- 一条细栏：条数 + 全部撤回（不占视觉重心） -->
        <div class="queue-strip-head">
          <span class="queue-label">{{ queuePending.length }} 条待发送</span>
          <button type="button" class="queue-recall" :disabled="queueBusy" @click="recallQueue">全部撤回</button>
        </div>
        <!-- 卡片单独一层：排队很长时只滚这一层，表头和输入框不动 -->
        <div class="queue-list" role="list">
          <template v-for="(item, i) in queuePending" :key="i">
            <div
              class="queue-card"
              :class="[
                item.mode,
                {
                  dragging: queueDrag === i,
                  'drop-before': queueDrop && queueDrop.index === i && !queueDrop.after,
                  'drop-after': queueDrop && queueDrop.index === i && queueDrop.after,
                  'can-drag': !queueBusy,
                },
              ]"
              :draggable="!queueBusy"
              tabindex="0"
              role="listitem"
              :aria-label="queueCardLabel(i)"
              @dragstart="onQueueDragStart(i, $event)"
              @dragover="onQueueDragOver(i, $event)"
              @drop="onQueueDrop(i, $event)"
              @dragend="onQueueDragEnd"
              @keydown.alt.up.prevent="moveQueued(i, -1)"
              @keydown.alt.down.prevent="moveQueued(i, 1)"
            >
              <span
                class="queue-card-grip"
                title="拖动调整发送顺序（聚焦后 Alt+↑ / Alt+↓）"
                aria-hidden="true"
              />
              <div class="queue-card-main">
                <!-- 附件单独一行：只要文件名（不要图标、不要大小） -->
                <div v-if="queueCards[i]?.attachments.length" class="queue-card-files">
                  <span
                    v-for="att in queueCards[i].attachments"
                    :key="att.path"
                    class="queue-file-name"
                    :title="att.path"
                  >{{ att.name }}</span>
                </div>
                <!-- 投递方式 + 单行正文 + 悬停才现的图标操作 -->
                <div class="queue-card-line">
                  <SelectMenu
                    class="queue-card-mode"
                    size="sm"
                    :model-value="item.mode"
                    :disabled="queueBusy"
                    align="left"
                    aria-label="这条消息怎么发出去"
                    title="引导 = 立刻插入当前回合；排队 = 等本轮结束再发"
                    :options="[
                      { value: 'steer', label: '引导', hint: '立刻插入' },
                      { value: 'followUp', label: '排队', hint: '本轮结束' },
                    ]"
                    @change="(mode) => switchQueuedMode(item, mode as 'steer' | 'followUp')"
                  />
                  <button
                    v-if="queueCards[i]?.text"
                    type="button"
                    class="queue-card-text"
                    :title="queuePreview(item.text, 400)"
                    :aria-label="`编辑这条消息：${queuePreview(item.text, 40)}`"
                    @click="openQueueEdit({ mode: item.mode, prompt: item.text })"
                  >
                    {{ queueCards[i]?.text }}
                  </button>
                  <span v-else class="queue-card-text is-empty">（只有附件）</span>
                  <span class="queue-card-actions">
                    <button
                      type="button"
                      class="queue-card-icon"
                      title="编辑这条消息"
                      aria-label="编辑这条消息"
                      @click="openQueueEdit({ mode: item.mode, prompt: item.text })"
                    >
                      <span v-html="icons.edit" />
                    </button>
                    <button
                      type="button"
                      class="queue-card-icon is-withdraw"
                      :disabled="queueBusy"
                      :title="`撤回这条消息：${queuePreview(item.text, 40)}`"
                      :aria-label="`撤回这条消息：${queuePreview(item.text, 40)}`"
                      @click="withdrawQueued(item)"
                    >
                      <span v-html="icons.undo" />
                    </button>
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
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
              <span>文件与对话</span>
              <span v-if="pathToken?.query" class="path-picker-query">{{ pathToken.query }}</span>
            </div>
            <button class="path-picker-close" title="关闭（Esc）" aria-label="关闭" @click="closePathPicker">×</button>
          </div>
          <div ref="pathList" class="path-picker-list" role="listbox" aria-label="文件和文件夹">
            <template v-for="(group, groupIndex) in pluginGroups" :key="group.id">
              <div class="path-picker-section">{{ group.title }}</div>
              <button
                v-for="(item, index) in group.items"
                :key="item.id"
                class="path-picker-item path-picker-plugin"
                :class="{
                  active: groupStart(groupIndex) + index === pathCursor,
                  'path-picker-session': group.kind === 'session',
                }"
                :aria-selected="groupStart(groupIndex) + index === pathCursor"
                :data-mention-source="group.id"
                role="option"
                @mouseenter="pathCursor = groupStart(groupIndex) + index"
                @click="pickPluginItem(group, item)"
              >
                <span class="path-item-icon session" v-html="icons.chat" />
                <span class="path-item-name">{{ item.label }}</span>
                <span class="path-item-relative">{{ item.hint }}</span>
              </button>
            </template>
            <div v-if="pathLoading" class="path-picker-state"><span class="mini-spinner" />正在搜索…</div>
            <template v-if="pathItems.length">
              <div v-if="pluginItemCount" class="path-picker-section">文件与文件夹</div>
              <button
                v-for="(item, index) in pathItems"
                :key="item.path"
                class="path-picker-item"
                :class="{ active: pluginItemCount + index === pathCursor }"
                :aria-selected="pluginItemCount + index === pathCursor"
                role="option"
                @mouseenter="pathCursor = pluginItemCount + index"
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
          :empty-hint="emptyHint"
          @hover="(i) => (cursor = i)"
          @pick="(item) => pick(item)"
        />

        <div v-if="bashHint" class="bash-hint" :data-mode="bashHint.exclude ? 'exclude' : 'include'" :data-running="bashHint.running || undefined">
          <span class="bash-hint-mark">{{ bashHint.mark }}</span>
          <span class="bash-hint-title">{{ bashHint.title }}</span>
          <span class="bash-hint-detail" :title="bashHint.detail">{{ bashHint.detail }}</span>
          <span class="bash-hint-key">
            <template v-if="bashHint.running"><kbd>Esc</kbd> 停止当前命令</template>
            <template v-else><kbd>Enter</kbd> 运行</template>
          </span>
          <button type="button" class="bash-hint-close" title="退出 shell 模式" aria-label="退出 shell 模式" @click="exitBashMode">×</button>
        </div>

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
              :class="{ session: item.kind === 'session', edited: Boolean(item.customText) }"
              :title="item.kind === 'session' ? `引用对话：${item.name}（点击编辑注入的上下文）` : item.path"
              :data-quote-chip="item.kind === 'session' ? item.path : undefined"
              @click="item.kind === 'session' && openQuoteEditor(item)"
            >
              <span
                class="attachment-chip-icon"
                v-html="item.kind === 'session' ? icons.chat : item.kind === 'folder' ? icons.folder : icons.attach"
              />
              <span>{{ item.name }}</span>
              <span v-if="item.kind === 'session' && item.messages" class="attachment-chip-meta">{{ item.messages }} 条</span>
              <span v-else-if="item.size" class="attachment-chip-meta">{{ formatBytes(item.size) }}</span>
              <span v-if="item.customText" class="attachment-chip-edited" title="上下文已手动修改">已编辑</span>
              <button type="button" :title="item.kind === 'session' ? '移除对话引用' : '移除附件'" @click.stop="removeAttachment(item.path)">×</button>
            </span>
          </div>
          <!-- 输入框与参数提示必须同一个相对容器：挂在 .composer-field 上会被附件条顶偏，画到附件上面去 -->
          <div class="composer-input">
            <textarea
              ref="input"
              v-model="editorText"
              rows="1"
              :placeholder="placeholder"
              spellcheck="false"
              @keydown="onKeydown"
              @keyup="onAtKey"
              @contextmenu="openComposerMenu"
            />
            <span v-if="argHint" class="arg-hint" aria-hidden="true"><span class="arg-ghost">{{ draft }}</span>{{ argHint }}</span>
          </div>
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
            <SelectMenu
              v-if="ws"
              class="composer-agent-menu"
              :model-value="ws.agent || ''"
              size="sm"
              align="left"
              placeholder="选择 Agent"
              aria-label="选择新会话的 Agent"
              title="选择新会话使用的 Agent；切换会按项目记住，并开启一个新会话"
              :disabled="agentBusy || Boolean(ws.streaming) || Boolean(ws.hasAnyRunning)"
              :options="agentOptions"
              @change="onSelectAgent"
            />
            <ModelThinkingPicker
              v-if="ws?.models?.length"
              :models="ws.models"
              :current-model="ws.model"
              :current-thinking="ws.thinking"
              :available-levels="ws.levels"
              :default-model-ref="defaultModelRef"
              :default-thinking="defaultThinkingRef"
              @opened="reloadDefaultModel"
              @select-model="onSelectModel"
              @select-thinking="onSelectThinking"
              @set-default="onSetDefaultModelAndThinking"
            />
            <button
              v-if="ws"
              type="button"
              class="bar-btn"
              title="创建 Git Worktree（隔离工作区）并加载当前对话或草稿"
              @click="
                openWorktreeDialog({
                  cwd: ws.cwd,
                  sessionFile: (ws.blocks?.length ?? 0) > 0 ? ws.sessionFile : '',
                  initialPrompt: draft,
                })
              "
              v-html="icons.branch"
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
                  v-if="contextPercent"
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
              ref="sendBtn"
              class="send-btn"
              :class="{ ready: (draft.trim() || attachments.length) && !busy && Boolean(ws?.agent) }"
              :disabled="(!draft.trim() && !attachments.length) || busy || !ws?.agent"
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
    <QuoteEditor
      :open="quoteEditor.open"
      :file="quoteEditor.file"
      :title="quoteEditor.title"
      :auto-text="quoteEditor.autoText"
      :custom-text="quoteEditor.customText"
      :messages="quoteEditor.messages"
      :size="quoteEditor.size"
      :busy="quoteBusy"
      @close="closeQuoteEditor"
      @save="saveQuoteEditor"
    />
  </div>
</template>
