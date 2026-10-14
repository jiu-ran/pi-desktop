<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { closeMenu, settleConfirm, ui } from "./ui.js";

/** 右键菜单 + 确认弹窗 */
const menuEl = ref(null);
const confirmBtn = ref(null);
const pos = ref({ left: 0, top: 0 });

// 菜单不超出窗口：渲染后按实际尺寸调整位置
watch(() => ui.menu, async (menu) => {
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
});

watch(() => ui.confirm, async (dialog) => {
  if (!dialog) return;
  await nextTick();
  confirmBtn.value?.focus();
});

function run(item) {
  if (item.disabled) return;
  closeMenu();
  item.run();
}

function onKey(event) {
  if (event.key !== "Escape") return;
  if (ui.confirm) settleConfirm(false);
  else if (ui.menu) closeMenu();
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

const dialog = computed(() => ui.confirm);
</script>

<template>
  <div v-if="ui.menu" class="ctx-backdrop" @mousedown="closeMenu" @contextmenu.prevent="closeMenu">
    <div ref="menuEl" class="ctx-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @mousedown.stop>
      <template v-for="(item, i) in ui.menu.items" :key="i">
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
</template>
