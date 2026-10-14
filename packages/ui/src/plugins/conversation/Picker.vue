<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 输入框底栏的下拉选择器（模型 / 思考等级 / 发送方式）。菜单向上弹出。
 * items: [{ value, label, hint? }]
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  value: { type: [String, Number], default: "" },
  label: { type: String, default: "" },
  icon: { type: String, default: "" },
  title: { type: String, default: "" },
  filterable: { type: Boolean, default: false },
  align: { type: String, default: "left" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["pick"]);

const open = ref(false);
const root = ref(null);
const filterInput = ref(null);
const filter = ref("");

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return props.items.filter((item) => !q || `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(q));
});

async function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  filter.value = "";
  if (open.value && props.filterable) {
    await nextTick();
    filterInput.value?.focus();
  }
}

function pick(item) {
  open.value = false;
  emit("pick", item);
}

function outside(event) {
  if (root.value && !root.value.contains(event.target)) open.value = false;
}
onMounted(() => document.addEventListener("mousedown", outside));
onBeforeUnmount(() => document.removeEventListener("mousedown", outside));
</script>

<template>
  <div ref="root" class="picker">
    <button class="picker-btn" :class="{ open }" :title="title" :disabled="disabled" @click="toggle">
      <span v-if="icon" class="picker-icon" v-html="icon" />
      <span class="picker-label">{{ label }}</span>
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>
    </button>
    <div v-if="open" class="picker-menu" :class="align">
      <input v-if="filterable" ref="filterInput" v-model="filter" class="picker-filter" placeholder="筛选…" @keydown.esc="open = false" />
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
          <svg v-if="item.value === value" class="picker-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3.5 8.5 3 3 6-7" /></svg>
        </button>
        <p v-if="!visible.length" class="picker-empty">没有匹配项</p>
      </div>
    </div>
  </div>
</template>
