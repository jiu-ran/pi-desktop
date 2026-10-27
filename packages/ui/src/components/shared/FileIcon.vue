<script setup lang="ts">
import { computed } from "vue";
import { resolveFileIcon } from "../../shared/file-icons.ts";

/**
 * 文件 / 文件夹图标（文件树、打开中的标签页、搜索结果、Git 变更共用）。
 *
 * 只有两种图形：文件夹一个、其余一个。不再按扩展名换图标 —— 彩色图形太多时
 * 反而认不出「哪个是文件夹」，也没人会靠图标记住 200 多种扩展名。
 */
const props = withDefaults(
  defineProps<{
    name: string;
    isFolder?: boolean;
    open?: boolean;
    size?: number;
  }>(),
  { isFolder: false, open: false, size: 16 },
);

const view = computed(() => resolveFileIcon(props.name, { isFolder: props.isFolder }));

const markup = computed(
  () => `<svg viewBox="${view.value.viewBox}" width="100%" height="100%" aria-hidden="true">${view.value.body}</svg>`,
);
</script>

<template>
  <span
    class="file-icon"
    :class="{ 'is-folder': view.isFolder }"
    :data-icon="view.icon"
    :title="view.label"
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
    <span class="file-icon-glyph" v-html="markup" />
  </span>
</template>
