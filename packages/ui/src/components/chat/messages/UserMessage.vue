<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { KERNEL_KEY } from "../../../kernel/index.ts";
import type { TranscriptBlock, TranscriptImage } from "../../../kernel/transcript.ts";
import { formatBytes, imageDataUrl } from "../../../shared/attachments.ts";
import { shouldCollapseUserText } from "../../../shared/chat-text.ts";
import { icons } from "../../../shared/util.ts";
import MarkdownBody from "../../../plugins/markdown/MarkdownBody.vue";
import ImageLightbox from "../ImageLightbox.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
  collapseLong?: boolean;
  /** 还在 Pi 的队列里等待发送 */
  queued?: boolean;
}>();

// 长消息折叠与技能卡片参考 ThinkRail（Apache-2.0，见 THIRD-PARTY-NOTICES.md）。
const expanded = ref(false);
const skillOpen = ref(false);
const text = computed(() => (props.block.text ?? "").trim());
const clampable = computed(() => shouldCollapseUserText(text.value, Boolean(props.collapseLong)));
const clamped = computed(() => clampable.value && !expanded.value && !props.query);
watch(
  () => props.query,
  (query) => {
    if (query) expanded.value = true;
  },
);
const files = computed(() => props.block.attachments ?? []);
const images = computed<TranscriptImage[]>(() => props.block.imageItems ?? []);
const fallbackCount = computed(() => (props.block.imageItems?.length ? 0 : props.block.images ?? 0));
const empty = computed(() => !text.value && !files.value.length && !images.value.length && !fallbackCount.value);

// ---------- 图片懒加载 ----------
// 历史分页里超过 32 KB 的图片只带 ref：分子气泡渲染时先占位，缩略图滚进视口才向后端取原图。
// 带 4K 截图的会话一条消息就能有几十 MB，不这样的话打开会话要卡好几秒。
const sources = ref<Record<number, string>>({});
const loading = ref<Record<number, boolean>>({});
const failed = ref<Record<number, boolean>>({});
const thumbs = new Map<number, HTMLElement>();
let observer: IntersectionObserver | null = null;

function applyInlineSources(): void {
  images.value.forEach((item, index) => {
    if (item.data && !sources.value[index]) sources.value[index] = imageDataUrl(item.mimeType, item.data);
  });
}

async function ensureSource(index: number): Promise<string> {
  const item = images.value[index];
  if (!item) return "";
  const ready = sources.value[index];
  if (ready) return ready;
  if (item.data) {
    sources.value[index] = imageDataUrl(item.mimeType, item.data);
    return sources.value[index] ?? "";
  }
  if (!item.ref || loading.value[index]) return "";
  loading.value[index] = true;
  failed.value[index] = false;
  try {
    const result = await kernel?.workbench?.sessionImage?.(item.ref);
    if (!result?.data) throw new Error("空图片");
    sources.value[index] = imageDataUrl(result.mimeType ?? item.mimeType, result.data);
    return sources.value[index] ?? "";
  } catch {
    failed.value[index] = true;
    return "";
  } finally {
    loading.value[index] = false;
  }
}

function observeThumb(el: Element | null, index: number): void {
  if (!(el instanceof HTMLElement)) return;
  thumbs.set(index, el);
  if (observer) observer.observe(el);
}

onMounted(() => {
  applyInlineSources();
  if (typeof IntersectionObserver === "undefined") {
    images.value.forEach((_item, index) => void ensureSource(index));
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const index = Number(el.dataset.imageIndex ?? "-1");
        if (index >= 0) void ensureSource(index);
        observer?.unobserve(el);
      }
    },
    { rootMargin: "240px" },
  );
  thumbs.forEach((el) => observer?.observe(el));
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

watch(
  () => props.block.imageItems,
  () => {
    applyInlineSources();
    void nextTick(() => thumbs.forEach((el) => observer?.observe(el)));
  },
  { deep: false },
);

function pendingLabel(item: TranscriptImage): string {
  if (item.bytes && item.bytes > 0) return formatBytes(item.bytes);
  return "图片";
}

// 排队中的消息可以就地编辑：气泡在这里，编辑框在输入框上方，所以通过内核事件传上去。
const kernel = inject(KERNEL_KEY, null);
function editQueued(): void {
  if (!props.queued) return;
  kernel?.bus.emit("queue:edit", {
    prompt: props.block.queueText ?? "",
    message: text.value,
  });
}

// 点击缩略图放大
const previewIndex = ref<number | null>(null);
const previewItems = computed(() => images.value.map((item, index) => ({ src: sources.value[index] ?? "", name: `图片 ${index + 1}` })));
async function openPreview(index: number): Promise<void> {
  await ensureSource(index);
  previewIndex.value = index;
}
</script>

<template>
  <div class="msg user">
    <div class="msg-user-bubble" :class="{ 'only-media': !text && !block.skill, queued }">
      <div v-if="queued" class="msg-user-queued" title="这条消息还在等待发送：点「编辑」改写内容，或在上方撤回">
        <span class="msg-user-queued-dot" />
        <span>待发送</span>
        <button type="button" class="msg-user-queued-edit" @click="editQueued">编辑</button>
      </div>
      <div v-if="block.skill" class="msg-skill">
        <button
          type="button"
          class="msg-skill-head"
          :aria-expanded="skillOpen"
          :title="block.skill.location"
          @click="skillOpen = !skillOpen"
        >
          <span class="msg-skill-icon" v-html="icons.puzzle" />
          <span class="msg-skill-name">{{ block.skill.name }}</span>
          <span class="msg-skill-tag">技能</span>
          <span class="msg-skill-caret" v-html="skillOpen ? icons.chevronDown : icons.chevronRight" />
        </button>
        <div v-if="skillOpen" class="msg-skill-body">
          <MarkdownBody mode="docs" :content="block.skill.content" />
          <div class="msg-skill-loc">{{ block.skill.location }}</div>
        </div>
      </div>
      <!-- 附件（图片 / 文件 / 文件夹）统一放在文字上方：和输入框里的顺序一致，
           粘贴时在上、发出去也在上，不用来回适应 -->
      <!-- 附件（图片 / 文件 / 文件夹）统一放在文字上方：和输入框里的顺序一致，
           粘贴时在上、发出去也在上，不用来回适应 -->
      <div v-if="images.length" class="msg-user-images" :class="{ single: images.length === 1 }">
        <button
          v-for="(item, index) in images"
          :key="index"
          :ref="(el) => observeThumb(el as Element | null, index)"
          type="button"
          class="msg-user-thumb"
          :class="{ pending: !sources[index] }"
          :data-image-index="index"
          :title="sources[index] ? `查看图片 ${index + 1}/${images.length}` : '点一下加载这张图片'"
          @click="openPreview(index)"
        >
          <img v-if="sources[index]" :src="sources[index]" :alt="`图片 ${index + 1}`" loading="lazy" />
          <span v-else class="msg-user-thumb-pending">
            {{ failed[index] ? "加载失败" : loading[index] ? "加载中…" : pendingLabel(item) }}
          </span>
        </button>
      </div>

      <div v-if="files.length" class="msg-user-files">
        <span
          v-for="item in files"
          :key="item.path"
          class="msg-user-file"
          :class="{ session: item.kind === 'session' }"
          :title="item.kind === 'session' ? `引用对话：${item.path}` : item.path"
        >
          <span
            class="msg-user-file-icon"
            v-html="item.kind === 'session' ? icons.chat : item.kind === 'folder' ? icons.folder : icons.attach"
          />
          <span class="msg-user-file-name">{{ item.name }}</span>
          <span v-if="item.kind === 'session' && item.messages" class="msg-user-file-meta">{{ item.messages }} 条</span>
          <span v-else-if="item.size" class="msg-user-file-meta">{{ formatBytes(item.size) }}</span>
        </span>
      </div>

      <div v-if="fallbackCount" class="msg-user-files">
        <span class="msg-user-file">
          <span class="msg-user-file-icon" v-html="icons.image" />
          <span class="msg-user-file-name">{{ fallbackCount }} 张图片</span>
        </span>
      </div>

      <div
        v-if="text"
        class="msg-user-text"
        :class="{ clamped, 'is-expanded': clampable && expanded }"
      ><SearchHighlight :text="text" :query="query" /></div>
      <button v-if="clampable" type="button" class="msg-user-toggle" @click="expanded = !expanded">
        {{ expanded ? "收起" : `展开全文（${text.length} 字）` }}
      </button>

      <div v-if="empty" class="msg-user-text msg-user-empty">（空消息）</div>
    </div>

    <ImageLightbox v-model:index="previewIndex" :items="previewItems" />
  </div>
</template>
