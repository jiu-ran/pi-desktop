<script setup>
import { computed, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.js";
import { icons } from "../../shared/util.js";

const props = defineProps({ relative: { type: String, required: true } });
const emit = defineEmits(["close"]);
const { workbench, bus } = useKernel();
const file = ref(null);
const loading = ref(false);
const error = ref("");
let request = 0;

const lines = computed(() => file.value?.content?.split(/\r?\n/) ?? []);

async function load() {
  const current = ++request;
  loading.value = true;
  error.value = "";
  file.value = null;
  try {
    const result = await workbench.readWorkspaceFile(props.relative);
    if (current === request) file.value = result;
  } catch (reason) {
    if (current === request) error.value = reason?.message ?? String(reason);
  } finally {
    if (current === request) loading.value = false;
  }
}

watch(() => props.relative, load, { immediate: true });

function openExternal() {
  workbench.openWorkspacePath(props.relative).catch((reason) => bus.emit("notify", { level: "error", text: reason?.message ?? String(reason) }));
}
</script>

<template>
  <section class="file-preview">
    <header class="file-preview-head">
      <div class="file-preview-title" :title="relative">
        <span class="file-preview-icon" v-html="icons.file" />
        <span>{{ file?.name ?? relative.split(/[\\/]/).at(-1) }}</span>
      </div>
      <div class="file-preview-actions">
        <button class="icon-btn small" title="使用系统程序打开" @click="openExternal" v-html="icons.reveal" />
        <button class="icon-btn small" title="关闭预览" @click="emit('close')" v-html="icons.close" />
      </div>
    </header>
    <div class="file-preview-path" :title="relative">{{ relative }}</div>
    <div v-if="loading" class="file-preview-state"><span class="mini-spinner" />正在打开文件…</div>
    <div v-else-if="error" class="file-preview-state error">
      <span>{{ error }}</span>
      <button class="btn" @click="load">重试</button>
    </div>
    <pre v-else class="file-preview-code"><code><span v-for="(line, index) in lines" :key="index" class="file-preview-line"><span class="file-preview-number">{{ index + 1 }}</span><span>{{ line || " " }}</span></span></code></pre>
  </section>
</template>
