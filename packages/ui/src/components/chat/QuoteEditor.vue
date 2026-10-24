<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { formatBytes } from "../../shared/attachments.ts";
import { icons } from "../../shared/util.ts";

/**
 * 会话引用编辑对话框。
 *
 * 引用别的对话时，默认注入的是主进程压过的摘要（只留用户/助手文字、工具结果不进）。
 * 有时用户想要另一段内容（例如只要结论、或补一句说明），所以允许在这里改：
 * - 「上下文正文」可以直接编辑；保存后发送时用它，不再走自动摘要
 * - 「恢复自动」把正文还原成当前项目的自动摘要
 */
const props = defineProps<{
  open: boolean;
  /** 会话文件路径（用于标识与恢复自动） */
  file: string;
  title?: string;
  /** 自动生成的上下文块文本 */
  autoText?: string;
  /** 用户已保存的自定义正文 */
  customText?: string;
  messages?: number;
  size?: number;
  busy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [{ name: string; customText: string | null }];
}>();

const name = ref("");
const body = ref("");
const restoring = ref(false);

function reset(): void {
  name.value = props.title ?? "";
  body.value = props.customText ?? props.autoText ?? "";
}

watch(
  () => [props.open, props.file],
  () => {
    if (props.open) reset();
  },
  { immediate: true },
);
// 自动摘要晚到（或父组件刷新）时，只有用户还没动过输入才更新，别覆盖正在编辑的内容
watch(
  () => [props.customText, props.autoText],
  () => {
    if (props.open && !dirty.value) reset();
  },
);

const dirty = computed(() => {
  const nextBody = body.value.trim();
  const original = (props.customText ?? props.autoText ?? "").trim();
  return nextBody !== original || (props.title ?? "") !== name.value.trim();
});

const usingCustom = computed(() => typeof props.customText === "string" && Boolean(props.customText.trim()));
const charCount = computed(() => body.value.trim().length);

const nameInput = ref<HTMLInputElement | null>(null);

async function focusName(): Promise<void> {
  await nextTick();
  nameInput.value?.focus();
}

async function restoreAuto(): Promise<void> {
  restoring.value = true;
  try {
    emit("save", { name: name.value, customText: null });
  } finally {
    restoring.value = false;
  }
}

function save(): void {
  const value = body.value.trim();
  const auto = (props.autoText ?? "").trim();
  emit("save", { name: name.value, customText: value && value !== auto ? value : null });
}

function close(): void {
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="quote-modal" data-quote-modal @keydown="onKeydown">
      <div class="quote-scrim" @click="close" />
      <div class="quote-dialog" role="dialog" aria-modal="true" aria-label="编辑引用的对话">
        <header class="quote-head">
          <span class="quote-icon" v-html="icons.chat" />
          <div class="quote-heading">
            <strong>编辑引用的对话</strong>
            <span class="quote-meta">
              {{ messages ? `${messages} 条消息` : "会话" }}
              <template v-if="size"> · {{ formatBytes(size) }}</template>
              <template v-if="usingCustom"> · 已改为自定义内容</template>
            </span>
          </div>
          <button type="button" class="icon-btn" title="关闭" aria-label="关闭" @click="close" v-html="icons.close" />
        </header>

        <div class="quote-body">
          <label class="quote-field">
            <span class="quote-label">显示名称</span>
            <input ref="nameInput" v-model="name" class="quote-input" spellcheck="false" placeholder="会话名称" @focus="focusName" />
          </label>

          <label class="quote-field quote-field-grow">
            <span class="quote-label">
              注入的上下文
              <span class="quote-hint">发送时放进提示词的开头；清空并保存等于恢复自动摘要</span>
            </span>
            <textarea
              v-model="body"
              class="quote-textarea"
              spellcheck="false"
              placeholder="这里是可以直接改的上下文正文"
            />
          </label>
          <div class="quote-foot-meta">
            <span>{{ charCount }} 字</span>
            <span class="quote-path" :title="file">{{ file }}</span>
          </div>
        </div>

        <footer class="quote-actions">
          <button type="button" class="btn ghost small" :disabled="busy || !usingCustom" @click="restoreAuto">
            恢复自动摘要
          </button>
          <div class="quote-actions-right">
            <button type="button" class="btn ghost small" @click="close">取消</button>
            <button type="button" class="btn primary small" :disabled="busy || !dirty" @click="save">保存</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.quote-modal {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
}
.quote-scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.quote-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 92vw);
  min-height: 320px;
  max-height: min(720px, 82vh);
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: var(--bg-1);
  box-shadow: var(--shadow);
}
.quote-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: none;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.quote-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.quote-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.quote-heading strong {
  font-size: 13px;
}
.quote-meta {
  overflow: hidden;
  color: var(--fg-3);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quote-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
}
.quote-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.quote-field-grow {
  flex: 1;
  min-height: 0;
}
.quote-label {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: var(--fg-2);
  font-size: 11.5px;
  font-weight: 600;
}
.quote-hint {
  color: var(--fg-3);
  font-weight: 400;
}
.quote-input {
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: var(--bg-2);
  color: var(--fg);
  font-size: 12.5px;
}
.quote-input:focus,
.quote-textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.quote-textarea {
  flex: 1;
  min-height: 160px;
  padding: 9px 10px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--fg);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.55;
  resize: none;
}
.quote-foot-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg-3);
  font-size: 11px;
}
.quote-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quote-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}
.quote-actions-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
</style>
