<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

export interface PickerItem {
  value: string | number;
  label: string;
  hint?: string;
  model?: any;
}

const props = withDefaults(
  defineProps<{
    items?: PickerItem[];
    value?: string | number;
    label?: string;
    icon?: string;
    title?: string;
    filterable?: boolean;
    align?: string;
    disabled?: boolean;
  }>(),
  {
    items: () => [],
    value: "",
    label: "",
    icon: "",
    title: "",
    filterable: false,
    align: "left",
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: "pick", item: PickerItem): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const filterInput = ref<HTMLInputElement | null>(null);
const filter = ref("");
const offsetX = ref(0);

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return props.items.filter((item) => !q || `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(q));
});

async function toggle(): Promise<void> {
  if (props.disabled) return;
  open.value = !open.value;
  filter.value = "";
  offsetX.value = 0;
  if (open.value) {
    await nextTick();
    const menu = menuEl.value;
    const container = root.value?.closest(".island") ?? document.documentElement;
    if (menu && container) {
      const mRect = menu.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      if (mRect.right > cRect.right - 8) {
        offsetX.value = Math.max(cRect.left + 8 - mRect.left, cRect.right - 8 - mRect.right);
      } else if (mRect.left < cRect.left + 8) {
        offsetX.value = cRect.left + 8 - mRect.left;
      }
    }
    if (props.filterable) {
      filterInput.value?.focus();
    }
  }
}

function pick(item: PickerItem): void {
  open.value = false;
  emit("pick", item);
}

function outside(event: Event): void {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("click", outside);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("click", outside);
});
</script>

<template>
  <div ref="root" class="picker">
    <button class="picker-btn" :class="{ open }" :title="title" :disabled="disabled" @click="toggle">
      <span v-if="icon" class="picker-icon" v-html="icon" />
      <span class="picker-label">{{ label }}</span>
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      </svg>
    </button>
    <div
      v-if="open"
      ref="menuEl"
      class="picker-menu"
      :class="align"
      :style="offsetX ? { transform: `translateX(${Math.round(offsetX)}px)` } : undefined"
    >
      <input
        v-if="filterable"
        ref="filterInput"
        v-model="filter"
        class="picker-filter"
        placeholder="筛选…"
        @keydown.esc="open = false"
      />
      <div class="picker-items">
        <button
          v-for="item in visible"
          :key="item.value"
          class="picker-item"
          :class="{ active: item.value === value }"
          @click="pick(item)"
        >
          <span class="picker-item-label">{{ item.label }}</span>
          <small v-if="item.hint">{{ item.hint }}</small>
          <svg
            v-if="item.value === value"
            class="picker-check"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </button>
        <p v-if="!visible.length" class="picker-empty">没有匹配项</p>
      </div>
    </div>
  </div>
</template>
