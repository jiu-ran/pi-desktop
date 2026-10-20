<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";

interface PreviewItem {
  src: string;
  name?: string;
}

const props = defineProps<{
  items: PreviewItem[];
  index: number | null;
}>();

const emit = defineEmits<{
  (event: "update:index", value: number | null): void;
}>();

const open = computed(
  () => props.index !== null && props.index >= 0 && props.index < props.items.length,
);
const current = computed<PreviewItem | null>(() => (open.value ? props.items[props.index as number] : null));

function close(): void {
  emit("update:index", null);
}

function step(delta: number): void {
  if (!open.value || props.items.length < 2) return;
  const next = ((props.index as number) + delta + props.items.length) % props.items.length;
  emit("update:index", next);
}

function onKey(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    step(1);
  }
}

watch(open, (value) => {
  if (typeof window === "undefined") return;
  if (value) window.addEventListener("keydown", onKey, true);
  else window.removeEventListener("keydown", onKey, true);
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open && current" class="image-lightbox" @click.self="close">
      <button type="button" class="image-lightbox-close" title="关闭（Esc）" @click="close">×</button>
      <img :src="current.src" :alt="current.name || '图片预览'" />
      <div class="image-lightbox-bar">
        <button v-if="items.length > 1" type="button" title="上一张（←）" @click="step(-1)">‹</button>
        <span class="image-lightbox-count">{{ (index ?? 0) + 1 }} / {{ items.length }}</span>
        <button v-if="items.length > 1" type="button" title="下一张（→）" @click="step(1)">›</button>
        <span v-if="current.name" class="image-lightbox-name">{{ current.name }}</span>
      </div>
    </div>
  </Teleport>
</template>
