<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { cloneDialogState, closeCloneDialog } from "../../services/clone-dialog.ts";
import { cloneTargetPath } from "../../shared/repo-url.ts";
import { icons } from "../../shared/util.ts";

const { workbench } = useKernel();
const url = ref("");
const location = ref("");
const busy = ref(false);
const error = ref("");
const urlInput = ref<HTMLInputElement | null>(null);

const target = computed(() => cloneTargetPath(location.value, url.value));
const canSubmit = computed(() => Boolean(url.value.trim() && target.value) && !busy.value);

/** 默认位置取当前项目的上一级：多数人会把新仓库放在已有项目的旁边 */
function defaultLocation(): string {
  const cwd = workbench.active.value?.cwd ?? "";
  if (!cwd) return "";
  const index = Math.max(cwd.lastIndexOf("/"), cwd.lastIndexOf("\\"));
  return index > 0 ? cwd.slice(0, index) : "";
}

watch(
  () => cloneDialogState.open,
  async (open) => {
    if (!open) return;
    url.value = "";
    location.value = defaultLocation();
    error.value = "";
    busy.value = false;
    await nextTick();
    urlInput.value?.focus();
  },
  // 打开动作来自菜单的点击处理，等 DOM 更新完成后再抢焦点
  { flush: "post" },
);

function close(): void {
  // 克隆进行中不允许关闭：中途关掉会留下「克隆了一半」的目录，用户还以为是空的
  if (busy.value) return;
  closeCloneDialog();
}

async function browse(): Promise<void> {
  if (busy.value) return;
  try {
    const picked = await workbench.chooseDirectory();
    if (picked) location.value = picked;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = "";
  try {
    await workbench.cloneRepository(url.value.trim(), target.value);
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    busy.value = false;
    return;
  }
  busy.value = false;
  closeCloneDialog();
}

function onKey(event: KeyboardEvent): void {
  if (!cloneDialogState.open || event.key !== "Escape") return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="cloneDialogState.open" class="modal-backdrop" @mousedown.self="close">
    <form class="modal clone-dialog" role="dialog" aria-label="从 Git 克隆" @submit.prevent="submit">
      <h3 class="modal-title">从 Git 克隆</h3>
      <div class="clone-field">
        <label class="clone-label" for="clone-url">仓库地址</label>
        <input
          id="clone-url"
          ref="urlInput"
          v-model="url"
          class="clone-input"
          placeholder="https://github.com/user/repo.git"
          spellcheck="false"
          autocomplete="off"
          :disabled="busy"
        />
      </div>
      <div class="clone-field">
        <label class="clone-label" for="clone-location">位置</label>
        <span class="clone-location">
          <input
            id="clone-location"
            v-model="location"
            class="clone-input"
            placeholder="选择要克隆到的文件夹"
            spellcheck="false"
            readonly
            :disabled="busy"
          />
          <button
            type="button"
            class="icon-btn clone-browse"
            title="选择文件夹"
            aria-label="选择文件夹"
            :disabled="busy"
            @click="browse"
            v-html="icons.folder"
          />
        </span>
      </div>
      <p class="clone-target">
        <template v-if="target">将克隆到 <code>{{ target }}</code></template>
        <template v-else>先填仓库地址，再选一个存放位置</template>
      </p>
      <p v-if="error" class="clone-error">{{ error }}</p>
      <div class="modal-actions">
        <button type="button" class="btn" :disabled="busy" @click="close">取消</button>
        <button type="submit" class="btn primary" :disabled="!canSubmit">
          <span v-if="busy" class="mini-spinner" />{{ busy ? "正在克隆…" : "克隆" }}
        </button>
      </div>
    </form>
  </div>
</template>
