<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { baseName, icons } from "../../shared/util.ts";
import { collectChanges, totals } from "../../shared/diff.ts";
import BlockView from "./BlockView.vue";
import Composer from "./Composer.vue";
import WelcomeView from "./WelcomeView.vue";

const { workbench, bus } = useKernel();
let stopHeightChange: (() => void) | null = null;
const ws = computed(() => workbench.active.value);
const scroller = ref<HTMLElement | null>(null);
const stick = ref(true);
const searchOpen = ref(false);
const searchQuery = ref("");
const searchIndex = ref(0);
let scrollFrame = 0;
let scrollForce = false;

// 分页加载状态
const isLoadingMore = ref(false);
const loadMoreError = ref("");
const messageLoadingThrottle = ref(0);

const prompts = [
  { label: "浏览代码结构", text: "先快速看一下这个项目的目录结构和关键入口，简要告诉我。" },
  { label: "查找未完成问题", text: "检查仓库里的 TODO / FIXME 或明显未收尾的地方，列出值得处理的几项。" },
  { label: "解释最近改动", text: "运行 git status 和 git log -n 5，总结最近在做什么。" },
];

const changedFiles = computed(() => collectChanges(ws.value?.blocks));
const changedTotals = computed(() => totals(changedFiles.value));

// 是否还有更早的消息可加载：historyStart > 0 表示还没读到文件开头
const canLoadMore = computed(() => {
  const thread = ws.value?.activeThread;
  if (!thread) return false;
  return thread.historyStart > 0 && !thread.loadingMore;
});

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
  
  // 检测是否滚到顶部，触发加载更多
  const isNearTop = el.scrollTop < 100;
  if (isNearTop && canLoadMore.value && !isLoadingMore.value) {
    void loadMoreMessages();
  }
}

function scrollToBottom(force = false): void {
  if (!force && !stick.value) return;
  scrollForce ||= force;
  if (scrollFrame) return;
  const schedule = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => window.setTimeout(callback, 16);
  scrollFrame = schedule(() => {
    scrollFrame = 0;
    const shouldScroll = scrollForce || stick.value;
    scrollForce = false;
    if (!shouldScroll) return;
    void nextTick(() => {
      const el = scroller.value;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }) as number;
}

function onSearchKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || !ws.value) return;
  event.preventDefault();
  searchOpen.value = true;
  void nextTick(() => scroller.value?.parentElement?.querySelector<HTMLInputElement>(".chat-search-input")?.focus());
}

// 加载更多消息
async function loadMoreMessages(): Promise<void> {
  const thread = ws.value?.activeThread;
  const cwd = ws.value?.cwd;
  if (!thread || !cwd || !thread.sessionFile) return;
  if (thread.loadingMore || thread.historyStart <= 0) return;

  // 防止连续触发
  const now = Date.now();
  if (now - messageLoadingThrottle.value < 500) return;
  messageLoadingThrottle.value = now;

  const scrollerEl = scroller.value;
  const prevScrollHeight = scrollerEl?.scrollHeight ?? 0;
  const prevScrollTop = scrollerEl?.scrollTop ?? 0;

  try {
    isLoadingMore.value = true;
    loadMoreError.value = "";
    const result = await workbench.loadMoreMessages(cwd, thread.sessionFile);
    if (result.loaded === 0) {
      // 已到文件开头
      thread.historyStart = 0;
      return;
    }
    // 保持滚动位置（防止顶部插入后画面跳动）
    void nextTick(() => {
      if (!scrollerEl) return;
      const heightDiff = scrollerEl.scrollHeight - prevScrollHeight;
      scrollerEl.scrollTop = prevScrollTop + heightDiff;
    });
  } catch (error: any) {
    console.error("Failed to load more messages:", error);
    loadMoreError.value = `加载历史消息失败：${error?.message ?? String(error)}`;
    bus.emit("notify", { level: "error", text: loadMoreError.value });
  } finally {
    isLoadingMore.value = false;
  }
}

onMounted(() => {
  stopHeightChange = bus.on("markdown:height-change", () => scrollToBottom());
  window.addEventListener("keydown", onSearchKey);
});

onBeforeUnmount(() => {
  stopHeightChange?.();
  window.removeEventListener("keydown", onSearchKey);
  if (scrollFrame) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(scrollFrame);
    else window.clearTimeout(scrollFrame);
    scrollFrame = 0;
  }
});

watch(
  () => [
    ws.value?.cwd,
    ws.value?.sessionFile,
    ws.value?.blocks.length,
    (ws.value?.blocks.at(-1) as any)?.text?.length,
    (ws.value?.blocks.at(-1) as any)?.output?.length,
  ],
  () => {
    scrollToBottom();
  },
);

function fillPrompt(text: string): void {
  if (ws.value) bus.emit("composer:set", { cwd: ws.value.cwd, text });
}

function openChangesPanel(): void {
  workbench.state.activePanelId = "changes";
}

function blockText(block: any): string {
  return [block.text, block.output, block.name, block.args ? JSON.stringify(block.args) : ""].filter(Boolean).join("\n");
}

const outline = computed(() => (ws.value?.blocks ?? [])
  .filter((block) => block.kind === "user" && block.text?.trim())
  .map((block) => ({ id: block.id, text: block.text!.replace(/\s+/g, " ").trim() })));

const copyTextByIndex = computed(() => {
  const result = new Map<number, string>();
  const blocks = ws.value?.blocks ?? [];
  let parts: string[] = [];
  let last = -1;
  const finish = () => {
    if (last >= 0 && !blocks[last]?.streaming) result.set(last, parts.join("\n\n"));
    parts = [];
    last = -1;
  };
  blocks.forEach((block, index) => {
    if (block.kind === "user") finish();
    else if (block.kind === "text" && block.text?.trim()) {
      parts.push(block.text);
      last = index;
    }
  });
  finish();
  return result;
});

function openOutline(id: string): void {
  scroller.value?.querySelector(`[data-block-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
}

const searchMatches = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return [];
  return (ws.value?.blocks ?? []).filter((block: any) => blockText(block).toLowerCase().includes(query));
});

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) {
    searchQuery.value = "";
    searchIndex.value = 0;
  }
}

function moveSearch(direction: number): void {
  const count = searchMatches.value.length;
  if (!count) return;
  searchIndex.value = (searchIndex.value + direction + count) % count;
  focusSearchMatch();
}

function focusSearchMatch(): void {
  const block = searchMatches.value[searchIndex.value] as { id?: string } | undefined;
  if (!block?.id) return;
  void nextTick(() => {
    const container = scroller.value?.querySelector(`[data-block-id="${CSS.escape(block.id!)}"]`);
    const mark = container?.querySelector("mark.search-mark");
    (mark ?? container)?.scrollIntoView({ block: "center" });
  });
}

watch(searchMatches, () => {
  searchIndex.value = 0;
  focusSearchMatch();
});
</script>

<template>
  <section class="area-chat">
    <WelcomeView v-if="!ws" />

    <template v-else>
      <div v-if="searchOpen" class="chat-search">
        <span class="chat-search-count">{{ searchMatches.length ? searchIndex + 1 : 0 }}/{{ searchMatches.length }}</span>
        <input v-model="searchQuery" class="chat-search-input" placeholder="搜索当前对话" @keydown.enter.prevent="moveSearch(1)" @keydown.esc="toggleSearch">
        <button type="button" title="上一个" @click="moveSearch(-1)">↑</button>
        <button type="button" title="下一个" @click="moveSearch(1)">↓</button>
        <button type="button" title="关闭" @click="toggleSearch">×</button>
      </div>
      <div class="chat-body">
      <div ref="scroller" class="timeline" @scroll="onScroll">
        <div class="timeline-inner">
          <!-- 加载更多提示 -->
          <div v-if="isLoadingMore" class="loading-more">
            <span class="mini-spinner" />
            <span>加载更多消息...</span>
          </div>
          
          <!-- 加载错误提示 -->
          <div v-if="loadMoreError" class="load-error">
            <span>⚠️ {{ loadMoreError }}</span>
            <button type="button" @click="loadMoreMessages">重试</button>
          </div>
          
          <!-- 已加载全部消息提示 -->
          <div v-if="ws.activeThread && ws.activeThread.historyStart === 0 && ws.activeThread.messageTotal > 8" class="all-loaded">
            <span>✓ 已加载全部 {{ ws.activeThread.messageTotal }} 条消息</span>
          </div>
          <div v-else-if="ws.activeThread && ws.activeThread.historyStart > 0" class="all-loaded">
            <span>已加载最近 {{ ws.activeThread.messageTotal - ws.activeThread.historyStart }} / {{ ws.activeThread.messageTotal }} 条消息 · 继续上滑加载更早</span>
          </div>
          
          <div v-if="ws.loading && !ws.blocks.length" class="empty-thread">
            <span class="mini-spinner" />
            <p>正在连接 Pi…</p>
          </div>

          <div v-else-if="!ws.blocks.length" class="empty-thread">
            <p class="empty-kicker">{{ baseName(ws.cwd) }}</p>
            <h2>你想在这个项目里做什么？</h2>
            <div class="starter-list">
              <button v-for="p in prompts" :key="p.label" class="starter" @click="fillPrompt(p.text)">
                <span>{{ p.label }}</span>
                <small>{{ p.text }}</small>
              </button>
            </div>
          </div>

          <template v-else>
            <div
              v-for="(block, index) in ws.blocks"
              :key="block.id"
              :data-block-id="block.id"
              :class="{ 'search-hit': searchMatches[searchIndex]?.id === block.id }"
            >
              <BlockView :block="block" :query="searchQuery" :copy-text="copyTextByIndex.get(index) ?? ''" />
            </div>
            <div v-if="ws.streaming && ws.blocks.at(-1)?.kind === 'user'" class="thinking-hint">
              <span class="mini-spinner" />思考中…
            </div>
          </template>
        </div>
      </div>
      <aside v-if="outline.length" class="chat-outline">
          <button v-for="item in outline" :key="item.id" :title="item.text" @click="openOutline(item.id)">{{ item.text }}</button>
        </aside>
      </div>

      <div v-if="changedFiles.length" class="changes-bar">
        <button class="changes-bar-main" @click="openChangesPanel">
          <span class="changes-bar-icon" v-html="icons.diff" />
          <strong>{{ changedFiles.length }} 个文件已变更</strong>
          <span class="diff-stat">
            <b class="add">+{{ changedTotals.added }}</b>
            <b class="del">−{{ changedTotals.removed }}</b>
          </span>
          <span class="changes-bar-files">
            <span v-for="f in changedFiles.slice(0, 4)" :key="f.path" class="changes-chip">{{ f.name }}</span>
          </span>
          <span class="changes-bar-more">在右侧查看改动</span>
        </button>
      </div>

      <Composer />
    </template>
  </section>
</template>

<style scoped>
.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  gap: 12px;
  background: var(--error-bg, rgba(239, 68, 68, 0.1));
  color: var(--error, #ef4444);
  font-size: 12px;
  border-bottom: 1px solid var(--error, #ef4444);
}

.load-error button {
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--error, #ef4444);
  background: transparent;
  color: var(--error, #ef4444);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s;
}

.load-error button:hover {
  background: var(--error, #ef4444);
  color: white;
}

.all-loaded {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  border-bottom: 1px solid var(--border-subtle);
}
</style>
