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
let scrollFrame = 0;
let scrollForce = false;

const prompts = [
  { label: "浏览代码结构", text: "先快速看一下这个项目的目录结构和关键入口，简要告诉我。" },
  { label: "查找未完成问题", text: "检查仓库里的 TODO / FIXME 或明显未收尾的地方，列出值得处理的几项。" },
  { label: "解释最近改动", text: "运行 git status 和 git log -n 5，总结最近在做什么。" },
];

const changedFiles = computed(() => collectChanges(ws.value?.blocks));
const changedTotals = computed(() => totals(changedFiles.value));

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
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

onMounted(() => {
  stopHeightChange = bus.on("markdown:height-change", () => scrollToBottom());
});
onBeforeUnmount(() => {
  stopHeightChange?.();
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
  () => scrollToBottom(),
);

function fillPrompt(text: string): void {
  if (ws.value) bus.emit("composer:set", { cwd: ws.value.cwd, text });
}

function openChangesPanel(): void {
  workbench.state.activePanelId = "changes";
}
</script>

<template>
  <section class="area-chat">
    <WelcomeView v-if="!ws" />

    <template v-else>
      <div ref="scroller" class="timeline" @scroll="onScroll">
        <div class="timeline-inner">
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
            <BlockView v-for="block in ws.blocks" :key="block.id" :block="block" />
            <div v-if="ws.streaming && ws.blocks.at(-1)?.kind === 'user'" class="thinking-hint">
              <span class="mini-spinner" />思考中…
            </div>
          </template>
        </div>
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
