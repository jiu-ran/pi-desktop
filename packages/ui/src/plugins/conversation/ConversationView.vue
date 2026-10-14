<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import BlockView from "./BlockView.vue";
import Composer from "./Composer.vue";

const { workbench, contributions } = useKernel();
const ws = computed(() => workbench.active.value);
const footers = computed(() => contributions.points["timeline.footer"]);
const scroller = ref(null);
const pinned = ref(true);

/**
 * 把块切成“回合”：用户消息独占一行；两条用户消息之间的助手内容为一个回合，
 * 回合顶部显示 Air 风格的状态行（✓ 已完成 / 处理中）。
 */
const turns = computed(() => {
  const out = [];
  let turn = null;
  for (const block of ws.value?.blocks ?? []) {
    if (block.kind === "user") {
      out.push({ kind: "user", id: block.id, block });
      turn = null;
      continue;
    }
    if (!turn) {
      turn = { kind: "agent", id: `t-${block.id}`, blocks: [] };
      out.push(turn);
    }
    turn.blocks.push(block);
  }
  return out;
});
const lastAgent = computed(() => [...turns.value].reverse().find((t) => t.kind === "agent"));
const waiting = computed(() => ws.value?.streaming && turns.value.at(-1)?.kind === "user");

function turnRunning(turn) {
  return ws.value?.streaming && turn === lastAgent.value && turns.value.at(-1) === turn;
}

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function toBottom(force = false) {
  await nextTick();
  const el = scroller.value;
  if (el && (pinned.value || force)) el.scrollTop = el.scrollHeight;
}

watch(
  () => {
    const blocks = ws.value?.blocks ?? [];
    const last = blocks.at(-1);
    return `${ws.value?.cwd}|${ws.value?.sessionFile}|${blocks.length}|${last?.text?.length ?? 0}|${last?.output?.length ?? 0}`;
  },
  (next, prev) => {
    const switched = next.split("|").slice(0, 2).join() !== (prev ?? "").split("|").slice(0, 2).join();
    if (switched) pinned.value = true;
    toBottom(switched);
  },
);
</script>

<template>
  <section class="conversation">
    <div v-if="ws?.status === 'starting'" class="stage-state">
      <div class="spinner" />
      <p>正在启动 <code>pi --mode rpc</code> …</p>
    </div>

    <div v-else-if="ws?.status === 'error'" class="stage-state error">
      <h3>启动失败</h3>
      <pre>{{ ws.error }}</pre>
      <button class="btn" @click="workbench.open(ws.cwd)">重试</button>
    </div>

    <div v-else ref="scroller" class="timeline" @scroll="onScroll">
      <div class="timeline-inner">
        <div v-if="!turns.length" class="timeline-empty">
          <h2>{{ ws?.name }}</h2>
          <p>描述一个任务，Pi 会在这个项目里完成它。输入 <kbd>/</kbd> 查看技能与命令。</p>
        </div>

        <template v-for="turn in turns" :key="turn.id">
          <BlockView v-if="turn.kind === 'user'" :block="turn.block" />
          <div v-else class="turn">
            <div class="turn-state" :class="{ running: turnRunning(turn) }">
              <span v-if="turnRunning(turn)" class="mini-spinner" />
              <svg v-else viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m3.5 8.5 3 3 6-7" /></svg>
              <span>{{ turnRunning(turn) ? "处理中" : "已完成" }}</span>
            </div>
            <BlockView v-for="block in turn.blocks" :key="block.id" :block="block" />
          </div>
        </template>

        <div v-if="waiting" class="turn">
          <div class="turn-state running"><span class="mini-spinner" /><span>处理中</span></div>
        </div>

        <component :is="item.component" v-for="item in footers" :key="item.id" />
      </div>
      <button v-if="!pinned" class="jump-bottom" @click="toBottom(true)">↓ 回到底部</button>
    </div>

    <Composer v-if="ws?.status === 'ready'" />
  </section>
</template>
