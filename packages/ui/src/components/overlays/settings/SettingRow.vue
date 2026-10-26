<script setup lang="ts">
/**
 * 设置页的一行：左侧标题 + 说明，右侧控件。
 *
 * `clickable` 时整行是 `<label>`，点空白处也能触发右侧的 checkbox；
 * `disabled` 用于「依赖上一个选项」的行（变灰但仍可见，不隐藏）。
 */
const props = withDefaults(
  defineProps<{
    label: string;
    hint?: string;
    disabled?: boolean;
    clickable?: boolean;
  }>(),
  { hint: "", disabled: false, clickable: false },
);

const tag = props.clickable ? "label" : "div";
</script>

<template>
  <component :is="tag" class="settings-row" :class="{ clickable, 'is-disabled': props.disabled }">
    <div class="settings-row-info">
      <strong>{{ label }}</strong>
      <span v-if="hint || $slots.hint"><slot name="hint">{{ hint }}</slot></span>
    </div>
    <slot />
  </component>
</template>
