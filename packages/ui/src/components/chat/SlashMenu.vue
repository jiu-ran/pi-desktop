<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { GROUPS, type SlashCommandItem } from "../../services/slash-commands.ts";

const props = withDefaults(
  defineProps<{
    mode?: "commands" | "options";
    items?: any[];
    cursor?: number;
    command?: SlashCommandItem | null;
    loading?: boolean;
  }>(),
  {
    mode: "commands",
    items: () => [],
    cursor: 0,
    command: null,
    loading: false,
  },
);

const emit = defineEmits<{
  (e: "pick", item: any): void;
  (e: "hover", index: number): void;
}>();

const list = ref<HTMLElement | null>(null);

const rows = computed(() => {
  if (props.mode !== "commands") return props.items.map((item, index) => ({ type: "item" as const, item, index }));
  const out: Array<{ type: "group"; id: string; label: string } | { type: "item"; item: any; index: number }> = [];
  let group = "";
  props.items.forEach((item, index) => {
    if (item.group !== group) {
      group = item.group;
      out.push({ type: "group", id: group, label: GROUPS.find((g) => g.id === group)?.label ?? group });
    }
    out.push({ type: "item", item, index });
  });
  return out;
});

watch(
  () => props.cursor,
  async () => {
    await nextTick();
    list.value?.querySelector(".slash-item.active")?.scrollIntoView({ block: "nearest" });
  },
);
</script>

<template>
  <div class="slash-menu" @mousedown.prevent>
    <div v-if="mode === 'options'" class="slash-head">
      <span class="slash-name">/{{ command?.name }}</span>
      <span>{{ command?.title }}</span>
      <span class="slash-head-hint">选择{{ command?.args?.replace(/[<>[\]]/g, "") || "一项" }}</span>
    </div>

    <div ref="list" class="slash-list">
      <template v-for="row in rows" :key="row.type === 'group' ? `g:${row.id}` : `i:${row.index}`">
        <div v-if="row.type === 'group'" class="slash-group">{{ row.label }}</div>

        <div
          v-else-if="mode === 'commands'"
          class="slash-item"
          :class="{ active: row.index === cursor }"
          @mouseenter="emit('hover', row.index)"
          @click="emit('pick', row.item)"
        >
          <span class="slash-name">/{{ row.item.name }}</span>
          <span v-if="row.item.args" class="slash-args">{{ row.item.args }}</span>
          <span class="slash-title">{{ row.item.title }}</span>
          <span class="slash-desc" :title="row.item.description">{{ row.item.description }}</span>
          <span v-if="row.item.scope" class="slash-src">{{ row.item.scope }}</span>
        </div>

        <div
          v-else
          class="slash-item option"
          :class="{ active: row.index === cursor }"
          @mouseenter="emit('hover', row.index)"
          @click="emit('pick', row.item)"
        >
          <span class="slash-title">{{ row.item.label }}</span>
          <span class="slash-desc">{{ row.item.hint }}</span>
          <span v-if="row.item.current" class="slash-src">当前</span>
        </div>
      </template>

      <p v-if="loading" class="slash-empty">加载中…</p>
      <p v-else-if="!items.length" class="slash-empty">{{ mode === "options" ? "没有可选项" : "没有匹配的命令" }}</p>
    </div>

    <footer class="slash-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Tab</kbd> 补全</span>
      <span><kbd>Enter</kbd> {{ mode === "options" ? "确定" : "执行" }}</span>
      <span><kbd>Esc</kbd> 关闭</span>
      <span class="slash-count">{{ items.length }} 项</span>
    </footer>
  </div>
</template>
