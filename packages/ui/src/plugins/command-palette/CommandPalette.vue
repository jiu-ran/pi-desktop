<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { paletteState } from "./state.js";

/** 命令面板：列出所有插件贡献的 commands，外加斜杠命令（内置 + Pi 的扩展 / 模板 / 技能）。 */
const { contributions, workbench, runCommand, bus } = useKernel();
const SOURCE = { extension: "扩展", prompt: "模板", skill: "技能" };

/** 把命令填进输入框，由输入框负责展示参数与执行 */
function fill(text) {
  const ws = workbench.active.value;
  if (!ws) return;
  ws.draft = text;
  requestAnimationFrame(() => document.querySelector(".composer textarea")?.focus());
}
const query = ref("");
const cursor = ref(0);
const input = ref(null);

const items = computed(() => {
  const local = contributions.points.commands.map((cmd) => ({
    key: `cmd:${cmd.id}`, title: cmd.title, hint: "", keys: cmd.keybinding ?? "", group: "桌面", run: () => runCommand(cmd.id),
  }));
  const hasWs = Boolean(workbench.active.value);
  const slash = hasWs ? contributions.points.slash.map((cmd) => ({
    key: `slash:${cmd.name}`, title: cmd.title, hint: cmd.description ?? "", keys: `/${cmd.name}`, group: "命令",
    run: () => {
      if (cmd.args || cmd.options) fill(`/${cmd.name} `);
      else Promise.resolve(cmd.run("")).catch((error) => bus.emit("notify", { level: "error", text: error?.message ?? String(error) }));
    },
  })) : [];
  const remote = (workbench.active.value?.commands ?? []).map((cmd) => ({
    key: `pi:${cmd.name}`, title: cmd.description || `/${cmd.name}`, hint: "", keys: `/${cmd.name}`, group: SOURCE[cmd.source] ?? cmd.source,
    run: () => fill(`/${cmd.name} `),
  }));
  const q = query.value.trim().toLowerCase();
  return [...local, ...slash, ...remote].filter((item) => !q || `${item.title} ${item.hint} ${item.keys}`.toLowerCase().includes(q)).slice(0, 60);
});

watch(() => paletteState.open, async (open) => {
  if (!open) return;
  query.value = "";
  cursor.value = 0;
  await nextTick();
  input.value?.focus();
});
watch(items, () => { cursor.value = 0; });

async function pick(item) {
  paletteState.open = false;
  await item?.run();
}

function onKey(event) {
  if (event.key === "Escape") paletteState.open = false;
  else if (event.key === "ArrowDown") { cursor.value = Math.min(cursor.value + 1, items.value.length - 1); event.preventDefault(); }
  else if (event.key === "ArrowUp") { cursor.value = Math.max(cursor.value - 1, 0); event.preventDefault(); }
  else if (event.key === "Enter") { event.preventDefault(); pick(items.value[cursor.value]); }
}
</script>

<template>
  <div v-if="paletteState.open" class="modal-backdrop top" @mousedown.self="paletteState.open = false">
    <div class="palette" @keydown="onKey">
      <input ref="input" v-model="query" class="palette-input" placeholder="搜索命令…" />
      <ul class="palette-list">
        <li
          v-for="(item, i) in items"
          :key="item.key"
          :class="{ active: i === cursor }"
          @mouseenter="cursor = i"
          @mousedown.prevent="pick(item)"
        >
          <span class="palette-group">{{ item.group }}</span>
          <span class="palette-main">
            <span class="palette-title">{{ item.title }}</span>
            <span v-if="item.hint" class="palette-hint">{{ item.hint }}</span>
          </span>
          <kbd v-if="item.keys" class="palette-keys">{{ item.keys }}</kbd>
        </li>
        <li v-if="!items.length" class="palette-empty">没有匹配的命令</li>
      </ul>
    </div>
  </div>
</template>
