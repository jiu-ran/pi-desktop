<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";

/** 插件管理面板：运行时启用/停用，状态持久化。核心插件不可停用。 */
const { plugins, contributions } = useKernel();

const counts = computed(() => {
  const map = {};
  for (const [point, list] of Object.entries(contributions.points)) {
    for (const item of list) {
      map[item.pluginId] ??= {};
      map[item.pluginId][point] = (map[item.pluginId][point] ?? 0) + 1;
    }
  }
  return map;
});

function summary(id) {
  const entry = counts.value[id];
  if (!entry) return "未提供贡献";
  return Object.entries(entry).map(([point, n]) => `${point}×${n}`).join("  ");
}
</script>

<template>
  <div class="list-view">
    <p class="panel-intro">停用插件会立即撤下它提供的视图、渲染器与事件订阅。设置会被记住。</p>
    <ul class="plugin-list">
      <li v-for="record in plugins.records" :key="record.id" class="plugin-card" :class="{ off: !record.enabled }">
        <div class="plugin-main">
          <div class="plugin-title">
            <strong>{{ record.name }}</strong>
            <span v-if="record.core" class="pill">核心</span>
            <span class="plugin-version">v{{ record.version }}</span>
          </div>
          <p class="plugin-desc">{{ record.description }}</p>
          <code class="plugin-id">{{ record.id }}</code>
          <p v-if="record.enabled" class="plugin-points">{{ summary(record.id) }}</p>
          <p v-if="record.error" class="plugin-error">激活失败：{{ record.error }}</p>
        </div>
        <label class="switch" :class="{ disabled: record.core }" :title="record.core ? '核心插件不可停用' : ''">
          <input
            type="checkbox"
            :checked="record.enabled"
            :disabled="record.core"
            @change="plugins.setEnabled(record.id, $event.target.checked)"
          />
          <span class="switch-track" />
        </label>
      </li>
    </ul>
  </div>
</template>
