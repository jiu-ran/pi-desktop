<script setup lang="ts">
import { computed } from "vue";
import { PLUGIN_AREAS, type PluginArea } from "../../kernel/plugin-manager.ts";
import { useKernel } from "../../kernel/use-kernel.ts";

/**
 * 4 区域：插件管理面板
 * 按界面区域分组展示插件，并控制其启用与停用。
 */
const { plugins } = useKernel();

const areaCaps: Record<PluginArea, string[]> = {
  conversation: ["对话区域渲染"],
  files: ["文件区域渲染"],
  sidebar: ["插件活动栏", "扩展工具面板"],
};

const groups = computed(() =>
  PLUGIN_AREAS.map((area) => ({
    ...area,
    plugins: plugins.list.value.filter((record) => record.area === area.id),
  })).filter((group) => group.plugins.length),
);

function onToggle(id: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  plugins.setEnabled(id, checked);
}
</script>

<template>
  <div class="list-view">
    <p class="panel-intro">
      插件按所作用的界面区域分组。停用「扩展工具」插件会移除其活动栏图标、收起工具面板并关闭其详情标签；停用「对话区域 / 文件区域」插件会立即停用对应的渲染能力。
    </p>
    <section v-for="group in groups" :key="group.id" class="plugin-group">
      <h3 class="plugin-group-title">{{ group.label }}</h3>
      <ul class="plugin-list">
        <li v-for="record in group.plugins" :key="record.id" class="plugin-card" :class="{ off: !record.enabled }">
          <div class="plugin-main">
            <div class="plugin-title">
              <span class="plugin-icon" v-html="record.icon" />
              <strong>{{ record.name }}</strong>
              <span v-if="record.core" class="pill">核心</span>
              <span class="plugin-version">v{{ record.version }}</span>
            </div>
            <p class="plugin-desc">{{ record.description }}</p>
            <div class="plugin-caps">
              <code class="plugin-id">{{ record.id }}</code>
              <span v-for="cap in areaCaps[record.area]" :key="cap" class="plugin-cap">{{ cap }}</span>
              <span v-if="record.stage" class="plugin-cap stage">编辑器与详情视图</span>
            </div>
            <p v-if="record.error" class="plugin-error">激活失败：{{ record.error }}</p>
          </div>
          <label class="switch" :class="{ disabled: record.core }" :title="record.core ? '核心插件不可停用' : ''">
            <input
              type="checkbox"
              :checked="record.enabled"
              :disabled="record.core"
              @change="onToggle(record.id, $event)"
            />
            <span class="switch-track" />
          </label>
        </li>
      </ul>
    </section>
  </div>
</template>
