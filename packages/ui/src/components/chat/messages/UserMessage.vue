<script setup lang="ts">
import { computed, ref } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { formatBytes, imageDataUrl } from "../../../shared/attachments.ts";
import { icons } from "../../../shared/util.ts";
import ImageLightbox from "../ImageLightbox.vue";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const text = computed(() => (props.block.text ?? "").trim());
const files = computed(() => props.block.attachments ?? []);
const images = computed(() =>
  (props.block.imageItems ?? []).map((item) => ({ src: imageDataUrl(item.mimeType, item.data) })),
);
const fallbackCount = computed(() => (props.block.imageItems?.length ? 0 : props.block.images ?? 0));
const empty = computed(() => !text.value && !files.value.length && !images.value.length && !fallbackCount.value);

// 点击缩略图放大
const previewIndex = ref<number | null>(null);
function openPreview(index: number): void {
  previewIndex.value = index;
}
</script>

<template>
  <div class="msg user">
    <div class="msg-user-bubble" :class="{ 'only-media': !text }">
      <div v-if="text" class="msg-user-text"><SearchHighlight :text="text" :query="query" /></div>

      <div v-if="images.length" class="msg-user-images" :class="{ single: images.length === 1 }">
        <button
          v-for="(item, index) in images"
          :key="index"
          type="button"
          class="msg-user-thumb"
          :title="`查看图片 ${index + 1}/${images.length}`"
          @click="openPreview(index)"
        >
          <img :src="item.src" :alt="`图片 ${index + 1}`" loading="lazy" />
        </button>
      </div>

      <div v-if="files.length" class="msg-user-files">
        <span
          v-for="item in files"
          :key="item.path"
          class="msg-user-file"
          :title="item.path"
        >
          <span class="msg-user-file-icon" v-html="item.kind === 'folder' ? icons.folder : icons.attach" />
          <span class="msg-user-file-name">{{ item.name }}</span>
          <span v-if="item.size" class="msg-user-file-meta">{{ formatBytes(item.size) }}</span>
        </span>
      </div>

      <div v-if="fallbackCount" class="msg-user-files">
        <span class="msg-user-file">
          <span class="msg-user-file-icon" v-html="icons.image" />
          <span class="msg-user-file-name">{{ fallbackCount }} 张图片</span>
        </span>
      </div>

      <div v-if="empty" class="msg-user-text msg-user-empty">（空消息）</div>
    </div>

    <ImageLightbox v-model:index="previewIndex" :items="images" />
  </div>
</template>
