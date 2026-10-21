<script setup lang="ts">
import { computed, ref } from "vue";
import { imageDataUrl } from "../../../shared/attachments.ts";
import ImageLightbox from "../ImageLightbox.vue";

const props = defineProps<{
  items: Array<{ mimeType?: string; data: string }>;
}>();

const images = computed(() =>
  props.items.map((item, index) => ({
    src: imageDataUrl(item.mimeType, item.data),
    name: `工具结果图片 ${index + 1}`,
  })),
);

const previewIndex = ref<number | null>(null);
</script>

<template>
  <div v-if="images.length" class="tool-images" :class="{ single: images.length === 1 }">
    <button
      v-for="(item, index) in images"
      :key="index"
      type="button"
      class="tool-image-thumb"
      :title="`查看图片 ${index + 1}/${images.length}`"
      @click="previewIndex = index"
    >
      <img :src="item.src" :alt="item.name" loading="lazy" />
    </button>
    <ImageLightbox v-model:index="previewIndex" :items="images" />
  </div>
</template>
