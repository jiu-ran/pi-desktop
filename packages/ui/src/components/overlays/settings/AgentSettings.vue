<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useKernel } from "../../../kernel/use-kernel.ts";
import SettingGroup from "./SettingGroup.vue";

/**
 * 全局提示词：~/.pi/agent/AGENTS.md 的可视化编辑。
 *
 * 打开时拉一次，切项目后重拉（不同项目可能挂不同的 AGENTS.md），保存会提示结果。
 */
const { bus, workbench } = useKernel();
const state = workbench.state;

const path = ref("");
const content = ref("");
const saved = ref("");
const loading = ref(false);
const saving = ref(false);
const dirty = computed(() => content.value !== saved.value);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await window.piDesktop!.globalAgents();
    path.value = result.path;
    content.value = result.content;
    saved.value = result.content;
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const result = await window.piDesktop!.saveGlobalAgents(content.value);
    saved.value = result.content;
    bus.emit("notify", { level: "info", text: "全局提示词已保存" });
  } catch (error: any) {
    bus.emit("notify", { level: "error", text: error?.message ?? String(error) });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => state.activeCwd, load);
</script>

<template>
  <SettingGroup title="全局提示词">
    <template #head>
      <div class="settings-toolbar-actions">
        <button type="button" class="btn ghost small" :disabled="loading" @click="load">刷新</button>
        <button type="button" class="btn small" :disabled="!dirty || saving" @click="save">保存</button>
      </div>
    </template>
    <p class="settings-note">{{ path || "C:\\Users\\<用户>\\.pi\\agent\\AGENTS.md" }}</p>
    <textarea v-model="content" class="agents-editor" spellcheck="false" :disabled="loading" />
  </SettingGroup>
</template>
