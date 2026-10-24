<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { createTranscript, type TranscriptBlock } from "../../kernel/transcript.ts";
import type { SubagentRow } from "./summary.ts";
import { formatDuration, subagentStateLabel } from "./summary.ts";
import BlockView from "../../components/chat/BlockView.vue";
import MarkdownBody from "../markdown/MarkdownBody.vue";

/**
 * 子代理对话弹窗：点击清单里的子任务后，像进入一个新对话一样查看它自己的记录，
 * 但只是覆盖层快照，不新建会话、不切换工作区的活动会话。
 */
const props = defineProps<{
  rows: SubagentRow[];
  initialIndex?: number;
}>();

const emit = defineEmits<{ close: [] }>();

const { workbench } = useKernel();
const index = ref(Math.max(0, Math.min(props.initialIndex ?? 0, props.rows.length - 1)));
const row = computed<SubagentRow | null>(() => props.rows[index.value] ?? null);

const blocks = ref<TranscriptBlock[]>([]);
const loading = ref(false);
const scroller = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
/** 没有会话文件（或读不到）时退回展示最终输出 */
const fallback = ref(false);

let loadToken = 0;

async function load(): Promise<void> {
  const target = row.value;
  const token = (loadToken += 1);
  blocks.value = [];
  fallback.value = false;
  loading.value = Boolean(target?.sessionFile);
  if (!target?.sessionFile) {
    fallback.value = true;
    return;
  }
  const messages = await workbench.readAgentSession(target.sessionFile);
  if (token !== loadToken) return;
  loading.value = false;
  if (!messages.length) {
    fallback.value = true;
    return;
  }
  const transcript = createTranscript();
  transcript.loadMessages(messages);
  blocks.value = transcript.blocks as TranscriptBlock[];
  await nextTick();
  // 从开头读起：这是「进入子代理对话」，不是跳到结论。
  if (scroller.value) scroller.value.scrollTop = 0;
}

function metaOf(target: SubagentRow | null): string {
  if (!target) return "";
  const parts: string[] = [];
  const duration = formatDuration(target.durationMs);
  if (duration) parts.push(duration);
  if (target.tools !== null) parts.push(`${target.tools} 工具`);
  if (target.turns !== null) parts.push(`${target.turns} 轮`);
  if (target.tokens !== null) parts.push(`${target.tokens} tok`);
  if (target.model) parts.push(target.model);
  return parts.join(" · ");
}

const hasSession = computed(() => Boolean(row.value?.sessionFile));
/** 会话本身就以任务开头时不再重复显示任务条；只有回退到最终输出时才需要它。 */
const showTask = computed(
  () => Boolean(row.value?.task) && (fallback.value || !blocks.value.some((item) => item.kind === "user")),
);
const stateLabel = computed(() => (row.value ? subagentStateLabel(row.value.state) : ""));
const output = computed(() => {
  const text = row.value?.finalOutput ?? "";
  return text.length > 60_000 ? `${text.slice(0, 60_000)}\n\n… 已截断，共 ${text.length} 字符` : text;
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
  }
}

watch(index, () => void load(), { flush: "post" });

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
  panel.value?.focus();
  void load();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <div class="subagent-modal" data-subagent-modal @wheel.self.prevent>
      <div class="subagent-modal-scrim" @click="emit('close')" />
      <section
        ref="panel"
        class="subagent-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`子代理对话：${row?.agent ?? ''}`"
        tabindex="-1"
      >
        <header class="subagent-dialog-head">
          <span class="subagent-dot" :data-state="row?.state" aria-hidden="true" />
          <span class="subagent-dialog-agent">{{ row?.agent ?? "子代理" }}</span>
          <span class="subagent-dialog-state" :data-state="row?.state">{{ stateLabel }}</span>
          <span class="subagent-dialog-meta">{{ metaOf(row) }}</span>
          <span class="subagent-dialog-spacer" />
          <span class="subagent-dialog-hint">只读快照 · Esc 关闭</span>
          <button type="button" class="subagent-dialog-close" aria-label="关闭子代理对话" @click="emit('close')">
            ×
          </button>
        </header>

        <div :class="['subagent-dialog-body', { 'with-rail': rows.length > 1 }]">
          <nav v-if="rows.length > 1" class="subagent-dialog-rail" aria-label="子任务列表">
            <button
              v-for="(item, at) in rows"
              :key="`${item.agent}-${at}`"
              type="button"
              class="subagent-rail-row"
              :class="{ active: at === index }"
              :data-state="item.state"
              :aria-current="at === index ? 'true' : undefined"
              @click="index = at"
            >
              <span class="subagent-dot" :data-state="item.state" aria-hidden="true" />
              <span class="subagent-rail-agent">{{ item.agent }}</span>
              <span class="subagent-rail-state">{{ subagentStateLabel(item.state) }}</span>
            </button>
          </nav>

          <div ref="scroller" class="subagent-dialog-thread" data-subagent-thread>
            <p v-if="showTask" class="subagent-dialog-task" :title="row!.task">{{ row!.task }}</p>
            <p v-if="loading" class="subagent-dialog-note">正在读取子代理会话…</p>
            <template v-else-if="!fallback">
              <BlockView v-for="item in blocks" :key="item.id" :block="item" />
            </template>
            <template v-else>
              <p class="subagent-dialog-note">
                {{ hasSession ? "子代理会话文件读不到，只显示最终输出。" : "这次调用没有留下子代理会话文件，只显示最终输出。" }}
              </p>
              <p v-if="row?.error" class="subagent-dialog-error">{{ row.error }}</p>
              <MarkdownBody v-if="output" :content="output" mode="chat" />
            </template>
          </div>
        </div>

        <footer v-if="row?.sessionFile" class="subagent-dialog-foot">
          <span class="subagent-dialog-path" :title="row.sessionFile">{{ row.sessionFile }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
