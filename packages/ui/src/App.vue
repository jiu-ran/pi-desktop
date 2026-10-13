<script setup>
import { computed, reactive, ref } from "vue";
import Composer from "./components/Composer.vue";
import EmptyState from "./components/EmptyState.vue";
import SessionList from "./components/SessionList.vue";
import SidePanel from "./components/SidePanel.vue";
import TopBar from "./components/TopBar.vue";
import Transcript from "./components/Transcript.vue";
import WorkspaceList from "./components/WorkspaceList.vue";
import {
  changes,
  messages as seedMessages,
  models,
  pi as seedPi,
  sessions as seedSessions,
  terminalLines,
  thinkingLevels,
  workspaces as seedWorkspaces,
} from "./data.js";

const pi = ref(seedPi);
const workspaces = ref(seedWorkspaces);
const sessions = reactive(structuredClone(seedSessions));
const messages = reactive(structuredClone(seedMessages));

const activeWorkspace = ref("chat");
const activeSession = ref("s1");
const draft = ref("");
const running = ref(false);
const queue = ref([]);
const panel = ref("changes");
const model = ref(models[0]);
const thinking = ref("medium");

const sessionList = computed(() => sessions[activeWorkspace.value] ?? []);
const transcript = computed(() => messages[activeSession.value] ?? []);
const workspace = computed(
  () => workspaces.value.find((item) => item.id === activeWorkspace.value) ?? workspaces.value[0],
);

function openWorkspace(id) {
  activeWorkspace.value = id;
  activeSession.value = sessionList.value[0]?.id ?? "";
  queue.value = [];
  running.value = false;
}

function openSession(id) {
  activeSession.value = id;
  queue.value = [];
  running.value = false;
}

function createSession() {
  const id = crypto.randomUUID();
  sessions[activeWorkspace.value].unshift({
    id,
    title: "新会话",
    updated: "刚刚",
    status: "idle",
  });
  messages[id] = [];
  openSession(id);
}

function send() {
  const text = draft.value.trim();
  if (!text || !activeSession.value) return;
  if (running.value) {
    queue.value = [...queue.value, text];
  } else {
    messages[activeSession.value].push({
      id: crypto.randomUUID(),
      role: "user",
      text,
    });
    const session = sessionList.value.find((item) => item.id === activeSession.value);
    if (session && session.title === "新会话") session.title = text.slice(0, 18);
    running.value = true;
  }
  draft.value = "";
}

function stop() {
  if (queue.value.length) {
    draft.value = [draft.value, ...queue.value].filter(Boolean).join("\n");
    queue.value = [];
  }
  running.value = false;
}

function togglePanel(next) {
  panel.value = panel.value === next ? "" : next;
}
</script>

<template>
  <shell>
    <WorkspaceList
      :workspaces="workspaces"
      :active-id="activeWorkspace"
      :version="pi.found ? pi.version : '未安装'"
      @open="openWorkspace"
    />

    <main v-if="pi.found" :class="{ 'with-panel': panel }">
      <TopBar
        :workspace="workspace"
        :running="running"
        :model="model"
        :models="models"
        :thinking="thinking"
        :levels="thinkingLevels"
        :panel="panel"
        @panel="togglePanel"
        @model="model = $event"
        @thinking="thinking = $event"
      />
      <SessionList
        :sessions="sessionList"
        :active-id="activeSession"
        @open="openSession"
        @create="createSession"
      />
      <Transcript :messages="transcript" />
      <Composer
        :draft="draft"
        :running="running"
        :queue="queue"
        @update:draft="draft = $event"
        @send="send"
        @stop="stop"
      />
      <SidePanel
        v-if="panel"
        :panel="panel"
        :changes="changes"
        :lines="terminalLines"
      />
    </main>
    <EmptyState v-else />
  </shell>
</template>
