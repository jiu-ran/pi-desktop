<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useKernel } from "../../kernel/use-kernel.ts";
import { closeDialog, extState } from "../../services/extension-ui.ts";

const { bus } = useKernel();
const current = computed(() => extState.dialogs[0] ?? null);
const text = ref("");
const permissionDetail = computed(() => {
  const call = current.value?.toolCall;
  if (!call) return "";
  const raw = call.rawInput ?? call.args ?? {};
  return String(raw.CommandLine ?? raw.command ?? call.title ?? "");
});

watch(current, (req) => {
  text.value = req?.prefill ?? "";
});

function respond(payload: Record<string, any>): void {
  const req = current.value;
  if (!req) return;
  closeDialog(req.id);
  bus.emit("extension-ui:respond", {
    cwd: req.cwd,
    sessionFile: req.sessionFile,
    response: { id: req.id, ...payload },
  });
}

function choose(option: string): void {
  respond({ value: option });
}
function choosePermission(optionId: string): void {
  const req = current.value;
  if (!req) return;
  closeDialog(req.id);
  bus.emit("acp:permission-respond", {
    cwd: req.cwd,
    sessionFile: req.sessionFile,
    id: req.id,
    optionId,
  });
}
function confirm(ok: boolean): void {
  respond({ confirmed: ok });
}
function submitText(): void {
  respond({ value: text.value });
}
function cancel(): void {
  if (current.value?.method === "acp_permission") {
    choosePermission("");
    return;
  }
  respond({ cancelled: true });
}
</script>

<template>
  <div v-if="current" class="overlay" @mousedown.self="cancel">
    <div class="dialog">
      <header class="dialog-header">
        <strong>{{ current.title || "Pi 请求确认" }}</strong>
        <span class="badge">{{ current.method }}</span>
      </header>

      <p v-if="current.message" class="dialog-message">{{ current.message }}</p>
      <pre v-if="current.method === 'acp_permission' && permissionDetail" class="dialog-detail">{{ permissionDetail }}</pre>

      <div v-if="current.method === 'acp_permission'" class="dialog-options">
        <button
          v-for="opt in current.options || []"
          :key="opt.optionId"
          class="option-btn"
          :class="{ danger: String(opt.kind || '').startsWith('reject') }"
          @click="choosePermission(opt.optionId)"
        >
          {{ opt.name || opt.optionId }}
        </button>
        <button class="btn ghost" @click="choosePermission('')">拒绝</button>
      </div>

      <div v-else-if="current.method === 'select'" class="dialog-options">
        <button v-for="opt in current.options || []" :key="opt" class="option-btn" @click="choose(opt)">
          {{ opt }}
        </button>
      </div>

      <div v-else-if="current.method === 'confirm'" class="dialog-actions">
        <button class="btn ghost" @click="confirm(false)">取消</button>
        <button class="btn primary" @click="confirm(true)">确认</button>
      </div>

      <form v-else-if="current.method === 'input' || current.method === 'editor'" class="dialog-form" @submit.prevent="submitText">
        <textarea v-if="current.method === 'editor'" v-model="text" rows="8" />
        <input v-else v-model="text" :placeholder="current.placeholder || ''" />
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="cancel">取消</button>
          <button type="submit" class="btn primary">提交</button>
        </div>
      </form>
    </div>
  </div>
</template>
