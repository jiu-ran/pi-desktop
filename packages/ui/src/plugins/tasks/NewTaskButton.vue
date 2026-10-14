<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";

/** 标题栏的「新建任务」按钮（侧栏开关由骨架提供，这里不再重复） */
const { workbench } = useKernel();
const ws = computed(() => workbench.active.value);
</script>

<template>
  <button
    class="tb-btn"
    :disabled="!ws || ws.streaming"
    title="新建任务 (Ctrl+N)"
    @click="workbench.newSession()"
    v-html="icons.plus"
  />
</template>
