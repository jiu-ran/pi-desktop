<script setup lang="ts">
import { computed, ref } from "vue";
import type { StageTab } from "../../kernel/stage.ts";
import { icons } from "../../shared/util.ts";
import type { EventLogEntry } from "./log.ts";

const props = defineProps<{
  tab: StageTab<EventLogEntry>;
}>();

const entry = computed(() => props.tab.data);
const copied = ref(false);

async function copyJson(): Promise<void> {
  if (!entry.value?.json) return;
  await navigator.clipboard?.writeText(entry.value.json);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1200);
}
</script>

<template>
  <section class="stage-view event-stage">
    <div class="file-editor-toolbar">
      <div class="file-editor-path">
        <span class="current">{{ entry.type }}</span>
        <span class="file-editor-sep">#{{ entry.id }}</span>
        <span v-if="entry.hint" class="badge">{{ entry.hint }}</span>
      </div>
      <span class="file-editor-meta">{{ entry.time }}</span>
      <button type="button" class="btn small" @click="copyJson">
        <span v-html="copied ? icons.check : icons.copy" />
        {{ copied ? "已复制" : "复制 JSON" }}
      </button>
    </div>

    <div class="stage-scroll">
      <pre class="log-json stage-json">{{ entry.json }}</pre>
    </div>
  </section>
</template>
