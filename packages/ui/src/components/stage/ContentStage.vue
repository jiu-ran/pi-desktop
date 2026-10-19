<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { icons } from "../../shared/util.ts";

const { stage, plugins, workbench } = useKernel();

const activeTab = computed(() => stage.activeTab.value);
const activePlugin = computed(() => (activeTab.value ? plugins.get(activeTab.value.pluginId) : undefined));
const stageComponent = computed(() => activePlugin.value?.stage ?? null);

function focusOwnerPanel(): void {
  if (!activeTab.value) return;
  workbench.state.activePanelId = activeTab.value.pluginId;
}

function scrollTabs(event: WheelEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement) || target.scrollWidth <= target.clientWidth) return;
  target.scrollLeft += event.deltaY || event.deltaX;
  event.preventDefault();
}
</script>

<template>
  <section v-if="activeTab && stageComponent" class="area-stage">
    <header class="stage-tabbar">
      <div class="stage-tabs" role="tablist" aria-label="打开的内容标签页" @wheel="scrollTabs">
        <div
          v-for="tab in stage.tabs"
          :key="tab.key"
          class="stage-tab"
          :class="{ active: tab.key === stage.activeKey.value }"
          :title="tab.subtitle || tab.title"
          role="tab"
          :aria-selected="tab.key === stage.activeKey.value"
          @click="stage.activate(tab.key)"
        >
          <span
            v-if="plugins.get(tab.pluginId)?.icon"
            class="stage-tab-icon"
            v-html="plugins.get(tab.pluginId)?.icon"
          />
          <span class="stage-tab-title">{{ tab.title }}</span>
          <span v-if="tab.dirty" class="stage-tab-dirty" title="未保存修改">●</span>
          <button
            type="button"
            class="stage-tab-close"
            title="关闭标签页"
            aria-label="关闭标签页"
            @click.stop="stage.close(tab.key)"
          >
            ×
          </button>
        </div>
      </div>

      <div class="stage-tabbar-actions">
        <button
          v-if="activePlugin"
          type="button"
          class="icon-btn small"
          :title="`打开「${activePlugin.name}」扩展工具面板`"
          @click="focusOwnerPanel"
        >
          <span v-html="activePlugin.icon" />
        </button>
        <button
          type="button"
          class="icon-btn small"
          title="关闭全部展示标签"
          aria-label="关闭全部展示标签"
          @click="stage.clear()"
          v-html="icons.close"
        />
      </div>
    </header>

    <div class="stage-body">
      <component :is="stageComponent" :key="activeTab.key" :tab="activeTab" />
    </div>
  </section>
</template>
