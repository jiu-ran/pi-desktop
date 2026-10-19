<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";

const { workbench, plugins } = useKernel();

const activePlugin = computed(() => {
  const id = workbench.state.activePanelId;
  if (!id) return null;
  const entry = plugins.get(id);
  return entry && entry.enabled ? entry : null;
});
</script>

<template>
  <aside v-if="activePlugin" class="area-panel">
    <header class="area-panel-head">
      <div class="area-panel-title">
        <span class="area-panel-icon" v-html="activePlugin.icon" />
        <strong>{{ activePlugin.name }}</strong>
      </div>
      <div class="area-panel-actions">
        <button
          type="button"
          class="icon-btn small"
          title="收起扩展工具面板"
          aria-label="收起扩展工具面板"
          @click="workbench.closePanel()"
          v-html="icons.close"
        />
      </div>
    </header>

    <div class="area-panel-body">
      <component :is="activePlugin.panel" :key="activePlugin.id" />
    </div>
  </aside>
</template>
