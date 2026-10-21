<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { appSettings, openSettingsModal } from "../../services/settings.ts";
import MarkdownPreview from "../markdown/MarkdownPreview.vue";
import { isMarkdownFile } from "../markdown/markdown.ts";
import { icons } from "../../shared/util.ts";
import { formatBytes } from "../../shared/attachments.ts";
import ImageLightbox from "../../components/chat/ImageLightbox.vue";
import type { StageTab } from "../../kernel/stage.ts";
import type { FileStageData } from "./state.ts";

const props = defineProps<{
  tab: StageTab<FileStageData>;
}>();

const { workbench, bus, plugins } = useKernel();

const file = computed(() => props.tab.data);
const markdownEnabled = computed(() => Boolean(plugins.get("markdown")?.enabled));
const isMarkdown = computed(() => isMarkdownFile(file.value?.name));
const preview = ref(false);
const showPreview = computed(() => preview.value && isMarkdown.value && markdownEnabled.value);

watch(
  () => file.value?.relative,
  (relative, previous) => {
    if (relative !== previous) {
      preview.value = isMarkdownFile(file.value?.name) && markdownEnabled.value;
    }
  },
);

watch(
  () => file.value?.loading,
  (loading) => {
    if (loading === false && isMarkdownFile(file.value?.name) && markdownEnabled.value) {
      preview.value = true;
    }
  },
  { immediate: true },
);
const saving = ref(false);
const lastAutoSaved = ref(false);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let fileGeneration = 0;

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function scheduleAutoSave(): void {
  clearAutoSaveTimer();
  if (appSettings.autoSave !== "afterDelay" || !props.tab.dirty) return;
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void save({ auto: true });
  }, appSettings.autoSaveDelay);
}

const draft = computed({
  get: () => file.value?.draft ?? file.value?.content ?? "",
  set: (value: string) => {
    if (!file.value || file.value.binary) return;
    file.value.draft = value;
    const dirty = value !== (file.value.savedContent ?? file.value.content ?? "");
    props.tab.dirty = dirty;
    if (dirty) {
      lastAutoSaved.value = false;
      scheduleAutoSave();
    } else {
      clearAutoSaveTimer();
    }
  },
});

const autoSaveLabel = computed(() => {
  switch (appSettings.autoSave) {
    case "afterDelay":
      return `自动保存: ${appSettings.autoSaveDelay >= 1000 ? `${appSettings.autoSaveDelay / 1000}s` : `${appSettings.autoSaveDelay}ms`}`;
    case "onFocusChange":
      return "自动保存: 失焦";
    case "onWindowChange":
      return "自动保存: 切窗口";
    default:
      return "自动保存: 关";
  }
});

const lines = computed(() => String(draft.value ?? "").split(/\r?\n/));
const media = computed(() => file.value?.preview ?? null);
const isBinary = computed(() => Boolean(file.value?.binary));
const zoomIndex = ref<number | null>(null);
const previewItems = computed(() =>
  media.value ? [{ src: media.value.dataUrl, name: file.value?.name ?? "" }] : [],
);
const pathParts = computed(() => String(file.value?.relative ?? "").split(/[\\/]/).filter(Boolean));
const codeInput = ref<HTMLTextAreaElement | null>(null);
const lineNumbers = ref<HTMLElement | null>(null);

function notify(error: any): void {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

function openExternal(): void {
  if (file.value?.relative) {
    workbench.openWorkspacePath(file.value.relative).catch((error) => notify(error));
  }
}

async function attachToChat(): Promise<void> {
  if (!file.value?.path) return;
  try {
    await workbench.addFiles([file.value.path]);
    bus.emit("notify", { level: "info", text: `已添加附件 ${file.value.name}` });
  } catch (error) {
    notify(error);
  }
}

async function reload(): Promise<void> {
  if (!file.value?.relative) return;
  const generation = ++fileGeneration;
  clearAutoSaveTimer();
  file.value.loading = true;
  file.value.error = "";
  try {
    const detail = await workbench.readFile(file.value.relative);
    if (generation !== fileGeneration || file.value?.relative !== detail.relative) return;
    file.value.content = detail.content;
    file.value.savedContent = detail.content;
    file.value.draft = detail.content;
    file.value.size = detail.size;
    file.value.preview = detail.preview;
    file.value.binary = detail.binary;
    props.tab.dirty = false;
    lastAutoSaved.value = false;
  } catch (error: any) {
    if (generation === fileGeneration) file.value.error = error?.message ?? String(error);
  } finally {
    if (generation === fileGeneration) file.value.loading = false;
  }
}

async function save(options?: { auto?: boolean; generation?: number }): Promise<void> {
  clearAutoSaveTimer();
  const targetFile = file.value;
  if (!targetFile || targetFile.binary || targetFile.loading || targetFile.error || saving.value) return;
  if (!props.tab.dirty) return;
  const contentToSave = targetFile.draft ?? targetFile.content ?? "";
  const targetRelative = targetFile.relative;
  const generation = options?.generation ?? fileGeneration;
  saving.value = true;
  try {
    const saved = await workbench.writeFile(targetRelative, contentToSave);
    if (generation !== fileGeneration || file.value !== targetFile || targetFile.relative !== targetRelative) return;
    targetFile.content = saved.content;
    targetFile.savedContent = saved.content;
    targetFile.size = saved.size;
    if (targetFile.draft === contentToSave) {
      targetFile.draft = saved.content;
      props.tab.dirty = false;
    } else {
      props.tab.dirty = targetFile.draft !== saved.content;
      if (props.tab.dirty && appSettings.autoSave === "afterDelay") {
        scheduleAutoSave();
      }
    }
    if (options?.auto) {
      lastAutoSaved.value = true;
    } else {
      lastAutoSaved.value = false;
      bus.emit("notify", { level: "info", text: `已保存 ${targetFile.name}` });
    }
  } catch (error) {
    notify(error);
  } finally {
    saving.value = false;
  }
}

function onEditorBlur(): void {
  if (appSettings.autoSave === "onFocusChange" && props.tab.dirty) {
    void save({ auto: true });
  }
}

function onWindowBlur(): void {
  if (appSettings.autoSave === "onWindowChange" && props.tab.dirty) {
    void save({ auto: true });
  }
}

function onVisibilityChange(): void {
  if (document.hidden && appSettings.autoSave === "onWindowChange" && props.tab.dirty) {
    void save({ auto: true });
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save({ auto: false });
    return;
  }
  if (event.key === "Tab") {
    const el = codeInput.value;
    if (!el) return;
    event.preventDefault();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const current = draft.value;
    draft.value = `${current.slice(0, start)}  ${current.slice(end)}`;
    nextTick(() => {
      el.selectionStart = el.selectionEnd = start + 2;
    });
  }
}

function syncScroll(): void {
  if (lineNumbers.value && codeInput.value) {
    lineNumbers.value.scrollTop = codeInput.value.scrollTop;
  }
}

watch(
  () => [appSettings.autoSave, appSettings.autoSaveDelay],
  () => {
    if (appSettings.autoSave === "afterDelay" && props.tab.dirty) {
      scheduleAutoSave();
    } else {
      clearAutoSaveTimer();
    }
  },
);

watch(
  () => file.value?.relative,
  () => {
    clearAutoSaveTimer();
    lastAutoSaved.value = false;
    nextTick(syncScroll);
  },
);

onMounted(() => {
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  clearAutoSaveTimer();
  const unmountGeneration = fileGeneration;
  fileGeneration += 1;
  if (props.tab.dirty && appSettings.autoSave !== "off") {
    // The captured generation prevents a late save from mutating a replacement path.
    void save({ auto: true, generation: unmountGeneration });
  }
});
</script>

<template>
  <section class="file-editor">
    <div class="file-editor-toolbar">
      <div class="file-editor-path" :title="file?.relative">
        <template v-for="(part, idx) in pathParts" :key="idx">
          <span v-if="idx > 0" class="file-editor-sep">/</span>
          <span :class="{ current: idx === pathParts.length - 1 }">{{ part }}</span>
        </template>
      </div>
      <span v-if="file && !file.loading && !file.error && !isBinary" class="file-editor-meta">{{ lines.length }} 行</span>
      <span v-if="tab.dirty" class="file-editor-status">
        {{ appSettings.autoSave === "afterDelay" ? "待自动保存" : "未保存" }}
      </span>
      <span v-else-if="lastAutoSaved" class="file-editor-status saved">已自动保存</span>
      <button
        v-if="!isBinary"
        type="button"
        class="file-autosave-pill"
        :class="{ active: appSettings.autoSave !== 'off' }"
        title="点击配置修改文件自动保存策略"
        @click="openSettingsModal('conversation')"
      >
        {{ autoSaveLabel }}
      </button>
      <div v-if="isMarkdown && markdownEnabled" class="settings-segmented file-view-toggle">
        <button type="button" :class="{ active: !showPreview }" @click="preview = false">源码</button>
        <button type="button" :class="{ active: showPreview }" @click="preview = true">预览</button>
      </div>
      <button type="button" class="btn small" title="作为附件添加到对话" @click="attachToChat">
        @ 引用
      </button>
      <button
        v-if="!isBinary"
        type="button"
        class="btn small file-editor-save"
        :class="{ primary: tab.dirty }"
        :disabled="!tab.dirty || saving"
        title="保存修改 (Ctrl+S)"
        @click="save({ auto: false })"
      >
        <span v-if="saving" class="mini-spinner" />
        {{ saving ? "保存中" : "保存" }}
      </button>
      <button type="button" class="icon-btn small" title="重新读取文件" @click="reload" v-html="icons.refresh" />
      <button type="button" class="icon-btn small" title="使用系统程序打开" @click="openExternal" v-html="icons.reveal" />
    </div>

    <div v-if="file?.loading" class="file-editor-state"><span class="mini-spinner" />正在打开文件…</div>
    <div v-else-if="file?.error" class="file-editor-state error">{{ file.error }}</div>
    <div v-else-if="isBinary" class="file-editor-binary">
      <template v-if="media">
        <button
          type="button"
          class="file-image-preview"
          :title="`点击查看 ${file?.name} 大图`"
          @click="zoomIndex = 0"
        >
          <img :src="media.dataUrl" :alt="file?.name" />
        </button>
        <p class="file-editor-binary-meta">
          {{ media.mimeType }} · {{ formatBytes(file?.size ?? 0) }} · 点击图片查看大图
        </p>
        <ImageLightbox v-model:index="zoomIndex" :items="previewItems" />
      </template>
      <div v-else class="file-editor-state">
        该文件是二进制文件（{{ formatBytes(file?.size ?? 0) }}），无法以文本方式预览，可使用系统程序打开。
      </div>
    </div>
    <MarkdownPreview v-else-if="showPreview && file" :file="file" />
    <div v-else class="file-editor-body">
      <div ref="lineNumbers" class="file-editor-numbers" aria-hidden="true">
        <span v-for="(_, index) in lines" :key="index">{{ index + 1 }}</span>
      </div>
      <textarea
        ref="codeInput"
        v-model="draft"
        class="file-editor-input"
        spellcheck="false"
        aria-label="文件内容"
        @blur="onEditorBlur"
        @keydown="onKeydown"
        @scroll="syncScroll"
      />
    </div>
  </section>
</template>
