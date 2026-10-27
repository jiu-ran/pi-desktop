<script setup lang="ts">
import { computed } from "vue";
import { appSettings } from "../../services/settings.ts";
import { resolveFileIcon, type FileIconThemeId } from "../../shared/file-icons.ts";

/**
 * 文件类型图标（文件树 / 打开中的标签页 / 设置页预览共用）。
 *
 * 形状来自 Material Icon Theme（网格不统一，按各图标的 viewBox 渲染）；
 * 没有专属图标的类型直接用默认样式（文件=document，文件夹=folder）。
 * 主题只决定「有没有底色」和用什么颜色（单色 / 填充时会换成 currentColor 版本）：
 * - `material`：Material 原色，无底色；
 * - `mono`：跟随正文颜色，无底色；
 * - `block`：品牌色方块 + 反白内容。
 */
const props = withDefaults(
  defineProps<{
    name: string;
    isFolder?: boolean;
    open?: boolean;
    theme?: FileIconThemeId;
    size?: number;
  }>(),
  { isFolder: false, open: false, size: 16 },
);

const view = computed(() =>
  resolveFileIcon(props.name, {
    theme: props.theme ?? appSettings.fileIconTheme,
    isFolder: props.isFolder,
    open: props.open,
  }),
);

const markup = computed(
  () => `<svg viewBox="${view.value.viewBox}" width="100%" height="100%" aria-hidden="true">${view.value.body}</svg>`,
);
</script>

<template>
  <span
    class="file-icon"
    :class="[`is-${view.theme}`, { 'is-folder': view.isFolder }]"
    :data-icon="view.icon"
    :data-theme="view.theme"
    :title="view.label"
    aria-hidden="true"
    :style="{
      '--file-icon-color': view.color,
      '--file-icon-ink': view.inkColor,
      width: `${size}px`,
      height: `${size}px`,
    }"
  >
    <span class="file-icon-glyph" v-html="markup" />
  </span>
</template>
