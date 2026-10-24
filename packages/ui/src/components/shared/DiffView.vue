<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DiffLine } from "../../shared/diff.ts";
import { isReviewableLine, type ReviewComment, type ReviewCommentDraft } from "../../shared/review.ts";

const props = withDefaults(
  defineProps<{
    lines: DiffLine[];
    /** true 时在每行左侧显示评论按钮；用于 Git 实时 diff */
    reviewable?: boolean;
    /** 当前文件的评审意见（lineIndex 相对于可见行） */
    comments?: readonly ReviewComment[];
  }>(),
  { reviewable: false, comments: () => [] },
);

const emit = defineEmits<{
  comment: [draft: ReviewCommentDraft];
  remove: [id: string];
}>();

const visibleLines = computed(() => props.lines.filter((line) => line.type === "gap" || line.type === "meta" || line.text.length > 0));
const activeIndex = ref<number | null>(null);
const body = ref("");
const root = ref<HTMLElement | null>(null);
const composer = ref<HTMLTextAreaElement | null>(null);
/** 评论框在 v-for 里，字符串 ref 会被收成数组，这里用函数 ref 绑定单个元素。 */
const setComposer = (element: unknown): void => {
  composer.value = element instanceof HTMLTextAreaElement ? element : null;
};
/**
 * 可视宽度：评论条和评论输入框不能用 diff 内容宽度（长行会把它们撑到视口之外，
 * 「取消 / 添加」按钮跟着跑到屏幕右边），所以按滚动容器自身的宽度约束它们。
 */
const visibleWidth = ref(0);
let observer: ResizeObserver | null = null;

function measure(): void {
  visibleWidth.value = root.value?.clientWidth ?? 0;
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver === "undefined" || !root.value) return;
  observer = new ResizeObserver(measure);
  observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

/** 输入框按内容增高（最多 5 行），窄宽度下占位文案不会被裁掉。 */
function autosize(): void {
  const element = composer.value;
  if (!(element instanceof HTMLTextAreaElement)) return;
  element.style.height = "auto";
  const max = Number.parseFloat(getComputedStyle(element).maxHeight) || 200;
  element.style.height = `${Math.min(element.scrollHeight, max)}px`;
}

watch([body, activeIndex], () => {
  void nextTick(() => {
    autosize();
    if (activeIndex.value !== null) composer.value?.focus();
  });
});

function startComment(index: number): void {
  const line = visibleLines.value[index];
  if (!line || !isReviewableLine(line.type)) return;
  activeIndex.value = index;
  body.value = "";
}

function cancelComment(): void {
  activeIndex.value = null;
  body.value = "";
}

function submitComment(): void {
  const index = activeIndex.value;
  if (index === null) return;
  const line = visibleLines.value[index];
  const text = body.value.trim();
  if (!line || !text) return;
  emit("comment", {
    lineIndex: index,
    line: line.num,
    side: line.type === "del" ? "old" : "new",
    text: line.text,
    body: text,
  });
  cancelComment();
}

function commentsAt(index: number): readonly ReviewComment[] {
  return props.comments.filter((comment) => comment.lineIndex === index);
}
</script>

<template>
  <div
    v-if="visibleLines.length"
    ref="root"
    class="diff-view"
    :style="visibleWidth ? { '--diff-visible': `${visibleWidth}px` } : undefined"
  >
    <!-- diff-body 撑到最宽一行的宽度：横向滚动时短行的背景也能铺满，不会中途断开 -->
    <div class="diff-body">
      <template v-for="(line, i) in visibleLines" :key="i">
        <div class="diff-row" :data-type="line.type">
          <template v-if="line.type === 'meta'">
            <span class="diff-meta">{{ line.text }}</span>
          </template>
          <template v-else>
            <span v-if="reviewable" class="diff-comment-gutter">
              <button
                v-if="isReviewableLine(line.type)"
                type="button"
                class="diff-comment-add"
                title="添加评审意见"
                aria-label="添加评审意见"
                @click.stop="startComment(i)"
              >
                +
              </button>
            </span>
            <span class="diff-num">{{ line.num }}</span>
            <span class="diff-sign">{{ line.type === "add" ? "+" : line.type === "del" ? "−" : "" }}</span>
            <span class="diff-text">{{ line.type === "gap" ? "⋯" : line.text }}</span>
          </template>
        </div>

        <div v-for="comment in commentsAt(i)" :key="comment.id" class="diff-comment">
          <span class="diff-comment-label">评审</span>
          <span class="diff-comment-body">{{ comment.body }}</span>
          <button
            type="button"
            class="diff-comment-remove"
            title="删除这条评审意见"
            aria-label="删除这条评审意见"
            @click="emit('remove', comment.id)"
          >
            ×
          </button>
        </div>

        <div v-if="activeIndex === i" class="diff-comment-composer">
          <textarea
            :ref="setComposer"
            v-model="body"
            rows="2"
            placeholder="写下评审意见，Ctrl / Cmd + Enter 添加"
            @input="autosize"
            @keydown.ctrl.enter.prevent="submitComment"
            @keydown.meta.enter.prevent="submitComment"
            @keydown.esc.stop.prevent="cancelComment"
          />
          <div class="diff-comment-actions">
            <span>针对第 {{ line.num || "?" }} 行</span>
            <button type="button" class="btn small" @click="cancelComment">取消</button>
            <button type="button" class="btn small primary" :disabled="!body.trim()" @click="submitComment">添加</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
