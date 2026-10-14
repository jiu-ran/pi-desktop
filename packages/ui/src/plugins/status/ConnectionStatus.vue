<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";

const { workbench } = useKernel();
const ws = computed(() => workbench.active.value);
const pi = computed(() => workbench.state.pi);

const label = computed(() => {
  if (!pi.value.checked) return "检测 Pi…";
  if (!pi.value.found) return "未找到 Pi CLI";
  if (!ws.value) return `Pi ${pi.value.version}`;
  if (ws.value.status === "starting") return "启动中";
  if (ws.value.status === "error") return "进程出错";
  if (ws.value.compacting) return "压缩上下文";
  if (ws.value.streaming) return "运行中";
  return `Pi ${pi.value.version}`;
});

const tone = computed(() => {
  if (pi.value.checked && !pi.value.found) return "error";
  if (ws.value?.status === "error") return "error";
  if (ws.value?.streaming || ws.value?.compacting || ws.value?.status === "starting") return "running";
  return "ready";
});
</script>

<template>
  <span class="status-item" :data-tone="tone" :title="`本机 Pi CLI ${pi.version}`">
    <span class="status-dot" :data-state="tone" />
    {{ label }}
  </span>
</template>
