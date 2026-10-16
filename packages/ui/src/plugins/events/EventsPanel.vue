<script setup lang="ts">
import { computed, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { eventLog, type EventLogEntry } from "./log.ts";

const { workbench, stage } = useKernel();
const filter = ref("");
const hideDeltas = ref(true);

const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return eventLog.items.filter((row) => {
    if (row.cwd !== workbench.state.activeCwd) return false;
    if (row.sessionFile && row.sessionFile !== workbench.active.value?.sessionFile) return false;
    if (hideDeltas.value && row.type === "message_update") return false;
    return !q || `${row.type} ${row.hint}`.toLowerCase().includes(q);
  });
});

function isActive(row: EventLogEntry): boolean {
  return stage.activeTab.value?.pluginId === "events" && stage.activeTab.value?.tabId === String(row.id);
}

function inspectEvent(row: EventLogEntry): void {
  stage.open<EventLogEntry>({
    pluginId: "events",
    tabId: String(row.id),
    title: `${row.type} #${row.id}`,
    subtitle: `${row.time}${row.hint ? ` · ${row.hint}` : ""}`,
    data: row,
  });
}

function clearEvents(): void {
  eventLog.clear();
  stage.closeByPlugin("events");
}
</script>

<template>
  <div class="list-view">
    <div class="list-tools">
      <input v-model="filter" class="search" placeholder="按事件类型筛选…" />
      <button type="button" class="icon-btn" title="清空事件记录" @click="clearEvents">⌫</button>
    </div>
    <label class="check">
      <input v-model="hideDeltas" type="checkbox" />
      隐藏流式增量（message_update）
    </label>
    <ul class="log">
      <li v-for="row in rows" :key="row.id" :data-type="row.group">
        <button
          type="button"
          class="log-row"
          :class="{ active: isActive(row) }"
          :title="`在详情视图中查看事件 #${row.id}`"
          @click="inspectEvent(row)"
        >
          <span class="log-time">{{ row.time }}</span>
          <span class="log-type">{{ row.type }}</span>
          <span class="log-hint">{{ row.hint }}</span>
        </button>
      </li>
    </ul>
    <p v-if="!rows.length" class="list-empty">还没有事件。发一条消息后这里会显示 Pi 的 RPC 事件流，点击任意事件可在详情视图中查看完整 JSON。</p>
  </div>
</template>
