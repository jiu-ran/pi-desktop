<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { paletteState } from "../../services/command-palette.ts";

const { commands, workbench } = useKernel();
const query = ref("");
const cursor = ref(0);
const input = ref<HTMLInputElement | null>(null);

const items = computed(() => {
  const q = query.value.trim().toLowerCase();
  const wsCommands = (workbench.active.value?.commands ?? []).map((cmd: any) => ({
    id: `pi:${cmd.name}`,
    title: `/${cmd.name}`,
    category: cmd.source || "Pi",
    hint: cmd.description || "",
    keybinding: "",
    run: () => workbench.send(`/${cmd.name}`),
  }));
  const all = [...commands, ...wsCommands];
  return all.filter((c) => !q || `${c.title} ${c.category ?? ""} ${c.hint ?? ""} ${c.keybinding ?? ""}`.toLowerCase().includes(q));
});

watch(
  () => paletteState.open,
  async (open) => {
    if (!open) return;
    query.value = "";
    cursor.value = 0;
    await nextTick();
    input.value?.focus();
  },
);

watch(query, () => {
  cursor.value = 0;
});

function close(): void {
  paletteState.open = false;
}

async function run(item: any): Promise<void> {
  if (!item) return;
  close();
  await item.run();
}

function onKey(event: KeyboardEvent): void {
  if (!paletteState.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowDown" && items.value.length) {
    event.preventDefault();
    cursor.value = (cursor.value + 1) % items.value.length;
  } else if (event.key === "ArrowUp" && items.value.length) {
    event.preventDefault();
    cursor.value = (cursor.value - 1 + items.value.length) % items.value.length;
  } else if (event.key === "Enter" && items.value.length) {
    event.preventDefault();
    run(items.value[cursor.value]);
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="paletteState.open" class="overlay" @mousedown.self="close">
    <div class="palette">
      <input ref="input" v-model="query" placeholder="输入命令或搜索操作…" />
      <div class="palette-list">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          class="palette-item"
          :class="{ active: index === cursor }"
          @mouseenter="cursor = index"
          @click="run(item)"
        >
          <span v-if="item.category" class="badge">{{ item.category }}</span>
          <span class="palette-title">{{ item.title }}</span>
          <span v-if="item.keybinding || item.hint" class="palette-hint">{{ item.keybinding || item.hint }}</span>
        </button>
        <p v-if="!items.length" class="empty">没有匹配的命令</p>
      </div>
    </div>
  </div>
</template>
