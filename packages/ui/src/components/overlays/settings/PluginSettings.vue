<script setup lang="ts">
import { computed } from "vue";
import { PLUGIN_AREAS, type PluginArea } from "../../../kernel/plugin-manager.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import SettingGroup from "./SettingGroup.vue";

/**
 * 插件：按界面区域分组列出所有插件，勾选即启用 / 停用。
 *
 * 核心插件不允许停用（勾选框禁用），停用后它注入的面板 / 命令会立即消失。
 */
const { plugins } = useKernel();

const AREA_LABELS: Record<PluginArea, string> = {
  conversation: "对话区域",
  files: "文件区域",
  sidebar: "扩展工具",
  shell: "工作台工具",
};

const groups = computed(() =>
  PLUGIN_AREAS.map((area) => ({
    ...area,
    plugins: plugins.records.filter((record) => record.area === area.id),
  })).filter((group) => group.plugins.length),
);
</script>

<template>
  <SettingGroup v-for="group in groups" :key="group.id" :title="`${group.label} · ${group.plugins.length}`">
    <div v-for="item in group.plugins" :key="item.id" class="settings-row">
      <div class="settings-plugin-meta">
        <span class="settings-plugin-icon" v-html="item.icon" />
        <div class="settings-row-info">
          <strong>
            {{ item.name }}
            <span class="settings-plugin-ver">v{{ item.version }}</span>
            <span v-if="item.core" class="settings-plugin-tag">核心</span>
            <span class="settings-plugin-tag">{{ AREA_LABELS[item.area] }}</span>
          </strong>
          <span>{{ item.description }}</span>
        </div>
      </div>
      <input
        type="checkbox"
        class="settings-switch"
        :checked="item.enabled"
        :disabled="item.core"
        @change="plugins.toggle(item.id)"
      />
    </div>
  </SettingGroup>
</template>
