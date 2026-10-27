<script setup lang="ts">
import { computed } from "vue";
import { appSettings } from "../../services/settings.ts";
import { resolveFileIcon, type FileIconThemeId } from "../../shared/file-icons.ts";

/**
 * 文件类型图标（文件树 / 打开中的标签页 / 设置页预览共用）。
 *
 * 三种画法来自同一张类型表（见 `shared/file-icons.ts`）：
 * - 填充（VS Code 风）：品牌色方块 + 黑/白字母或图形；
 * - 描边（JetBrains 风）：同形状细描边，字母与线条都是品牌色；
 * - 裸字形：不画底，只有品牌色字形。
 *
 * 字母用 HTML 文本（不是 SVG 里的 <text>）：这样字号/字距能用 CSS 精确调，
 * 16px 方块里 2–4 个字符都清楚，也不依赖系统字体在 SVG 里的度量。
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
/** 字母长度决定字号：2 个字符最大，4 个字符最小 */
const letterLength = computed(() => (view.value.ink === "letters" ? view.value.letters.length : 0));
</script>

<template>
  <span
    class="file-icon"
    :class="[`is-${view.theme}`, `is-kind-${view.kind}`, { 'is-letters': view.ink === 'letters' }]"
    :data-kind="view.kind"
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
    <span
      v-if="view.ink === 'letters'"
      class="file-icon-letters"
      :data-len="letterLength"
    >{{ view.letters }}</span>
    <span v-else class="file-icon-glyph" v-html="view.glyph" />
  </span>
</template>
