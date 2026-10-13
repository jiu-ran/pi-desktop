<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import Composer from "./components/Composer.vue";
import EmptyState from "./components/EmptyState.vue";
import SessionList from "./components/SessionList.vue";
import SidePanel from "./components/SidePanel.vue";
import TopBar from "./components/TopBar.vue";
import Transcript from "./components/Transcript.vue";
import WorkspaceList from "./components/WorkspaceList.vue";

const desktop = window.piDesktop;
const pi = ref({ found: false, version: "" });
const workspaces = ref([]);
const sessions = reactive({});
const messages = reactive({});
const models = ref([]);
const levels = ref(["off"]);
const activeWorkspace = ref("");
const activeSession = ref("");
const draft = ref("");
const running = ref(false);
const queue = ref([]);
const panel = ref("");
const theme = ref(localStorage.getItem("pi-desktop-theme") === "light" ? "light" : "dark");

watch(theme, (value) => {
  document.documentElement.dataset.theme = value;
  localStorage.setItem("pi-desktop-theme", value);
}, { immediate: true });
const model = ref("");
const thinking = ref("medium");
const errorText = ref("");
const terminalLines = ref([]);

const sessionList = computed(() => sessions[activeWorkspace.value] ?? []);
const transcript = computed(() => messages[activeSession.value] ?? []);
const workspace = computed(
  () => workspaces.value.find((item) => item.id === activeWorkspace.value) ?? { name: "未打开", path: "" },
);
const modelLabels = computed(() => models.value.map((item) => `${item.provider}/${item.id}`));

function currentMessages() {
  if (!messages[activeSession.value]) messages[activeSession.value] = [];
  return messages[activeSession.value];
}

function applyState(state) {
  model.value = state.model ? `${state.model.provider}/${state.model.id}` : "未选择模型";
  thinking.value = state.thinkingLevel ?? "off";
  running.value = Boolean(state.isStreaming);
  activeSession.value = state.sessionFile || state.sessionId || activeSession.value;
}

function displayMessages(source) {
  return source.flatMap((message) => {
    if (message.role === "user") {
      const text = typeof message.content === "string"
        ? message.content
        : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
      return text ? [{ id: message.id ?? crypto.randomUUID(), role: "user", text }] : [];
    }
    if (message.role !== "assistant") return [];
    return (message.content ?? []).map((part, index) => {
      if (part.type === "thinking") return { id: `${message.id}-t${index}`, role: "thinking", text: part.thinking };
      if (part.type === "toolCall") return { id: part.id, role: "tool", name: part.name, state: "调用", text: JSON.stringify(part.arguments ?? {}) };
      return { id: `${message.id}-x${index}`, role: "assistant", text: part.text ?? "" };
    }).filter((part) => part.text || part.name);
  });
}

function upsert(list, id, create) {
  const found = list.find((item) => item.id === id);
  if (found) return found;
  const created = create();
  list.push(created);
  return created;
}

function applyEvent(event) {
  const list = currentMessages();
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta" || update.type === "thinking_delta") {
      const id = `${event.message?.id ?? "live"}-${update.contentIndex}`;
      const item = upsert(list, id, () => ({ id, role: update.type === "thinking_delta" ? "thinking" : "assistant", text: "" }));
      item.text += update.delta;
    }
  } else if (event.type === "message_end" && event.message?.role === "assistant") {
    const kept = list.filter((item) => !String(item.id).startsWith(event.message.id));
    messages[activeSession.value] = [...kept, ...displayMessages([event.message])];
  } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
    const item = upsert(list, event.toolCallId, () => ({ id: event.toolCallId, role: "tool", name: event.toolName, state: "运行", text: "" }));
    item.state = event.type === "tool_execution_end" ? (event.isError ? "失败" : "完成") : "运行";
    if (event.result?.content) item.text = event.result.content.map((part) => part.text ?? "").join("\n");
  } else if (event.type === "agent_settled") {
    running.value = false;
  }
  terminalLines.value = [`${event.type}`, ...terminalLines.value].slice(0, 40);
}

async function openWorkspace(cwd) {
  errorText.value = "";
  const opened = await desktop.open(cwd);
  if (!workspaces.value.some((item) => item.id === cwd)) {
    workspaces.value.push({ id: cwd, name: cwd.split(/[\\/]/).at(-1), path: cwd, status: "idle" });
  }
  activeWorkspace.value = cwd;
  sessions[cwd] = opened.sessions;
  models.value = opened.models;
  levels.value = opened.levels;
  applyState(opened.state);
  messages[activeSession.value] = displayMessages(opened.messages);
}

async function chooseDirectory() {
  const cwd = await desktop.chooseDirectory();
  if (cwd) await openWorkspace(cwd);
}

async function send() {
  const text = draft.value.trim();
  if (!text || !activeWorkspace.value) return;
  const streaming = running.value ? "followUp" : undefined;
  if (streaming) queue.value = [...queue.value, text];
  else currentMessages().push({ id: crypto.randomUUID(), role: "user", text });
  draft.value = "";
  running.value = true;
  try {
    const disposition = await desktop.prompt(activeWorkspace.value, text, streaming);
    if (disposition === "handled") running.value = false;
  } catch (error) {
    running.value = false;
    errorText.value = error.message ?? String(error);
  }
}

async function stop() {
  const queued = await desktop.stop(activeWorkspace.value);
  const returned = [...(queued.steering ?? []), ...(queued.followUp ?? [])];
  if (returned.length) draft.value = [draft.value, ...returned].filter(Boolean).join("\n");
  queue.value = [];
  running.value = false;
}

async function createSession() {
  const state = await desktop.newSession(activeWorkspace.value);
  applyState(state);
  messages[activeSession.value] = [];
  sessions[activeWorkspace.value] = await desktop.sessions(activeWorkspace.value);
}

async function openSession(id) {
  const opened = await desktop.switchSession(activeWorkspace.value, id);
  applyState(opened.state);
  messages[activeSession.value] = displayMessages(opened.messages);
}

async function selectModel(label) {
  const selected = models.value.find((item) => `${item.provider}/${item.id}` === label);
  if (!selected) return;
  levels.value = await desktop.setModel(activeWorkspace.value, selected.provider, selected.id);
  model.value = label;
}

async function selectThinking(level) {
  await desktop.setThinking(activeWorkspace.value, level);
  thinking.value = level;
}

onMounted(async () => {
  if (!desktop) {
    pi.value = { found: false, version: "请从 Electron 启动" };
    return;
  }
  pi.value = await desktop.locate();
  workspaces.value = (await desktop.recent()).map((cwd) => ({
    id: cwd,
    name: cwd.split(/[\\/]/).at(-1),
    path: cwd,
    status: "idle",
  }));
  desktop.onEvent(({ cwd, event }) => {
    if (cwd === activeWorkspace.value) applyEvent(event);
  });
});
</script>

<template>
  <shell>
    <WorkspaceList
      :workspaces="workspaces"
      :active-id="activeWorkspace"
      :version="pi.found ? pi.version : '未安装'"
      @open="openWorkspace"
      @choose="chooseDirectory"
    />
    <main v-if="pi.found && activeWorkspace" :class="{ 'with-panel': panel }">
      <TopBar
        :workspace="workspace"
        :running="running"
        :model="model"
        :models="modelLabels"
        :thinking="thinking"
        :levels="levels"
        :panel="panel"
        :theme="theme"
        @panel="panel = panel === $event ? '' : $event"
        @theme="theme = $event"
        @model="selectModel"
        @thinking="selectThinking"
      />
      <SessionList
        :sessions="sessionList"
        :active-id="activeSession"
        @open="openSession"
        @create="createSession"
      />
      <p v-if="errorText" class="hint">{{ errorText }}</p>
      <Transcript :messages="transcript" :dark="theme === 'dark'" />
      <Composer :draft="draft" :running="running" :queue="queue" @update:draft="draft = $event" @send="send" @stop="stop" />
      <SidePanel v-if="panel" :panel="panel" :changes="[]" :lines="terminalLines" />
    </main>
    <EmptyState v-else />
  </shell>
</template>
