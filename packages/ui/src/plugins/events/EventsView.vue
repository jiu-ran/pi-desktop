<script setup lang="ts">
import { computed, ref } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { eventLog } from "./log.ts";

const { workbench } = useKernel();
const filter = ref("");
const hideDeltas = ref(true);
const expanded = ref(null);

const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return eventLog.items.filter((row) => {
    if (row.cwd !== workbench.state.activeCwd) return false;
    if (hideDeltas.value && row.type === "message_update") return false;
    return !q || row.type.includes(q);
  });
});
</script>

<template>
  <div class="list-view">
    <div class="list-tools">
      <input v-model="filter" class="search" placeholder="按事件类型筛选…" />
      <button class="icon-btn" title="清空" @click="eventLog.clear()">⌫</button>
    </div>
    <label class="check">
      <input v-model="hideDeltas" type="checkbox" />
      隐藏流式增量（message_update）
    </label>
    <ul class="log">
      <li v-for="row in rows" :key="row.id" :data-type="row.group">
        <button class="log-row" @click="expanded = expanded === row.id ? null : row.id">
          <span class="log-time">{{ row.time }}</span>
          <span class="log-type">{{ row.type }}</span>
          <span class="log-hint">{{ row.hint }}</span>
        </button>
        <pre v-if="expanded === row.id" class="log-json">{{ row.json }}</pre>
      </li>
    </ul>
    <p v-if="!rows.length" class="list-empty">还没有事件。发一条消息后这里会显示 Pi 的 RPC 事件流。</p>
  </div>
</template>
