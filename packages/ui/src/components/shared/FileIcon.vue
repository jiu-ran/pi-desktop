<script setup lang="ts">
import { computed } from "vue";
import { appSettings } from "../../services/settings.ts";
import { resolveFileIcon, type FileIconThemeId } from "../../shared/file-icons.ts";

/**
 * 文件类型图标（文件树 / 打开中的标签页 / 设置页预览共用）。
 *
 * 形状来自 Seti UI（32 网格，SVG 里的 fill 已换成 `currentColor`），这里只负责
 * 按主题决定「有没有底色」和「图标什么颜色」：
 * - `seti`：Seti 原色，无底色；
 * - `mono`：跟随正文颜色，无底色；
 * - `block`：品牌色方块 + 反白图标。
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
  () => `<svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">${view.value.body}</svg>`,
);
</script>

<template>
  <span
    class="file-icon"
    :class="[`is-${view.theme}`, { 'is-folder': view.isFolder }]"
    :data-seti="view.seti"
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
