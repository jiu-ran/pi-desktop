<script setup lang="ts">
/**
 * 设置页的下拉选择器。
 *
 * 为什么不用原生 `<select>`：弹出层由操作系统绘制，深色主题下会弹出浅色系统菜单、
 * 高亮是系统蓝，和设置页的圆角/配色完全割裂（截图里那一块浅蓝就是这么来的）。
 * 这里自绘：按钮 + 传送到底层 body 的浮层，跟随主题、不被滚动容器裁掉，
 * 并保留键盘操作（↑↓ / Home / End / Enter / Esc）与 ARIA 语义。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { icons } from "../../shared/util.ts";

export interface SelectOption {
  value: string | number | boolean;
  label: string;
  /** 右侧补充说明（如「默认」「当前」） */
  hint?: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | boolean | null;
    options: SelectOption[];
    disabled?: boolean;
    placeholder?: string;
    title?: string;
    ariaLabel?: string;
    align?: "left" | "right";
    size?: "md" | "sm";
    /** 固定宽度（CSS 长度）；不传时按钮宽度由内容决定 */
    width?: string;
  }>(),
  {
    disabled: false,
    placeholder: "未选择",
    title: "",
    ariaLabel: "",
    align: "left",
    size: "md",
    width: "",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string | number | boolean): void;
  (event: "change", value: string | number | boolean): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const listId = useId();

const selected = computed(() => props.options.find((item) => item.value === props.modelValue));
const text = computed(() => selected.value?.label ?? props.placeholder);
const triggerStyle = computed(() => (props.width ? { width: props.width } : {}));

function rows(): HTMLElement[] {
  return menu.value ? [...menu.value.querySelectorAll<HTMLElement>(".select-menu-item:not(:disabled)")] : [];
}

/** 浮层用 fixed 定位：设置内容区是滚动容器，绝对定位会被裁掉 */
function place(): void {
  const button = root.value?.querySelector<HTMLElement>(".select-menu-trigger");
  if (!button) return;
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    closeMenu(false);
    return;
  }
  const gap = 6;
  const width = Math.min(320, Math.max(rect.width, 168), Math.max(0, window.innerWidth - 16));
  const left = Math.min(
    Math.max(8, props.align === "right" ? rect.right - width : rect.left),
    window.innerWidth - width - 8,
  );
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const upward = below < 200 && above > below;
  menuStyle.value = {
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(Math.max(80, Math.min(320, (upward ? above : below) - gap)))}px`,
    ...(upward
      ? { bottom: `${Math.round(window.innerHeight - rect.top + gap)}px` }
      : { top: `${Math.round(rect.bottom + gap)}px` }),
  };
}

async function openMenu(fromEnd = false): Promise<void> {
  if (props.disabled || open.value) return;
  open.value = true;
  await nextTick();
  if (!open.value) return;
  place();
  const items = rows();
  const index = fromEnd
    ? items.length - 1
    : Math.max(items.findIndex((item) => item.dataset.value === String(props.modelValue)), 0);
  items[Math.min(Math.max(index, 0), items.length - 1)]?.focus();
}

function closeMenu(refocus = true): void {
  if (!open.value) return;
  open.value = false;
  if (refocus) root.value?.querySelector<HTMLElement>(".select-menu-trigger")?.focus();
}

function toggle(): void {
  if (open.value) closeMenu();
  else void openMenu();
}

function pick(option: SelectOption): void {
  closeMenu();
  if (option.value === props.modelValue) return;
  emit("update:modelValue", option.value);
  emit("change", option.value);
}

function onTriggerKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    void openMenu(event.key === "ArrowUp");
  }
}

function onItemKey(event: KeyboardEvent): void {
  const items = rows();
  const index = items.indexOf(event.currentTarget as HTMLElement);
  const move = (next: number): void => {
    event.preventDefault();
    event.stopPropagation();
    items[(next + items.length) % items.length]?.focus();
  };
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index - 1);
  else if (event.key === "Home") move(0);
  else if (event.key === "End") move(items.length - 1);
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).click();
  } else if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    event.stopPropagation();
    // 传送到 body 的列表不参与 Tab 顺序：先关掉、把焦点还给按钮
    closeMenu();
  }
}

function outside(event: Event): void {
  const target = event.target as Node;
  if (root.value?.contains(target) || menu.value?.contains(target)) return;
  closeMenu(false);
}

function reposition(): void {
  if (open.value) place();
}

onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("focusin", outside, true);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("focusin", outside, true);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu(false);
  },
  { flush: "sync" },
);
</script>

<template>
  <div ref="root" class="select-menu" :class="[`is-${size}`, { open }]">
    <button
      type="button"
      class="select-menu-trigger"
      :class="{ placeholder: !selected }"
      :style="triggerStyle"
      :title="title || text"
      :aria-label="ariaLabel || text"
      :aria-expanded="open"
      :aria-controls="listId"
      aria-haspopup="listbox"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span class="select-menu-value">{{ text }}</span>
      <span class="select-menu-caret" aria-hidden="true" v-html="icons.chevronDown" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        :id="listId"
        class="select-menu-popup"
        :style="menuStyle"
        role="listbox"
        :aria-label="ariaLabel || text"
      >
        <button
          v-for="option in options"
          :key="String(option.value)"
          type="button"
          class="select-menu-item"
          :class="{ active: option.value === modelValue }"
          role="option"
          :data-value="String(option.value)"
          :aria-selected="option.value === modelValue"
          :disabled="option.disabled"
          tabindex="-1"
          @click="pick(option)"
          @keydown="onItemKey"
        >
          <span class="select-menu-item-label">{{ option.label }}</span>
          <small v-if="option.hint" class="select-menu-item-hint">{{ option.hint }}</small>
          <span v-if="option.value === modelValue" class="select-menu-item-check" aria-hidden="true" v-html="icons.check" />
        </button>
      </div>
    </Teleport>
  </div>
</template>
