<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";

const { workbench, bus } = useKernel();
const files = computed(() => workbench.state.openFiles ?? []);
const file = computed(() => files.value.find((item) => item.relative === workbench.state.activeFile) ?? null);
const draft = computed({
  get: () => file.value?.draft ?? file.value?.content ?? "",
  set: (value) => {
    if (file.value) {
      file.value.draft = value;
      file.value.dirty = value !== (file.value.savedContent ?? file.value.content ?? "");
    }
  },
});
const lines = computed(() => String(draft.value ?? "").split(/\r?\n/));
const pathParts = computed(() => String(file.value?.relative ?? "").split(/[\\/]/).filter(Boolean));
const codeInput = ref(null);
const lineNumbers = ref(null);
const saving = ref(false);

function tabIcon(item) {
  const ext = String(item?.name ?? "").split(".").at(-1)?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "vue", "svelte", "html", "css", "scss"].includes(ext)) return { icon: icons.code, kind: "code" };
  if (["json", "jsonl"].includes(ext)) return { icon: icons.json, kind: "json" };
  if (["md", "txt", "log", "csv", "yml", "yaml"].includes(ext)) return { icon: icons.text, kind: "text" };
  return { icon: icons.file, kind: "file" };
}

function close(relative = file.value?.relative) {
  if (relative) workbench.closeFile(relative);
}

function activate(relative) {
  workbench.activateFile(relative);
}

function openExternal() {
  if (file.value?.relative) {
    workbench.openWorkspacePath(file.value.relative).catch((error) => notify(error));
  }
}

function notify(error) {
  bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
}

async function save() {
  if (!file.value || file.value.loading || file.value.error || saving.value) return;
  if (!file.value.dirty) return;
  saving.value = true;
  try {
    await workbench.saveWorkspaceFile(file.value.relative, draft.value);
    bus.emit("notify", { level: "info", text: `已保存 ${file.value.name}` });
  } catch (error) {
    notify(error);
  } finally {
    saving.value = false;
  }
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
}

function syncScroll() {
  if (lineNumbers.value && codeInput.value) lineNumbers.value.scrollTop = codeInput.value.scrollTop;
}

watch(() => file.value?.relative, () => nextTick(syncScroll));
onBeforeUnmount(() => { if (codeInput.value) codeInput.value.removeEventListener("scroll", syncScroll); });
</script>

<template>
  <section class="file-editor">
    <header class="file-editor-tabbar">
      <div
        v-for="item in files"
        :key="item.relative"
        class="file-editor-tab"
        :class="{ active: item.relative === file?.relative }"
        :title="item.relative"
        @click="activate(item.relative)"
      >
        <span class="file-editor-tab-icon" :class="tabIcon(item).kind" v-html="tabIcon(item).icon" />
        <span class="file-editor-tab-name">{{ item.name }}</span>
        <span v-if="item.dirty" class="file-editor-dirty" title="有未保存修改">●</span>
        <span v-if="item.loading" class="mini-spinner" />
        <button class="file-editor-tab-close" title="关闭文件" @click.stop="close(item.relative)">×</button>
      </div>
    </header>
    <div class="file-editor-toolbar">
      <div class="file-editor-path" :title="file?.relative">
        <template v-for="(part, idx) in pathParts" :key="idx">
          <span v-if="idx > 0" class="file-editor-sep">/</span>
          <span :class="{ current: idx === pathParts.length - 1 }">{{ part }}</span>
        </template>
      </div>
      <span v-if="file && !file.loading && !file.error" class="file-editor-meta">{{ lines.length }} 行</span>
      <span v-if="file?.dirty" class="file-editor-status">未保存</span>
      <button
        class="btn file-editor-save"
        :class="{ primary: file?.dirty }"
        :disabled="!file?.dirty || saving"
        title="保存修改 (Ctrl+S)"
        @click="save"
      >
        <span v-if="saving" class="mini-spinner" />
        {{ saving ? "保存中" : "保存" }}
      </button>
      <button class="icon-btn small" title="使用系统程序打开" @click="openExternal" v-html="icons.reveal" />
    </div>
    <div v-if="file?.loading" class="file-editor-state"><span class="mini-spinner" />正在打开文件…</div>
    <div v-else-if="file?.error" class="file-editor-state error">{{ file.error }}</div>
    <div v-else class="file-editor-body">
      <div ref="lineNumbers" class="file-editor-numbers" aria-hidden="true"><span v-for="(line, index) in lines" :key="index">{{ index + 1 }}</span></div>
      <textarea
        ref="codeInput"
        v-model="draft"
        class="file-editor-input"
        spellcheck="false"
        aria-label="文件内容"
        @keydown="onKeydown"
        @scroll="syncScroll"
      />
    </div>
  </section>
</template>
