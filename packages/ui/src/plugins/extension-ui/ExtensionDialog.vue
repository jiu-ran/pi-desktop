<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { closeDialog, extState } from "./state.ts";

/**
 * 扩展对话框：一次显示队首的请求，用同一个 id 回写 extension_ui_response。
 */
const { bus } = useKernel();
const dialog = computed(() => extState.dialogs[0] ?? null);
const value = ref("");
const selected = ref(0);
const field = ref(null);
const shell = ref(null);
const now = ref(Date.now());
let timer = null;

watch(dialog, async (next) => {
  clearInterval(timer);
  if (!next) return;
  value.value = next.method === "editor" ? next.prefill ?? "" : "";
  selected.value = 0;
  now.value = Date.now();
  if (next.timeout) timer = setInterval(() => { now.value = Date.now(); }, 250);
  await nextTick();
  (field.value ?? shell.value)?.focus();
}, { immediate: true });

const remaining = computed(() => {
  const d = dialog.value;
  if (!d?.timeout) return null;
  return Math.max(0, Math.ceil((d.receivedAt + d.timeout - now.value) / 1000));
});

// Pi 端超时后会自动处理，本地只需关闭弹窗，不再回写
watch(remaining, (left) => {
  if (left === 0 && dialog.value) closeDialog(dialog.value.id);
});

function respond(payload) {
  const d = dialog.value;
  if (!d) return;
  bus.emit("extension-ui:respond", { cwd: d.cwd, response: { id: d.id, ...payload } });
  closeDialog(d.id);
}

function submit() {
  const d = dialog.value;
  if (!d) return;
  if (d.method === "select") respond({ value: d.options[selected.value] });
  else if (d.method === "confirm") respond({ confirmed: true });
  else respond({ value: value.value });
}

function onKey(event) {
  const d = dialog.value;
  if (!d) return;
  if (event.key === "Escape") { respond({ cancelled: true }); return; }
  if (d.method === "select") {
    if (event.key === "ArrowDown") { selected.value = (selected.value + 1) % d.options.length; event.preventDefault(); }
    if (event.key === "ArrowUp") { selected.value = (selected.value - 1 + d.options.length) % d.options.length; event.preventDefault(); }
  }
  const editorSubmit = d.method === "editor" && event.key === "Enter" && (event.ctrlKey || event.metaKey);
  if ((event.key === "Enter" && d.method !== "editor") || editorSubmit) { event.preventDefault(); submit(); }
}
</script>

<template>
  <div v-if="dialog" class="modal-backdrop" @keydown="onKey">
    <div ref="shell" class="modal" tabindex="-1" role="dialog" aria-modal="true">
      <header class="modal-head">
        <span class="modal-tag">扩展请求</span>
        <span v-if="remaining != null" class="modal-timer">{{ remaining }}s 后自动处理</span>
        <span v-if="extState.dialogs.length > 1" class="modal-timer">还有 {{ extState.dialogs.length - 1 }} 个</span>
      </header>
      <h3 class="modal-title">{{ dialog.title }}</h3>
      <p v-if="dialog.message" class="modal-message">{{ dialog.message }}</p>

      <div v-if="dialog.method === 'select'" class="modal-options">
        <button
          v-for="(option, i) in dialog.options"
          :key="option"
          class="modal-option"
          :class="{ active: i === selected }"
          @click="selected = i; submit()"
          @mouseenter="selected = i"
        >
          {{ option }}
        </button>
      </div>

      <input
        v-else-if="dialog.method === 'input'"
        ref="field"
        v-model="value"
        class="modal-input"
        :placeholder="dialog.placeholder"
      />

      <textarea v-else-if="dialog.method === 'editor'" ref="field" v-model="value" class="modal-editor" rows="10" />

      <footer class="modal-actions">
        <span v-if="dialog.method === 'editor'" class="composer-hint">Ctrl+Enter 提交</span>
        <button class="btn" @click="dialog.method === 'confirm' ? respond({ confirmed: false }) : respond({ cancelled: true })">
          {{ dialog.method === "confirm" ? "否" : "取消" }}
        </button>
        <button class="btn primary" @click="submit">{{ dialog.method === "confirm" ? "是" : "确定" }}</button>
      </footer>
    </div>
  </div>
</template>
