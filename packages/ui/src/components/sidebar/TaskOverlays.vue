<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeMenu, settleConfirm, settlePrompt, sidebarUi, type MenuItem } from "./ui.ts";

const menuEl = ref<HTMLElement | null>(null);
const confirmBtn = ref<HTMLButtonElement | null>(null);
const promptInput = ref<HTMLInputElement | null>(null);
const pos = ref({ left: 0, top: 0 });

watch(
  () => sidebarUi.menu,
  async (menu) => {
    if (!menu) return;
    pos.value = { left: menu.x, top: menu.y };
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    pos.value = {
      left: Math.max(6, Math.min(menu.x, window.innerWidth - width - 6)),
      top: menu.y + height > window.innerHeight - 6 ? Math.max(6, menu.y - height) : menu.y,
    };
  },
);

watch(
  () => sidebarUi.confirm,
  async (dialog) => {
    if (!dialog) return;
    await nextTick();
    confirmBtn.value?.focus();
  },
);

watch(
  () => sidebarUi.prompt,
  async (dialog) => {
    if (!dialog) return;
    await nextTick();
    const input = promptInput.value;
    if (!input) return;
    input.focus();
    const dot = dialog.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : dialog.value.length);
  },
);

function run(item: MenuItem): void {
  if (item.disabled) return;
  closeMenu();
  item.run?.();
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (sidebarUi.prompt) settlePrompt(false);
  else if (sidebarUi.confirm) settleConfirm(false);
  else if (sidebarUi.menu) closeMenu();
}
const onBlur = () => closeMenu();

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onBlur);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("resize", onBlur);
});

const dialog = computed(() => sidebarUi.confirm);
const prompt = computed(() => sidebarUi.prompt);
</script>

<template>
  <div v-if="sidebarUi.menu" class="ctx-backdrop" @mousedown="closeMenu" @contextmenu.prevent="closeMenu">
    <div ref="menuEl" class="ctx-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @mousedown.stop>
      <template v-for="(item, i) in sidebarUi.menu.items" :key="i">
        <div v-if="item.separator" class="ctx-sep" />
        <button v-else class="ctx-item" :class="{ danger: item.danger }" :disabled="item.disabled" @click="run(item)">
          <span class="ctx-icon" v-html="item.icon ?? ''" />
          <span class="ctx-label">{{ item.label }}</span>
          <span v-if="item.hint" class="ctx-hint">{{ item.hint }}</span>
        </button>
      </template>
    </div>
  </div>

  <div v-if="dialog" class="modal-backdrop" @mousedown.self="settleConfirm(false)">
    <div class="modal confirm" role="alertdialog" @keydown.enter.prevent="settleConfirm(true)">
      <h3 class="modal-title">{{ dialog.title }}</h3>
      <p v-if="dialog.message" class="modal-message">{{ dialog.message }}</p>
      <label v-if="dialog.check" class="confirm-check">
        <input v-model="dialog.check.value" type="checkbox" />
        <span>{{ dialog.check.label }}</span>
      </label>
      <div class="modal-actions">
        <button class="btn" @click="settleConfirm(false)">取消</button>
        <button ref="confirmBtn" class="btn" :class="dialog.danger ? 'danger-solid' : 'primary'" @click="settleConfirm(true)">
          {{ dialog.confirmLabel }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="prompt" class="modal-backdrop" @mousedown.self="settlePrompt(false)">
    <form class="modal confirm" @submit.prevent="settlePrompt(true)">
      <h3 class="modal-title">{{ prompt.title }}</h3>
      <p v-if="prompt.message" class="modal-message">{{ prompt.message }}</p>
      <label class="prompt-field">
        <span>{{ prompt.label }}</span>
        <input
          ref="promptInput"
          v-model="prompt.value"
          class="panel-filter"
          :placeholder="prompt.placeholder"
          spellcheck="false"
        />
      </label>
      <div class="modal-actions">
        <button type="button" class="btn" @click="settlePrompt(false)">取消</button>
        <button type="submit" class="btn primary" :disabled="!prompt.value.trim()">{{ prompt.confirmLabel }}</button>
      </div>
    </form>
  </div>
</template>
