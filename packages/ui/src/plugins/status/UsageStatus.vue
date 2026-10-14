<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { formatTokens } from "../../shared/util.js";

/**
 * 上下文与费用。数据来自 Pi 的 get_session_stats，在每次 agent_settled 与切换会话后刷新。
 */
const { workbench, bus } = useKernel();
const ws = computed(() => workbench.active.value);
const stats = ref(null);

async function refresh() {
  if (ws.value?.status !== "ready") { stats.value = null; return; }
  try {
    stats.value = await workbench.call("getSessionStats");
  } catch {
    stats.value = null;
  }
}

watch(() => [ws.value?.cwd, ws.value?.sessionFile, ws.value?.status], refresh, { immediate: true });
const off = bus.on("pi:event", ({ event }) => { if (event.type === "agent_settled" || event.type === "compaction_end") refresh(); });
onBeforeUnmount(off);

const context = computed(() => stats.value?.contextUsage ?? null);
const percent = computed(() => (context.value?.percent == null ? null : Math.round(context.value.percent)));
const cost = computed(() => (stats.value?.cost ? `$${stats.value.cost.toFixed(3)}` : ""));
</script>

<template>
  <span
    v-if="context"
    class="status-item"
    :title="`上下文 ${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} tokens${stats ? `\n累计 ${formatTokens(stats.tokens.total)}（输入 ${stats.tokens.input} · 输出 ${stats.tokens.output} · 缓存 ${stats.tokens.cacheRead}）` : ''}`"
  >
    <span class="meter"><span class="meter-fill" :style="{ width: `${percent ?? 0}%` }" :data-level="percent > 80 ? 'high' : percent > 50 ? 'mid' : 'low'" /></span>
    {{ percent ?? "-" }}%
    <span v-if="cost" class="muted-num">{{ cost }}</span>
  </span>
</template>
