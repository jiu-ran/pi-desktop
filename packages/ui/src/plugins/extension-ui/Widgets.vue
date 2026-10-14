<script setup>
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { extState } from "./state.js";

/** 扩展通过 setWidget 在输入框上方显示的文本块。 */
const { workbench } = useKernel();
const widgets = computed(() => Object.entries(extState.widgets[workbench.state.activeCwd] ?? {}));
</script>

<template>
  <div v-if="widgets.length" class="ext-widgets">
    <div v-for="[key, widget] in widgets" :key="key" class="ext-widget">
      <span class="ext-widget-key">{{ key }}</span>
      <pre>{{ widget.lines.join("\n") }}</pre>
    </div>
  </div>
</template>
