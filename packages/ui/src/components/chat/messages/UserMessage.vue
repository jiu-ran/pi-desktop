<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { TranscriptBlock } from "../../../kernel/transcript.ts";
import { icons } from "../../../shared/util.ts";
import SearchHighlight from "../SearchHighlight.vue";

const props = defineProps<{
  block: TranscriptBlock;
  query?: string;
}>();

const text = computed(() => (props.block.text ?? "").trim());
const files = computed(() => props.block.attachments ?? []);
const images = computed(() => (props.block.imageItems ?? []).map((item, index) => ({
  key: `${index}`,
  src: item.data.startsWith("data:") ? item.data : `data:${item.mimeType};base64,${item.data}`,
})));
const fallbackCount = computed(() => (props.block.imageItems?.length ? 0 : props.block.images ?? 0));
const empty = computed(() => !text.value && !files.value.length && !images.value.length && !fallbackCount.value);

// 点击缩略图放大
const preview = ref<{ src: string; index: number } | null>(null);
function openPreview(index: number): void {
  const item = images.value[index];
  if (item) preview.value = { src: item.src, index };
}
function closePreview(): void {
  preview.value = null;
}
function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !preview.value) return;
  event.preventDefault();
  closePreview();
}
watch(preview, (value) => {
  if (typeof window === "undefined") return;
  if (value) window.addEventListener("keydown", onKey, true);
  else window.removeEventListener("keydown", onKey, true);
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div class="msg user">
    <div class="msg-user-bubble" :class="{ 'only-media': !text }">
      <div v-if="text" class="msg-user-text"><SearchHighlight :text="text" :query="query" /></div>

      <div v-if="images.length" class="msg-user-images" :class="{ single: images.length === 1 }">
        <button
          v-for="(item, index) in images"
          :key="item.key"
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

    <Teleport to="body">
      <div v-if="preview" class="msg-image-preview" @click.self="closePreview">
        <img :src="preview.src" alt="图片预览" />
        <div class="msg-image-preview-actions">
          <span>{{ (preview?.index ?? 0) + 1 }} / {{ images.length }}</span>
          <button type="button" @click="closePreview">关闭</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
