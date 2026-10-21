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
let ignoreScroll = false;
let ignoreScrollTimer = 0;
let settleTimer = 0;
let userScrolled = false;
let resizeObserver: ResizeObserver | null = null;
let boundScroller: HTMLElement | null = null;

// 分页加载状态
const isLoadingMore = ref(false);
const loadMoreError = ref("");
const messageLoadingThrottle = ref(0);

// 上滑加载历史时的动效状态
const historyLoading = ref(false);
const historyNotice = ref("");
const historyEnterIds = ref<Set<string>>(new Set());
let historyNoticeTimer = 0;
let historyEnterTimer = 0;
let historyLoadToken = 0;
// 即使本地历史读取很快，也让「正在加载」动效完整播放，避免一闪而过。
const HISTORY_LOADING_MIN_MS = 450;

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

function setScrollTop(el: HTMLElement, top: number): void {
  // 程序化滚动也会触发 scroll 事件，不能让 onScroll 把“贴底”误判成用户上翻，
  // 否则首屏还没滚到底就被标记成 stick=false。
  ignoreScroll = true;
  el.scrollTop = top;
  if (ignoreScrollTimer) window.clearTimeout(ignoreScrollTimer);
  ignoreScrollTimer = window.setTimeout(() => {
    ignoreScroll = false;
    ignoreScrollTimer = 0;
  }, 120);
}

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  if (ignoreScroll) return;
  // 刚打开会话时 hydrate / DOM 替换会触发非用户滚动，不能据此放弃贴底。
  // 用户一旦用滚轮、触摸、滚动条或键盘滚动，userScrolled 才置真。
  if (!userScrolled) return;
  
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
  
  // 检测是否滚到顶部，触发加载更多
  const isNearTop = el.scrollTop < 100;
  if (isNearTop && canLoadMore.value && !isLoadingMore.value) {
    void loadMoreMessages();
  }
}

function scrollToBottom(force = false): void {
  if (force) stick.value = true;
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
      if (el) setScrollTop(el, el.scrollHeight);
    });
  }) as number;
}

/** 会话打开阶段连续贴底，等 hydrate 和异步内容稳定后再交还给用户滚动。 */
function settleAtBottom(): void {
  userScrolled = false;
  stick.value = true;
  scrollToBottom(true);
  if (settleTimer) window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    settleTimer = 0;
    if (!userScrolled) scrollToBottom(true);
  }, 320);
}

function markUserScroll(): void {
  userScrolled = true;
}

/** 只把“点在滚动条上”当成用户滚动，避免点卡片/复制按钮也取消自动贴底。 */
function onPointerDown(event: PointerEvent): void {
  const el = scroller.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const onScrollbar = event.clientX - rect.left >= el.clientWidth || event.clientY - rect.top >= el.clientHeight;
  if (onScrollbar) userScrolled = true;
}

function onWindowFocus(): void {
  // 窗口在后台时 rAF 可能被节流，首屏贴底没执行；重新获得焦点时补一次。
  if (!userScrolled) scrollToBottom(true);
  else if (stick.value) scrollToBottom();
}

function onScrollKey(event: KeyboardEvent): void {
  const el = scroller.value;
  if (!el) return;
  const active = document.activeElement;
  if (active !== el && !el.contains(active)) return;
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
    userScrolled = true;
  }
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
  if (isLoadingMore.value || thread.loadingMore || thread.historyStart <= 0) return;

  // 防止连续触发
  const now = Date.now();
  if (now - messageLoadingThrottle.value < 500) return;
  messageLoadingThrottle.value = now;

  const token = ++historyLoadToken;
  const startedAt = performance.now();
  isLoadingMore.value = true;
  historyLoading.value = true;
  historyNotice.value = "";
  loadMoreError.value = "";
  let successNotice = "";
  if (historyNoticeTimer) {
    window.clearTimeout(historyNoticeTimer);
    historyNoticeTimer = 0;
  }

  const scrollerEl = scroller.value;
  const prevScrollHeight = scrollerEl?.scrollHeight ?? 0;
  const prevScrollTop = scrollerEl?.scrollTop ?? 0;
  const beforeIds = new Set(thread.blocks.map((block) => block.id));

  try {
    const result = await workbench.loadMoreMessages(cwd, thread.sessionFile);
    if (result.loaded === 0) {
      // 已到文件开头
      thread.historyStart = 0;
      return;
    }

    const addedIds = thread.blocks
      .filter((block) => !beforeIds.has(block.id))
      .map((block) => block.id);
    if (addedIds.length && ws.value?.activeThread === thread) {
      // 只让新插入的块做进入动画；动画只用 opacity/transform，不改变高度，
      // 因此不会影响下面“保持滚动位置”的计算。
      historyEnterIds.value = new Set(addedIds);
      successNotice = `已加载 ${result.loaded} 条更早消息`;
      if (historyEnterTimer) window.clearTimeout(historyEnterTimer);
      historyEnterTimer = window.setTimeout(() => {
        historyEnterIds.value = new Set();
        historyEnterTimer = 0;
      }, 700);
    }

    // 保持滚动位置（防止顶部插入后画面跳动）
    void nextTick(() => {
      if (!scrollerEl) return;
      const heightDiff = scrollerEl.scrollHeight - prevScrollHeight;
      setScrollTop(scrollerEl, prevScrollTop + heightDiff);
    });
  } catch (error: any) {
    console.error("Failed to load more messages:", error);
    clearHistoryFeedback();
    loadMoreError.value = `加载历史消息失败：${error?.message ?? String(error)}`;
    bus.emit("notify", { level: "error", text: loadMoreError.value });
  } finally {
    // 读取可能只花几十毫秒；保留一小段最短展示时间，让加载动效可见。
    if (token === historyLoadToken) {
      const remaining = HISTORY_LOADING_MIN_MS - (performance.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      }
      if (token === historyLoadToken) {
        historyLoading.value = false;
        isLoadingMore.value = false;
        if (successNotice && ws.value?.activeThread === thread) {
          historyNotice.value = successNotice;
          if (historyNoticeTimer) window.clearTimeout(historyNoticeTimer);
          historyNoticeTimer = window.setTimeout(() => {
            historyNotice.value = "";
            historyNoticeTimer = 0;
          }, 1800);
        }
      }
    }
  }
}

function clearHistoryFeedback(): void {
  historyLoadToken += 1;
  if (historyEnterTimer) window.clearTimeout(historyEnterTimer);
  if (historyNoticeTimer) window.clearTimeout(historyNoticeTimer);
  historyEnterTimer = 0;
  historyNoticeTimer = 0;
  historyEnterIds.value = new Set();
  historyNotice.value = "";
  historyLoading.value = false;
  isLoadingMore.value = false;
}

function bindScroller(el: HTMLElement | null): void {
  if (boundScroller === el) return;
  if (boundScroller) {
    boundScroller.removeEventListener("wheel", markUserScroll);
    boundScroller.removeEventListener("touchmove", markUserScroll);
    boundScroller.removeEventListener("pointerdown", onPointerDown);
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  boundScroller = el;
  if (!el) return;
  el.addEventListener("wheel", markUserScroll, { passive: true });
  el.addEventListener("touchmove", markUserScroll, { passive: true });
  el.addEventListener("pointerdown", onPointerDown);
  const inner = el.firstElementChild;
  if (inner && typeof ResizeObserver !== "undefined") {
    // 图片、代码高亮等异步撑高内容时也能继续贴底；用户上翻后 stick=false 则不打扰。
    resizeObserver = new ResizeObserver(() => {
      if (!userScrolled) scrollToBottom(true);
      else scrollToBottom();
    });
    resizeObserver.observe(inner);
  }
  if (!userScrolled) scrollToBottom(true);
}

// ws 初始为空时 .timeline 还没渲染，onMounted 里拿不到 ref；
// 必须在 ref 出现/消失时绑定事件和 ResizeObserver。
watch(scroller, (el) => bindScroller((el as HTMLElement | null) ?? null), {
  immediate: true,
  flush: "post",
});

onMounted(() => {
  stopHeightChange = bus.on("markdown:height-change", () => {
    if (!userScrolled) scrollToBottom(true);
    else scrollToBottom();
  });
  window.addEventListener("keydown", onSearchKey);
  window.addEventListener("keydown", onScrollKey);
  window.addEventListener("focus", onWindowFocus);
});

onBeforeUnmount(() => {
  stopHeightChange?.();
  window.removeEventListener("keydown", onSearchKey);
  window.removeEventListener("keydown", onScrollKey);
  window.removeEventListener("focus", onWindowFocus);
  bindScroller(null);
  if (ignoreScrollTimer) window.clearTimeout(ignoreScrollTimer);
  if (settleTimer) window.clearTimeout(settleTimer);
  clearHistoryFeedback();
  if (scrollFrame) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(scrollFrame);
    else window.clearTimeout(scrollFrame);
    scrollFrame = 0;
  }
});

// 切换会话/工作区时总是回到新会话底部；否则从旧会话的阅读位置切过来会停在半空。
watch(
  () => [ws.value?.cwd, ws.value?.sessionFile],
  () => {
    clearHistoryFeedback();
    settleAtBottom();
  },
);

// 历史消息 hydrate 完成后再贴底一次：分页加载、图片解码都可能晚于首屏渲染。
watch(
  () => ws.value?.activeThread?.loaded,
  (loaded) => {
    if (!loaded) return;
    settleAtBottom();
  },
  { immediate: true },
);

watch(
  () => [
    ws.value?.blocks.length,
    (ws.value?.blocks.at(-1) as any)?.text?.length,
    (ws.value?.blocks.at(-1) as any)?.output?.length,
  ],
  () => {
    if (!userScrolled) scrollToBottom(true);
    else scrollToBottom();
  },
);

function fillPrompt(text: string): void {
  if (ws.value) bus.emit("composer:set", { cwd: ws.value.cwd, text });
}

function openChangesPanel(): void {
  workbench.state.activePanelId = "git";
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
      <Transition name="history-notice">
        <div
          v-if="historyLoading || historyNotice"
          class="history-notice"
          :class="{ 'is-loading': historyLoading }"
          role="status"
          aria-live="polite"
        >
          <span v-if="historyLoading" class="mini-spinner" />
          <span v-else class="history-notice-arrow">↑</span>
          <span>{{ historyLoading ? "正在加载更早消息" : historyNotice }}</span>
          <span v-if="historyLoading" class="history-loading-dots" aria-hidden="true"><i /><i /><i /></span>
        </div>
      </Transition>
      <div ref="scroller" class="timeline" @scroll="onScroll">
        <div class="timeline-inner">
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
              :class="{ 'search-hit': searchMatches[searchIndex]?.id === block.id, 'history-enter': historyEnterIds.has(block.id) }"
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
.chat-body {
  position: relative;
}

.history-enter {
  animation: history-enter 320ms cubic-bezier(0.22, 0.7, 0.24, 1) both;
}

@keyframes history-enter {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.history-notice {
  position: absolute;
  z-index: 7;
  top: 10px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-2) 92%, transparent);
  backdrop-filter: blur(8px);
  color: var(--fg-2);
  font-size: 12px;
  box-shadow: var(--shadow);
  pointer-events: none;
  transform: translateX(-50%);
}

.history-notice-arrow {
  color: var(--accent);
  font-weight: 600;
}

.history-notice.is-loading {
  color: var(--fg);
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--bg-2) 94%, transparent) 20%,
    color-mix(in srgb, var(--accent) 24%, var(--bg-2)) 50%,
    color-mix(in srgb, var(--bg-2) 94%, transparent) 80%
  );
  background-size: 220% 100%;
  animation: history-pill-shimmer 1.15s linear infinite;
}

.history-loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 1px;
}

.history-loading-dots i {
  display: block;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.3;
  animation: history-dot 1s ease-in-out infinite;
}

.history-loading-dots i:nth-child(2) { animation-delay: 140ms; }
.history-loading-dots i:nth-child(3) { animation-delay: 280ms; }

@keyframes history-pill-shimmer {
  from { background-position: 120% 0; }
  to { background-position: -120% 0; }
}

@keyframes history-dot {
  0%, 75%, 100% { opacity: 0.3; transform: translateY(0); }
  35% { opacity: 1; transform: translateY(-2px); }
}

.history-notice-enter-active,
.history-notice-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.history-notice-enter-from,
.history-notice-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}

@media (prefers-reduced-motion: reduce) {
  .history-enter,
  .history-notice.is-loading,
  .history-loading-dots i,
  .history-notice .mini-spinner {
    animation: none;
  }
  .history-notice-enter-active,
  .history-notice-leave-active {
    transition: none;
  }
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
