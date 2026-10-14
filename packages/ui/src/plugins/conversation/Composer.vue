<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons, thinkingLabel } from "../../shared/util.ts";
import Picker from "./Picker.vue";
import SlashMenu from "./SlashMenu.vue";
import { filterCommands, mergeCommands, parseSlash } from "./slash.ts";

/**
 * 输入框（参考 Air）：上方是文本区，底栏左侧 + / 模型 / 思考，右侧发送方式与发送。
 * 模型与思考等级写回 Pi（set_model / set_thinking_level），由 Pi 自己保存。
 *
 * 斜杠命令：桌面端 slash 贡献点（Pi 内置命令的 RPC 实现）+ Pi 的 get_commands
 *（扩展 / 提示模板 / 技能）。前者在本地执行，后者原样交给 Pi。
 */
const { workbench, contributions, bus } = useKernel();
const ws = computed(() => workbench.active.value);
const input = ref(null);
const mode = ref("followUp");
const cursor = ref(0);
const dismissed = ref("");
const options = ref([]);
const optionsLoading = ref(false);
const busy = ref(false);
const pathPicker = ref(false);
const pathCursor = ref(0);
const pathItems = ref([]);
const pathList = ref(null);
const pathLoading = ref(false);
let pathRequest = 0;

const draft = computed({
  get: () => ws.value?.draft ?? "",
  set: (value) => { if (ws.value) ws.value.draft = value; },
});

const addons = computed(() => contributions.points["composer.addons"]);
const queued = computed(() => [...(ws.value?.queue.steering ?? []), ...(ws.value?.queue.followUp ?? [])]);
const attachments = computed(() => ws.value?.attachments ?? []);
const hasHistory = computed(() => (ws.value?.blocks.length ?? 0) > 0);

const modelItems = computed(() => (ws.value?.models ?? []).map((m) => ({
  value: `${m.provider}/${m.id}`, label: m.name || m.id, hint: m.provider, model: m,
})));
const modelValue = computed(() => (ws.value?.model ? `${ws.value.model.provider}/${ws.value.model.id}` : ""));
const modelLabel = computed(() => ws.value?.model?.name || ws.value?.model?.id || "选择模型");
const levelItems = computed(() => (ws.value?.levels ?? []).map((level) => ({ value: level, label: thinkingLabel(level), hint: level })));
const modeItems = [
  { value: "followUp", label: "排队", hint: "当前任务结束后发送" },
  { value: "steer", label: "引导", hint: "插入到当前任务" },
];

// ---------- 斜杠命令 ----------
const allCommands = computed(() => mergeCommands(contributions.points.slash, ws.value?.commands ?? []));
const parsed = computed(() => parseSlash(draft.value));
const exact = computed(() => (parsed.value ? allCommands.value.find((c) => c.name === parsed.value.name) ?? null : null));

/** commands：在输命令名；options：在给带选项的本地命令选参数；null：不显示菜单 */
const menuMode = computed(() => {
  if (!parsed.value || dismissed.value === draft.value) return null;
  if (!parsed.value.hasArg) return "commands";
  if (exact.value?.local?.options) return "options";
  return null;
});
const commandItems = computed(() => (menuMode.value === "commands" ? filterCommands(allCommands.value, parsed.value.name) : []));
const optionItems = computed(() => {
  if (menuMode.value !== "options") return [];
  const q = parsed.value.arg.toLowerCase();
  const current = exact.value?.name === "model" ? modelValue.value : exact.value?.name === "thinking" ? ws.value?.thinking : "";
  return options.value
    .filter((o) => !q || `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase().includes(q))
    .map((o) => ({ ...o, current: o.value === current }));
});
const menuItems = computed(() => (menuMode.value === "options" ? optionItems.value : commandItems.value));
const pathToken = computed(() => {
  const match = draft.value.match(/(?:^|\s)@([^\s]*)$/);
  return match ? { query: match[1], start: draft.value.length - match[1].length - 1 } : null;
});
watch(() => [pathPicker.value, draft.value, ws.value?.cwd], async () => {
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
    if (request === pathRequest) { pathItems.value = result; pathCursor.value = 0; }
  } catch (error) {
    if (request === pathRequest) { pathItems.value = []; notifyError(error); }
  } finally {
    if (request === pathRequest) pathLoading.value = false;
  }
});
watch(() => [menuMode.value, parsed.value?.name, parsed.value?.arg], () => { cursor.value = 0; });
watch(() => [pathCursor.value, pathItems.value.length, pathPicker.value], async () => {
  await nextTick();
  const list = pathList.value;
  const item = list?.querySelector?.(".path-picker-item.active");
  item?.scrollIntoView({ block: "nearest" });
});

// 进入参数选择时加载选项（可能是异步的，如 /fork 要向 Pi 取可分叉的消息）
watch(() => (menuMode.value === "options" ? exact.value?.key : ""), async (key) => {
  options.value = [];
  if (!key) return;
  optionsLoading.value = true;
  try {
    options.value = (await exact.value.local.options()) ?? [];
  } catch (error) {
    notifyError(error);
  } finally {
    optionsLoading.value = false;
  }
});

function notifyError(error) {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

async function runLocal(cmd, arg) {
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

/** 从命令列表里选中一项。complete=true 时只补全不执行（Tab） */
function pickCommand(cmd, complete = false) {
  if (!cmd) return;
  // 需要参数、或只是补全：填入命令名，等待输入参数
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

function pickOption(option) {
  if (option && exact.value?.local) runLocal(exact.value, option.value);
}

function pick(item, complete = false) {
  if (menuMode.value === "options") pickOption(item);
  else pickCommand(item, complete);
}

function insertSlash() {
  if (!draft.value.startsWith("/")) draft.value = `/${draft.value}`;
  dismissed.value = "";
  nextTick(focus);
}

async function addFiles() {
  try { await workbench.chooseFiles(); } catch (error) { notifyError(error); }
}

async function addFolder() {
  try { await workbench.chooseFolder(); } catch (error) { notifyError(error); }
}

function removeAttachment(file) {
  workbench.removeAttachment(file);
}

function onAtKey(event) {
  if (event.key !== "@" || event.ctrlKey || event.metaKey || event.altKey) return;
  requestAnimationFrame(() => { pathPicker.value = Boolean(pathToken.value); });
}

function closePathPicker() {
  pathPicker.value = false;
  pathItems.value = [];
  pathLoading.value = false;
  pathRequest += 1;
}

async function pickPath(item) {
  if (!item) return;
  try {
    await workbench.addFiles([item.path]);
    const token = pathToken.value;
    if (token) draft.value = draft.value.slice(0, token.start);
    closePathPicker();
    nextTick(focus);
  } catch (error) { notifyError(error); }
}

function pathIcon(item) {
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
function closeAttachMenu(event) {
  if (!event.target.closest?.(".attach-popover") && !event.target.closest?.(".bar-btn.attach")) attachMenu.value = false;
}

// ---------- 输入与发送 ----------
function autosize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
}
watch(draft, () => nextTick(autosize));

function focus() {
  input.value?.focus();
}

async function submit() {
  const text = draft.value;
  if ((!text.trim() && !attachments.value.length) || busy.value) return;
  // 本地命令：/compact 要求、/name 名称、/model 提供方/模型 等
  if (exact.value?.local) {
    await runLocal(exact.value, parsed.value.arg);
    return;
  }
  draft.value = "";
  await workbench.send(text, { mode: mode.value });
}

async function stop() {
  const returned = await workbench.stop();
  if (returned) draft.value = [draft.value, returned].filter(Boolean).join("\n");
}

function onKeydown(event) {
  if (event.isComposing) return;
  if (pathPicker.value) {
    const count = pathItems.value.length;
    if (event.key === "ArrowDown" && count) { pathCursor.value = (pathCursor.value + 1) % count; event.preventDefault(); return; }
    if (event.key === "ArrowUp" && count) { pathCursor.value = (pathCursor.value - 1 + count) % count; event.preventDefault(); return; }
    if (event.key === "Escape") { closePathPicker(); event.preventDefault(); return; }
    if (event.key === "Enter" && !event.shiftKey && count) { pickPath(pathItems.value[pathCursor.value]); event.preventDefault(); return; }
  }
  if (menuMode.value) {
    const count = menuItems.value.length;
    if (event.key === "ArrowDown" && count) { cursor.value = (cursor.value + 1) % count; event.preventDefault(); return; }
    if (event.key === "ArrowUp" && count) { cursor.value = (cursor.value - 1 + count) % count; event.preventDefault(); return; }
    if (event.key === "Escape") { dismissed.value = draft.value; event.preventDefault(); return; }
    if (event.key === "Tab" && count) { pick(menuItems.value[cursor.value], true); event.preventDefault(); return; }
    if (event.key === "Enter" && !event.shiftKey) {
      // 参数模式下没有匹配项时，按输入的文本执行（如 /model provider/id）
      if (count && !(menuMode.value === "options" && !optionItems.value.length)) {
        event.preventDefault();
        pick(menuItems.value[cursor.value]);
        return;
      }
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === "Escape" && ws.value?.streaming) stop();
}

// 扩展可以通过 set_editor_text 预填输入框
const offSet = bus.on("composer:set", ({ cwd, text }) => {
  const target = workbench.workspaces.get(cwd);
  if (target) target.draft = text;
});
onBeforeUnmount(offSet);
onMounted(() => {
  focus();
  autosize();
  document.addEventListener("mousedown", closeAttachMenu);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", closeAttachMenu));
watch(() => ws.value?.sessionFile, () => nextTick(focus));

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
      <component :is="addon.component" v-for="addon in addons" :key="addon.id" />

      <div v-if="queued.length" class="queue-strip">
        <span class="queue-label">待发送 {{ queued.length }}</span>
        <span v-for="(item, i) in queued" :key="i" class="queue-chip" :title="item">{{ item }}</span>
      </div>

      <div class="composer" :class="{ busy: ws?.streaming }" @mousedown.self="focus">
        <div v-if="pathPicker" class="path-picker" @mousedown.stop>
          <div class="path-picker-head">
            <div class="path-picker-title">
              <span class="path-picker-at">@</span>
              <span>Files and Folders</span>
              <span v-if="pathToken?.query" class="path-picker-query">{{ pathToken.query }}</span>
            </div>
            <button class="path-picker-close" title="关闭（Esc）" aria-label="关闭" @click="closePathPicker">×</button>
          </div>
          <div ref="pathList" class="path-picker-list" role="listbox" aria-label="文件和文件夹">
            <div v-if="pathLoading" class="path-picker-state"><span class="mini-spinner" />正在搜索…</div>
            <button
              v-for="(item, index) in pathItems"
              :key="item.path"
              class="path-picker-item"
              :class="{ active: index === pathCursor }"
              :aria-selected="index === pathCursor"
              role="option"
              @mouseenter="pathCursor = index"
              @click="pickPath(item)"
            >
              <span class="path-item-icon" :class="pathIcon(item).className" v-html="pathIcon(item).icon" />
              <span class="path-item-name">{{ item.name }}</span>
              <span class="path-item-relative">{{ item.relative }}</span>
            </button>
            <div v-if="!pathLoading && !pathItems.length" class="path-picker-state">没有匹配的文件或文件夹</div>
          </div>
          <div class="path-picker-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span><kbd>Enter</kbd> 选择</span>
            <span><kbd>Esc</kbd> 关闭</span>
            <span v-if="pathItems.length" class="path-picker-count">{{ pathItems.length }} 项</span>
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
            <span v-for="item in attachments" :key="item.path" class="attachment-chip" :title="item.path">
              <span class="attachment-chip-icon" v-html="item.kind === 'folder' ? icons.folder : item.image ? icons.image : icons.attach" />
              <span>{{ item.name }}</span>
              <button type="button" title="移除附件" @click="removeAttachment(item.path)">×</button>
            </span>
          </div>
          <textarea
            ref="input"
            v-model="draft"
            rows="2"
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
              @pick="(item) => workbench.setThinking(item.value)"
            />
          </div>
          <div class="composer-right">
            <Picker
              v-if="ws?.streaming"
              :items="modeItems"
              :value="mode"
              :label="mode === 'steer' ? '引导' : '排队'"
              title="运行中发送的方式"
              align="right"
              @pick="(item) => (mode = item.value)"
            />
            <button v-if="ws?.streaming" class="send-btn stop" title="停止（Esc）" @click="stop">
              <span v-html="icons.stop" />停止
            </button>
            <button
              class="send-btn"
              :class="{ ready: (draft.trim() || attachments.length) && !busy }"
              :disabled="(!draft.trim() && !attachments.length) || busy"
              title="Enter 发送 · Shift+Enter 换行"
              @click="submit"
            >
              <span v-if="busy" class="mini-spinner" />
              {{ exact?.local ? "执行" : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
