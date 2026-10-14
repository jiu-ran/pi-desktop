<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { GROUPS } from "./slash.ts";

/**
 * 斜杠命令菜单：按分组列出全部命令，或列出某个命令的可选参数。
 * 只负责展示与高亮，键盘选择由输入框控制。
 */
const props = defineProps({
  mode: { type: String, default: "commands" }, // commands | options
  items: { type: Array, default: () => [] },
  cursor: { type: Number, default: 0 },
  command: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(["pick", "hover"]);
const list = ref(null);

const rows = computed(() => {
  if (props.mode !== "commands") return props.items.map((item, index) => ({ type: "item", item, index }));
  const out = [];
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

watch(() => props.cursor, async () => {
  await nextTick();
  list.value?.querySelector(".slash-item.active")?.scrollIntoView({ block: "nearest" });
});
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
