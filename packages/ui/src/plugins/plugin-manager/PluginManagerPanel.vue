<script setup lang="ts">
import { computed } from "vue";
import { PLUGIN_AREAS, type PluginArea } from "../../kernel/plugin-manager.ts";
import { useKernel } from "../../kernel/use-kernel.ts";

/**
 * 插件管理面板
 * 按界面区域展示插件及其能力标签。
 */
const { plugins } = useKernel();

const areaCaps: Record<PluginArea, string[]> = {
  conversation: ["对话区域渲染"],
  files: ["文件区域渲染"],
  sidebar: ["插件活动栏", "扩展工具面板"],
  shell: ["工作台停靠区", "终端快捷键"],
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
  <div class="plugin-manager">
    <p class="plugin-manager-intro">
      插件按所作用的界面区域分组。停用「扩展工具」插件会移除其活动栏图标、收起工具面板并关闭其详情标签；停用「对话区域 / 文件区域」插件会立即停用对应的渲染能力。
    </p>
    <section v-for="group in groups" :key="group.id" class="plugin-manager-group">
      <h3>{{ group.label }}</h3>
      <ul>
        <li v-for="record in group.plugins" :key="record.id" :data-enabled="record.enabled">
          <div class="plugin-manager-body">
            <div class="plugin-manager-heading">
              <span class="plugin-manager-icon" v-html="record.icon" />
              <strong>{{ record.name }}</strong>
              <em v-if="record.core">核心</em>
              <small>v{{ record.version }}</small>
            </div>
            <p>{{ record.description }}</p>
            <div class="plugin-manager-tags">
              <span v-for="cap in areaCaps[record.area]" :key="cap">{{ cap }}</span>
              <b v-if="record.stage">编辑器与详情视图</b>
              <b v-if="record.dock">底部停靠面板</b>
            </div>
            <p v-if="record.error" class="plugin-manager-error">激活失败：{{ record.error }}</p>
          </div>
          <label :data-disabled="record.core" :title="record.core ? '核心插件不可停用' : ''">
            <input
              type="checkbox"
              :checked="record.enabled"
              :disabled="record.core"
              @change="onToggle(record.id, $event)"
            />
            <i />
          </label>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.plugin-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 12px 16px;
}
.plugin-manager-intro {
  margin: 0;
  color: var(--fg-3);
  font-size: 12px;
  line-height: 1.6;
}
.plugin-manager-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plugin-manager-group h3 {
  margin: 4px 2px 0;
  color: var(--fg-3);
  font-size: 11px;
  font-weight: 600;
}
.plugin-manager-group ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.plugin-manager-group li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-1);
}
.plugin-manager-group li[data-enabled="false"] { opacity: 0.55; }
.plugin-manager-body { flex: 1; min-width: 0; }
.plugin-manager-heading {
  display: flex;
  align-items: center;
  gap: 7px;
}
.plugin-manager-icon {
  display: grid;
  flex: none;
  color: var(--accent);
}
.plugin-manager-heading strong {
  color: var(--fg);
  font-size: 12.5px;
  font-weight: 600;
}
.plugin-manager-heading em {
  padding: 0 6px;
  border-radius: 99px;
  background: var(--bg-3);
  color: var(--fg-2);
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
}
.plugin-manager-heading small {
  color: var(--fg-3);
  font: 10.5px var(--mono);
}
.plugin-manager-body > p {
  margin: 3px 0;
  color: var(--fg-2);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.plugin-manager-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  margin-top: 6px;
}
.plugin-manager-tags > * {
  width: fit-content;
  max-width: 100%;
}
.plugin-manager-tags span,
.plugin-manager-tags b {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 400;
  line-height: 16px;
  white-space: nowrap;
}
.plugin-manager-tags span {
  background: var(--bg-2);
  color: var(--fg-3);
}
.plugin-manager-tags b {
  background: var(--accent-soft);
  color: var(--accent);
}
.plugin-manager-error {
  color: var(--err) !important;
  font-size: 11.5px !important;
}
.plugin-manager label {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  margin-top: 2px;
}
.plugin-manager input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.plugin-manager label[data-disabled="true"] input { cursor: not-allowed; }
.plugin-manager i {
  position: absolute;
  inset: 0;
  border-radius: 99px;
  background: var(--line-2);
  pointer-events: none;
}
.plugin-manager i::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--fg);
  transition: transform 0.15s;
}
.plugin-manager input:checked + i { background: var(--accent); }
.plugin-manager input:checked + i::after {
  transform: translateX(12px);
  background: #fff;
}
.plugin-manager label[data-disabled="true"] i { opacity: 0.5; }
</style>
