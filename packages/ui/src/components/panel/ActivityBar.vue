<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { openSettingsModal, settingsModalState } from "../../services/settings.ts";
import { icons } from "../../shared/util.ts";

const { workbench, plugins } = useKernel();

const topPlugins = computed(() =>
  plugins.sidebarPlugins.value.filter((plugin) => !plugin.core),
);

const bottomPlugins = computed(() =>
  plugins.sidebarPlugins.value.filter((plugin) => plugin.core),
);

const badgeValues = computed(() => {
  const values = new Map<string, string | number | null>();
  for (const plugin of plugins.sidebarPlugins.value) {
    try {
      const val = plugin.badge?.();
      values.set(plugin.id, val === undefined || val === null || val === "" || val === 0 ? null : val);
    } catch {
      values.set(plugin.id, null);
    }
  }
  return values;
});

function toggle(pluginId: string): void {
  workbench.togglePanel(pluginId);
}
</script>

<template>
  <nav class="activity-bar" aria-label="插件活动栏">
    <div class="activity-bar-group">
      <button
        v-for="plugin in topPlugins"
        :key="plugin.id"
        type="button"
        class="activity-btn"
        :class="{ active: workbench.state.activePanelId === plugin.id }"
        :title="`${plugin.name}${plugin.description ? ` — ${plugin.description}` : ''}`"
        :aria-label="plugin.name"
        :aria-pressed="workbench.state.activePanelId === plugin.id"
        @click="toggle(plugin.id)"
      >
        <span class="activity-icon" v-html="plugin.icon" />
        <span v-if="badgeValues.get(plugin.id) !== null" class="activity-badge">{{ badgeValues.get(plugin.id) }}</span>
      </button>
    </div>

    <div class="activity-bar-group bottom">
      <button
        v-for="plugin in bottomPlugins"
        :key="plugin.id"
        type="button"
        class="activity-btn"
        :class="{ active: workbench.state.activePanelId === plugin.id }"
        :title="`${plugin.name}${plugin.description ? ` — ${plugin.description}` : ''}`"
        :aria-label="plugin.name"
        :aria-pressed="workbench.state.activePanelId === plugin.id"
        @click="toggle(plugin.id)"
      >
        <span class="activity-icon" v-html="plugin.icon" />
        <span v-if="badgeValues.get(plugin.id) !== null" class="activity-badge">{{ badgeValues.get(plugin.id) }}</span>
      </button>
      <button
        type="button"
        class="activity-btn"
        :class="{ active: settingsModalState.open }"
        title="偏好设置 (Ctrl+,)"
        aria-label="偏好设置"
        @click="openSettingsModal()"
      >
        <span class="activity-icon" v-html="icons.gear" />
      </button>
    </div>
  </nav>
</template>
