<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { openFileInStage } from "../../plugins/files/state.ts";
import { loadRecentFiles } from "../../shared/recent-files.ts";
import { icons } from "../../shared/util.ts";
import { closeQuickOpen, quickOpenState } from "../../services/quick-open.ts";

interface QuickItem {
  relative: string;
  name: string;
  hint: string;
  recent?: boolean;
}

const { workbench, stage, bus } = useKernel();
const query = ref("");
const cursor = ref(0);
const input = ref<HTMLInputElement | null>(null);
const recent = ref<QuickItem[]>([]);
const results = ref<QuickItem[]>([]);
const searching = ref(false);
let searchToken = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function toItem(relative: string, recentItem = false): QuickItem {
  const normalized = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) ?? normalized;
  const dir = parts.slice(0, -1).join("/");
  return { relative: normalized, name, hint: dir || "项目根目录", recent: recentItem };
}

const items = computed(() => (query.value.trim() ? results.value : recent.value));

function refreshRecent(): void {
  const cwd = workbench.active.value?.cwd ?? "";
  recent.value = loadRecentFiles(cwd).map((path) => toItem(path, true));
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  const value = query.value.trim();
  const token = (searchToken += 1);
  if (!value) {
    searchTimer = null;
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    searchTimer = null;
    try {
      const entries = await workbench.completePaths(value);
      if (token !== searchToken) return;
      results.value = entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => toItem(entry.relative));
      cursor.value = 0;
    } catch {
      if (token === searchToken) results.value = [];
    } finally {
      if (token === searchToken) searching.value = false;
    }
  }, 120);
}

watch(query, scheduleSearch);

watch(
  () => quickOpenState.open,
  async (open) => {
    if (!open) {
      searchToken += 1;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = null;
      searching.value = false;
      query.value = "";
      cursor.value = 0;
      return;
    }
    refreshRecent();
    results.value = [];
    query.value = "";
    cursor.value = 0;
    await nextTick();
    input.value?.focus();
  },
  // 打开动作可能来自命令面板；等 DOM 更新完成后再抢焦点，避免焦点留在输入框。
  { flush: "post" },
);

function close(): void {
  closeQuickOpen();
}

async function run(item: QuickItem | undefined): Promise<void> {
  if (!item) return;
  close();
  try {
    await openFileInStage(workbench, stage, bus, item.relative);
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  }
}

function onKey(event: KeyboardEvent): void {
  if (!quickOpenState.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (!items.value.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    cursor.value = (cursor.value + 1) % items.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    cursor.value = (cursor.value - 1 + items.value.length) % items.value.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    void run(items.value[cursor.value]);
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="quickOpenState.open" class="overlay" @mousedown.self="close">
    <div class="palette quick-open" role="dialog" aria-label="快速打开文件">
      <input
        ref="input"
        v-model="query"
        placeholder="快速打开文件，输入文件名或路径…"
        spellcheck="false"
        aria-label="搜索文件"
      />
      <div v-if="searching" class="quick-open-state"><span class="mini-spinner" />正在搜索文件…</div>
      <div class="palette-list quick-open-list">
        <button
          v-for="(item, index) in items"
          :key="item.relative"
          type="button"
          class="palette-item quick-open-item"
          :class="{ active: index === cursor }"
          @mouseenter="cursor = index"
          @click="run(item)"
        >
          <span class="quick-open-icon" v-html="icons.file" />
          <span class="quick-open-name">{{ item.name }}</span>
          <span class="quick-open-path">{{ item.hint }}</span>
          <span v-if="item.recent" class="quick-open-tag">最近</span>
        </button>
        <p v-if="!items.length && !searching" class="quick-open-state">
          {{ query.trim() ? "没有匹配的文件" : "还没有最近打开的文件，输入文件名开始搜索" }}
        </p>
      </div>
      <footer class="quick-open-foot">
        <span v-if="query.trim()">模糊匹配项目和文件名</span>
        <span v-else>最近打开</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 关闭</span>
      </footer>
    </div>
  </div>
</template>
