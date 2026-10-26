<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { appSettings, openSettingsModal } from "../../services/settings.ts";
import MarkdownLive from "../markdown/MarkdownLive.vue";
import MarkdownHighlightEditor from "../markdown/MarkdownHighlightEditor.vue";
import { isMarkdownFile } from "../markdown/markdown.ts";
import { icons } from "../../shared/util.ts";
import { formatBytes } from "../../shared/attachments.ts";
import { localizeNotification } from "../../shared/notify-text.ts";
import ImageLightbox from "../../components/chat/ImageLightbox.vue";
import { askConfirm } from "../../components/sidebar/ui";
import type { StageTab } from "../../kernel/stage.ts";
import type { FileStageData } from "./state.ts";
import { saveFileTab } from "./save.ts";

const props = defineProps<{
  tab: StageTab<FileStageData>;
}>();

const { workbench, bus, plugins, stage } = useKernel();

const file = computed(() => props.tab.data);
const markdownEnabled = computed(() => Boolean(plugins.get("markdown")?.enabled));
const isMarkdown = computed(() => isMarkdownFile(file.value?.name));
/**
 * .md 的默认视图：预览（Typora / Obsidian 式实时预览，看到的就是排版结果）/ 源码。
 */
const markdownView = computed<"source" | "preview">({
  get: () => appSettings.markdownView,
  set: (value) => {
    appSettings.markdownView = value;
  },
});
const showPreview = computed(() => markdownView.value === "preview" && isMarkdown.value && markdownEnabled.value);

/** 预览模式里编辑 → 写回草稿（自动保存照常生效） */
function applyLiveContent(next: string): void {
  draft.value = next;
}

const saving = computed(() => Boolean(file.value?.saving));
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
const LARGE_TEXT_MAX = 2 * 1024 * 1024;
const LARGE_CHUNK_CHARS = 64 * 1024;
const isLargeText = computed(() => Boolean(file.value) && !file.value?.binary && (file.value?.size ?? 0) > LARGE_TEXT_MAX);
const largeChunks = computed(() => {
  const text = file.value?.content ?? "";
  const chunks: string[] = [];
  let start = 0;
  // 大文件按块渲染，配合 content-visibility 只排版视口附近的块；
  // 否则一个 2 MB 的 <pre> 会让主线程布局数秒。
  while (start < text.length && chunks.length < 400) {
    let end = Math.min(text.length, start + LARGE_CHUNK_CHARS);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline >= start) end = newline + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
});
const zoomIndex = ref<number | null>(null);
const previewItems = computed(() =>
  media.value ? [{ src: media.value.dataUrl, name: file.value?.name ?? "" }] : [],
);
const pathParts = computed(() => String(file.value?.relative ?? "").split(/[\\/]/).filter(Boolean));
const codeInput = ref<HTMLTextAreaElement | null>(null);
const markdownInput = ref<{ input: HTMLTextAreaElement | null } | null>(null);
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
  if (saving.value) return;
  if (props.tab.dirty) {
    const ok = await askConfirm({
      title: "重新读取会丢弃当前草稿",
      message: `确定放弃「${file.value.name}」中未保存的修改吗？`,
      confirmLabel: "放弃草稿并重新读取",
      danger: true,
    });
    if (!ok) return;
  }
  const generation = ++fileGeneration;
  clearAutoSaveTimer();
  file.value.loading = true;
  file.value.error = "";
  try {
    const detail = await workbench.readFile(file.value.relative);
    if (generation !== fileGeneration || file.value?.relative !== detail.relative) return;
    file.value.content = detail.content;
    file.value.savedContent = detail.content;
    file.value.revision = detail.revision;
    file.value.saveError = "";
    file.value.draft = detail.content;
    file.value.size = detail.size;
    file.value.preview = detail.preview;
    file.value.binary = detail.binary;
    props.tab.dirty = false;
    lastAutoSaved.value = false;
  } catch (error: any) {
    if (generation === fileGeneration) file.value.error = localizeNotification(error, "error");
  } finally {
    if (generation === fileGeneration) file.value.loading = false;
  }
}

async function save(options?: { auto?: boolean }): Promise<void> {
  clearAutoSaveTimer();
  const target = props.tab;
  if (!target.dirty || isLargeText.value) return;
  try {
    await saveFileTab(workbench, target);
    lastAutoSaved.value = Boolean(options?.auto);
    if (!options?.auto) bus.emit("notify", { level: "info", text: `已保存 ${target.title}` });
    if (target.dirty && appSettings.autoSave === "afterDelay") scheduleAutoSave();
  } catch (error) {
    // 手动保存失败时编辑器顶部的常驻提示已经说明原因与可选项，不再弹重复 Toast。
    if (options?.auto) notify(error);
  }
}

/** 冲突后由用户明确选择用当前草稿覆盖磁盘内容。 */
async function forceSave(): Promise<void> {
  if (!file.value || saving.value) return;
  const ok = await askConfirm({
    title: "用草稿覆盖外部修改？",
    message: `「${file.value.name}」已被外部程序或 Agent 修改，覆盖会丢失这些修改。`,
    confirmLabel: "用草稿覆盖",
    danger: true,
  });
  if (!ok) return;
  try {
    await saveFileTab(workbench, props.tab, { force: true });
    lastAutoSaved.value = false;
    bus.emit("notify", { level: "info", text: `已覆盖保存 ${props.tab.title}` });
  } catch (error) { notify(error); }
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
    const el = markdownInput.value?.input || codeInput.value;
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


onMounted(() => {
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  clearAutoSaveTimer();
  fileGeneration += 1;
  if (stage.allTabs.value.includes(props.tab) && props.tab.dirty && appSettings.autoSave !== "off") {
    // 保存服务持有原 tab/cwd；即使切换了项目，也不会把同名文件写到新项目。
    void saveFileTab(workbench, props.tab).catch(notify);
  }});
</script>

<template>
  <section class="file-editor" :data-md-view="markdownView">
    <div class="file-editor-toolbar">
      <div class="file-editor-path" :title="file?.relative">
        <template v-for="(part, idx) in pathParts" :key="idx">
          <span v-if="idx > 0" class="file-editor-sep">/</span>
          <span :class="{ current: idx === pathParts.length - 1 }">{{ part }}</span>
        </template>
      </div>
      <span v-if="file && !file.loading && !file.error && !isBinary && !isLargeText" class="file-editor-meta">{{ lines.length }} 行</span>
      <span v-if="tab.dirty" class="file-editor-status">
        {{ appSettings.autoSave === "afterDelay" ? "待自动保存" : "未保存" }}
      </span>
      <span v-else-if="lastAutoSaved" class="file-editor-status saved">已自动保存</span>
      <button
        v-if="!isBinary && !isLargeText"
        type="button"
        class="file-autosave-pill"
        :class="{ active: appSettings.autoSave !== 'off' }"
        title="点击配置修改文件自动保存策略"
        @click="openSettingsModal('conversation')"
      >
        {{ autoSaveLabel }}
      </button>
      <div
        v-if="isMarkdown && markdownEnabled && !isLargeText"
        class="settings-segments file-view-toggle"
        role="tablist"
        aria-label="Markdown 视图"
      >
        <button
          type="button"
          class="settings-segment"
          role="tab"
          :class="{ active: markdownView === 'source' }"
          :aria-selected="markdownView === 'source'"
          @click="markdownView = 'source'"
        >源码</button>
        <button
          type="button"
          class="settings-segment"
          role="tab"
          :class="{ active: markdownView === 'preview' }"
          :aria-selected="markdownView === 'preview'"
          @click="markdownView = 'preview'"
        >预览</button>
      </div>
      <button type="button" class="btn small" title="作为附件添加到对话" @click="attachToChat">
        @ 引用
      </button>
      <button
        v-if="!isBinary && !isLargeText"
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

    <div v-if="file?.saveError" class="file-editor-state error conflict">
      <span>{{ localizeNotification(file.saveError, "error") }}（草稿仍保留）</span>
      <button type="button" class="btn small" :disabled="saving" @click="reload">重新读取</button>
      <button type="button" class="btn small danger-solid" :disabled="saving" @click="forceSave">覆盖保存</button>
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
    <div v-else-if="isLargeText" class="file-editor-large">
      <div class="file-editor-large-note">
        <strong>只读预览</strong>
        <span>文件超过 2 MB，已切换为只读预览；可用系统程序打开后编辑。</span>
        <button type="button" class="btn small" @click="openExternal">用系统程序打开</button>
      </div>
      <div class="file-editor-large-scroll">
        <pre v-for="(chunk, index) in largeChunks" :key="index" class="file-editor-large-chunk">{{ chunk }}</pre>
      </div>
    </div>
    <!-- 预览：Typora / Obsidian 式实时预览，标记只在光标所在行露出 -->
    <MarkdownLive
      v-else-if="showPreview && file"
      :content="draft"
      :cwd="file?.cwd"
      :relative="file?.relative"
      @update:content="applyLiveContent"
      @keydown="onKeydown"
    />
    <MarkdownHighlightEditor
      v-else-if="isMarkdown && markdownEnabled"
      ref="markdownInput"
      v-model="draft"
      style="flex: 1"
      @blur="onEditorBlur"
      @keydown="onKeydown"
    />
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
