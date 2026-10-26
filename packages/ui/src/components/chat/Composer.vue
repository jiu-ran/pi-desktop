<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { formatTokens, icons, thinkingLabel } from "../../shared/util.ts";
import { formatBytes, imageDataUrl } from "../../shared/attachments.ts";
import { contextBar, formatCost, usageParts } from "../../shared/session-stats.ts";
import { applyMention, parseMentionToken, removeMentionToken } from "../../shared/mentions.ts";
import { planQueueMove, planQueueView, queueDraftText, queuePreview, splitPromptBlocks, type PromptBlock } from "../../shared/queue-view.ts";
import QuoteEditor from "./QuoteEditor.vue";
import SelectMenu from "../shared/SelectMenu.vue";
import { filterCommands, mergeCommands, parseSlash, type SlashCommandItem } from "../../services/slash-commands.ts";
import { appSettings } from "../../services/settings.ts";
import type { WorkspaceEntry } from "../../env.d.ts";
import Picker from "./Picker.vue";
import SlashMenu from "./SlashMenu.vue";
import ImageLightbox from "./ImageLightbox.vue";
import Widgets from "../overlays/Widgets.vue";

const { workbench, slashCommands, bus, plugins } = useKernel();
// 气泡上的「编辑」入口通过 bus 传上来：气泡在对话区，编辑框在输入框上方
const stopQueueEditListener = bus.on("queue:edit", onQueueEditRequest);
onBeforeUnmount(stopQueueEditListener);
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

/**
 * 还排在队列里的消息统一列在输入框上方（含插话与排队两种），
 * 对话里那张乐观气泡由 AgentChat 暂时隐藏，避免同一条消息出现两次。
 */
const queuePlan = computed(() =>
  planQueueView((ws.value?.blocks ?? []) as any[], ws.value?.queue ?? { steering: [], followUp: [] }),
);
const queuePending = computed(() => queuePlan.value.entries);
const queueBusy = ref(false);

/** 排队消息编辑：预填「用户写的话」，附件单独列成标签，支持 Ctrl+V 粘贴图片。 */
const queueEdit = ref<{
  mode: "steer" | "followUp";
  prompt: string;
  blocks: PromptBlock[];
} | null>(null);
const queueEditDraft = ref("");
const queueEditBusy = ref(false);
/** 编辑期间新粘贴的附件（保存时由内核重新 prepare 成 <file> 标记） */
const queueEditAdded = ref<Array<{ path: string; name: string }>>([]);

function startQueueEdit(mode: "steer" | "followUp", prompt: string): void {
  // 预填只能取「用户写的话」：附件块单独列出来，否则 [文件: …] 标签会被写回提示词，
  // 保存后气泡上就多出一条重复的图片路径。
  queueEdit.value = { mode, prompt, blocks: splitPromptBlocks(prompt).blocks };
  queueEditDraft.value = queueDraftText(prompt);
  queueEditAdded.value = [];
  nextTick(() => {
    const area = document.querySelector<HTMLTextAreaElement>(".queue-editor textarea");
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  });
}

function openQueueEdit(entry: { mode: "steer" | "followUp"; prompt: string }): void {
  startQueueEdit(entry.mode, entry.prompt);
}

function closeQueueEdit(): void {
  queueEdit.value = null;
  queueEditDraft.value = "";
  queueEditAdded.value = [];
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

async function saveQueueEdit(): Promise<void> {
  const entry = queueEdit.value;
  const text = queueEditDraft.value.trim();
  if (!entry || queueEditBusy.value) return;
  if (!text && !entry.blocks.length && !queueEditAdded.value.length) return;
  queueEditBusy.value = true;
  try {
    const ok = await workbench.editQueued(
      { mode: entry.mode, text: entry.prompt },
      { message: text, addPaths: queueEditAdded.value.map((item) => item.path) },
    );
    if (ok) closeQueueEdit();
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
    // 正在编辑这条的话，把编辑框一起收起
    if (queueEdit.value && normalizePrompt(queueEdit.value.prompt) === normalizePrompt(item.text)) {
      closeQueueEdit();
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

/** 分组说明：只在每组第一条前面出现一次，一眼看出会怎么发出去 */
function queueGroupNote(index: number): string {
  const list = queuePending.value;
  const item = list[index];
  if (!item) return "";
  if (list.findIndex((entry) => entry.mode === item.mode) !== index) return "";
  return item.mode === "steer" ? "引导 · 立刻插入当前回合" : "排队 · 本轮结束后按顺序发送";
}

function normalizePrompt(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

async function recallQueue(): Promise<void> {
  if (queueBusy.value) return;
  queueBusy.value = true;
  try {
    const text = await workbench.recallQueued();
    if (text) draft.value = [draft.value, text].filter(Boolean).join("\n");
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
    // 每个来源都要等（可能走 IPC），全部算完再一次性写入，避免界面闪
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
watch(draft, () => nextTick(autosize));
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
          <div v-if="queueEdit.blocks.length || queueEditAdded.length" class="queue-editor-attachments">
            <span
              v-for="block in queueEdit.blocks"
              :key="block.path"
              class="queue-attach-chip"
              :title="block.path"
            >
              <span class="queue-attach-icon" v-html="block.kind === 'session' ? icons.message : block.kind === 'directory' ? icons.folder : icons.file" />
              <span class="queue-attach-name">{{ block.name }}</span>
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
              :disabled="queueEditBusy || (!queueEditDraft.trim() && !queueEdit.blocks.length && !queueEditAdded.length)"
              @click="saveQueueEdit"
            >
              保存并重新排队
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="queuePending.length" class="queue-strip">
        <div class="queue-strip-head">
          <span class="queue-label">
            <span class="queue-dot" />
            {{ queuePending.length }} 条待发送
          </span>
          <button type="button" class="queue-recall" :disabled="queueBusy" @click="recallQueue">全部撤回</button>
        </div>
        <template v-for="(item, i) in queuePending" :key="i">
          <div v-if="queueGroupNote(i)" class="queue-group-note" :class="item.mode">
            <span class="queue-group-line" />
            {{ queueGroupNote(i) }}
            <span class="queue-group-line" />
          </div>
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
            :title="queuePreview(item.text, 400)"
            @dragstart="onQueueDragStart(i, $event)"
            @dragover="onQueueDragOver(i, $event)"
            @drop="onQueueDrop(i, $event)"
            @dragend="onQueueDragEnd"
          >
          <span class="queue-card-grip" title="拖动调整发送顺序" aria-hidden="true" v-html="icons.more" />
          <span class="queue-card-badge">
            <span class="queue-dot" />
            待发送
          </span>
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
            type="button"
            class="queue-card-text"
            :aria-label="`编辑这条消息：${queuePreview(item.text, 40)}`"
            @click="openQueueEdit({ mode: item.mode, prompt: item.text })"
          >
            {{ queuePreview(item.text, 160) }}
          </button>
          <span class="queue-card-actions">
            <button
              type="button"
              class="queue-card-edit"
              aria-label="编辑这条消息"
              @click="openQueueEdit({ mode: item.mode, prompt: item.text })"
            >
              编辑
            </button>
            <button
              type="button"
              class="queue-card-withdraw"
              :disabled="queueBusy"
              :aria-label="`撤回这条消息：${queuePreview(item.text, 40)}`"
              @click="withdrawQueued(item)"
            >
              撤回
            </button>
          </span>
          </div>
        </template>
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
              v-model="draft"
              rows="1"
              :placeholder="placeholder"
              spellcheck="false"
              @keydown="onKeydown"
              @keyup="onAtKey"
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
