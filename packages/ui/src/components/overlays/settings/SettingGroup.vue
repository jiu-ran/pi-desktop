<script setup lang="ts">
/**
 * 设置页的一张卡片：一个主题下挂若干行。
 *
 * 只负责结构，样式仍由 `.settings-group` 系列承载，
 * 这样以后调整观感只需改 CSS，不必翻每个页面。
 */
defineProps<{
  title: string;
  /** 标题右侧的操作区（如「恢复默认」「刷新」） */
  note?: string;
}>();
</script>

<template>
  <section class="settings-group">
    <div class="settings-group-head">
      <h3 class="settings-group-title">{{ title }}</h3>
      <slot name="head" />
    </div>
    <slot />
  </section>
</template>
