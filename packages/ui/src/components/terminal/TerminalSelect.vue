<script setup lang="ts">
/**
 * 终端里的小型下拉选择器。
 *
 * 原生 <select> 的弹出层由操作系统绘制，在深色主题下会变成浅色系统菜单，和终端面板
 * 完全割裂；这里用按钮 + 传送到底层 body 的浮层自绘，样式跟随主题、不被终端面板的
 * overflow 裁掉，并保留键盘操作与 ARIA 语义。
 */
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from "vue";
import { icons } from "../../shared/util.ts";

export interface TerminalSelectItem {
  value: string;
  label: string;
  hint?: string;
  /** 分组标题：与上一项不同时插入一条分节标题 */
  group?: string;
  /** 动作项（如「终端设置…」）：不显示选中标记 */
  action?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: TerminalSelectItem[];
    value?: string;
    label?: string;
    placeholder?: string;
    title?: string;
    icon?: string;
    side?: "up" | "down";
    align?: "left" | "right";
    /** chevron：只显示下拉箭头（用于图标按钮） */
    variant?: "text" | "chevron";
    /** 是否显示右侧下拉箭头（左侧已有图标时可关掉） */
    caret?: boolean;
    ariaLabel?: string;
    disabled?: boolean;
    /** 宿主被收起、停用或被模态框遮挡时立即撤掉浮层 */
    active?: boolean;
  }>(),
  {
    value: "",
    label: "",
    placeholder: "",
    title: "",
    icon: "",
    side: "down",
    align: "left",
    variant: "text",
    caret: true,
    ariaLabel: "",
    disabled: false,
    active: true,
  },
);

const emit = defineEmits<{
  (e: "pick", value: string): void;
  (e: "open"): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

const selected = computed(() => props.items.find((item) => item.value === props.value));
const text = computed(() => props.label || selected.value?.label || props.placeholder);
const listId = useId();

function rows(): HTMLElement[] {
  return menuEl.value ? [...menuEl.value.querySelectorAll<HTMLElement>(".terminal-select-item")] : [];
}

/** 浮层用 fixed 定位：终端面板有 overflow:hidden，绝对定位的下拉会被裁掉。 */
function place(): void {
  const button = root.value?.querySelector<HTMLElement>(".terminal-select-btn");
  if (!button) return;
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) { closeMenu(false); return; }
  const gap = 6;
  const width = Math.min(320, Math.max(240, rect.width), Math.max(0, window.innerWidth - 16));
  const left = Math.min(Math.max(8, props.align === "right" ? rect.right - width : rect.left), window.innerWidth - width - 8);
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const upward = props.side === "up" ? above > 120 || above >= below : below < 200 && above > below;
  const height = Math.max(0, Math.min(320, (upward ? above : below) - gap));
  menuStyle.value = {
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(height)}px`,
    ...(upward ? { bottom: `${Math.round(window.innerHeight - rect.top + gap)}px` } : { top: `${Math.round(rect.bottom + gap)}px` }),
  };
}

async function openMenu(fromEnd = false): Promise<void> {
  if (props.disabled || !props.active) return;
  open.value = true;
  emit("open");
  await nextTick();
  if (!open.value) return;
  place();
  const items = rows();
  const index = fromEnd ? items.length - 1 : Math.max(items.findIndex((el) => el.dataset.value === props.value), 0);
  items[Math.min(Math.max(index, 0), items.length - 1)]?.focus();
}

function closeMenu(refocus = true): void {
  if (!open.value) return;
  open.value = false;
  if (refocus) root.value?.querySelector<HTMLElement>(".terminal-select-btn")?.focus();
}

function toggle(): void {
  if (open.value) closeMenu();
  else void openMenu();
}

function pick(item: TerminalSelectItem): void {
  closeMenu();
  emit("pick", item.value);
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
  const focus = (next: number) => {
    event.preventDefault();
    event.stopPropagation();
    items[(next + items.length) % items.length]?.focus();
  };
  if (event.key === "ArrowDown") focus(index + 1);
  else if (event.key === "ArrowUp") focus(index - 1);
  else if (event.key === "Home") focus(0);
  else if (event.key === "End") focus(items.length - 1);
  else if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    event.stopPropagation();
    // 先回到触发按钮再让浏览器处理 Tab，避免传送到 body 的列表改变 Tab 顺序。
    closeMenu();
  }
}

function outside(event: Event): void {
  const target = event.target as Node;
  if (root.value?.contains(target) || menuEl.value?.contains(target)) return;
  closeMenu(false);
}

function reposition(): void {
  if (open.value) place();
}

onDeactivated(() => closeMenu(false));
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
});

watch(
  () => props.disabled || !props.active,
  (unavailable) => {
    if (unavailable) closeMenu(false);
  },
  { flush: "sync" },
);
</script>

<template>
  <div ref="root" class="terminal-select" :class="[`is-${variant}`, { open }]">
    <button
      class="terminal-select-btn"
      type="button"
      :title="title || text"
      :aria-label="ariaLabel || text"
      :aria-expanded="open"
      :aria-controls="listId"
      aria-haspopup="listbox"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span v-if="icon" class="terminal-select-icon" aria-hidden="true" v-html="icon" />
      <span v-if="variant === 'text'" class="terminal-select-text">{{ text }}</span>
      <span v-if="caret" class="terminal-select-caret" aria-hidden="true" v-html="icons.chevronDown" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        :id="listId"
        class="terminal-select-menu"
        :class="[`is-${side}`, `is-${align}`]"
        :style="menuStyle"
        role="listbox"
        :aria-label="ariaLabel || text"
      >
        <template v-for="(item, index) in items" :key="item.value">
          <p v-if="item.group && items[index - 1]?.group !== item.group" class="terminal-select-group">{{ item.group }}</p>
          <button
            class="terminal-select-item"
            :class="{ active: item.value === value && !item.action, action: item.action }"
            type="button"
            role="option"
            :data-value="item.value"
            :title="item.label"
            tabindex="-1"
            :aria-selected="item.value === value && !item.action"
            @click="pick(item)"
            @keydown="onItemKey"
          >
            <span class="terminal-select-item-label">{{ item.label }}</span>
            <small v-if="item.hint">{{ item.hint }}</small>
            <span v-if="item.value === value && !item.action" class="terminal-select-check" aria-hidden="true" v-html="icons.check" />
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
