<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { icons, thinkingLabel } from "../../shared/util.ts";
import { clampThinkingLevel, supportedThinkingLevels } from "../../shared/thinking-levels.ts";

/**
 * 合并的模型与思考程度选择器。
 *
 * 以前模型和思考分成两个下拉摆在底栏：不仅占地方、更容易把其中一个压成省略号，
 * 而且切了模型还得再点开另一个下拉调思考等级。合在一起之后：
 * 1. 先选模型（支持筛选，列表标出「默认」）；
 * 2. 紧挨着下面就是这个模型真正支持的思考档位，切换模型后即时刷新；
 * 3. 最底下一次把「当前模型 + 当前思考」写成新会话默认值。
 */

const props = withDefaults(
  defineProps<{
    models: any[];
    currentModel?: any;
    currentThinking?: string;
    availableLevels?: string[];
    defaultModelRef?: string;
    defaultThinking?: string;
    disabled?: boolean;
  }>(),
  {
    currentModel: null,
    currentThinking: "off",
    availableLevels: () => [],
    defaultModelRef: "",
    defaultThinking: "",
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: "select-model", model: any): void | Promise<void>;
  (e: "select-thinking", level: string): void | Promise<void>;
  (e: "set-default", payload: { model: any; thinkingLevel: string }): void | Promise<void>;
  (e: "opened"): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const filterInput = ref<HTMLInputElement | null>(null);
const filter = ref("");
const offsetX = ref(0);

const currentModelRef = computed(() =>
  props.currentModel ? `${props.currentModel.provider}/${props.currentModel.id}` : "",
);

const currentModelName = computed(
  () => props.currentModel?.name || props.currentModel?.id || "选择模型",
);

const visibleModels = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return (props.models ?? []).filter((m: any) => {
    if (!q) return true;
    const text = `${m.name ?? ""} ${m.id ?? ""} ${m.provider ?? ""}`.toLowerCase();
    return text.includes(q);
  });
});

/** 当前模型真正支持的思考档位：与 Pi 的 getSupportedThinkingLevels 一致 */
const modelLevels = computed(() => {
  const supported = supportedThinkingLevels(props.currentModel);
  if (supported.length) return supported;
  return props.availableLevels?.length ? props.availableLevels : ["off"];
});

const effectiveThinking = computed(() =>
  clampThinkingLevel(props.currentThinking ?? "off", modelLevels.value),
);

const effectiveThinkingLabel = computed(() => thinkingLabel(effectiveThinking.value));

const showThinkingInButton = computed(() => modelLevels.value.length > 1);

const alreadyDefault = computed(() => {
  if (!currentModelRef.value) return false;
  if (currentModelRef.value !== props.defaultModelRef) return false;
  // 不支持调节思考的模型只比对模型本身；支持的模型同时比对思考档位
  if (modelLevels.value.length <= 1) return true;
  return effectiveThinking.value === props.defaultThinking;
});

const defaultActionLabel = computed(() => {
  if (!currentModelRef.value) return "选择模型后可设为默认";
  if (alreadyDefault.value) return "当前模型与思考已设为新会话默认";
  if (modelLevels.value.length <= 1) return `将「${currentModelName.value}」设为新会话默认`;
  return `将「${currentModelName.value} · ${effectiveThinkingLabel.value}」设为默认`;
});

const buttonTitle = computed(() => {
  const modelPart = currentModelRef.value ? `模型：${currentModelRef.value}` : "选择模型";
  if (!showThinkingInButton.value) return modelPart;
  return `${modelPart} · 思考：${effectiveThinkingLabel.value}（${effectiveThinking.value}）`;
});

async function updateMenuPosition(): Promise<void> {
  await nextTick();
  const menu = menuEl.value;
  const container = root.value?.closest(".island") ?? document.documentElement;
  if (!menu || !container) return;
  const mRect = menu.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  if (mRect.right > cRect.right - 8) {
    offsetX.value = Math.max(cRect.left + 8 - mRect.left, cRect.right - 8 - mRect.right);
  } else if (mRect.left < cRect.left + 8) {
    offsetX.value = cRect.left + 8 - mRect.left;
  }
}

async function toggle(): Promise<void> {
  if (props.disabled) return;
  open.value = !open.value;
  filter.value = "";
  offsetX.value = 0;
  if (open.value) {
    emit("opened");
    await updateMenuPosition();
    filterInput.value?.focus();
  }
}

watch(
  () => props.currentModel?.id,
  () => {
    if (open.value) void updateMenuPosition();
  },
);

function pickModel(model: any): void {
  emit("select-model", model);
}

function pickThinking(level: string): void {
  emit("select-thinking", level);
}

function applyDefault(): void {
  if (!props.currentModel || alreadyDefault.value) return;
  emit("set-default", { model: props.currentModel, thinkingLevel: effectiveThinking.value });
  // 点「设为默认」是一次明确的收尾动作：保存并顺手关掉面板，不用再多点一下空白处
  open.value = false;
}

function outside(event: Event): void {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("click", outside);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("click", outside);
});
</script>

<template>
  <div ref="root" class="picker">
    <button
      type="button"
      class="picker-btn model-thinking-btn"
      :class="{ open }"
      :title="buttonTitle"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="picker-label">{{ currentModelName }}</span>
      <template v-if="showThinkingInButton">
        <span class="mt-btn-sep" aria-hidden="true">·</span>
        <span class="mt-btn-thinking">
          <span class="picker-icon" v-html="icons.brain" />
          <span class="mt-btn-thinking-label">{{ effectiveThinkingLabel }}</span>
        </span>
      </template>
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      </svg>
    </button>

    <div
      v-if="open"
      ref="menuEl"
      class="picker-menu model-thinking-menu"
      :style="offsetX ? { transform: `translateX(${Math.round(offsetX)}px)` } : undefined"
      @keydown.esc="open = false"
    >
      <input
        ref="filterInput"
        v-model="filter"
        class="picker-filter"
        placeholder="筛选模型…"
        @keydown.esc.stop="open = false"
      />

      <div class="picker-items">
        <button
          v-for="m in visibleModels"
          :key="`${m.provider}/${m.id}`"
          type="button"
          class="picker-item"
          :class="{ active: `${m.provider}/${m.id}` === currentModelRef }"
          @click="pickModel(m)"
        >
          <span class="picker-item-label">{{ m.name || m.id }}</span>
          <span v-if="`${m.provider}/${m.id}` === defaultModelRef" class="picker-item-badge">默认</span>
          <small v-if="m.provider">{{ m.provider }}</small>
          <svg
            v-if="`${m.provider}/${m.id}` === currentModelRef"
            class="picker-check"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </button>
        <p v-if="!visibleModels.length" class="picker-empty">没有匹配的模型</p>
      </div>

      <div class="mt-thinking-section">
        <div class="mt-thinking-head">
          <span class="mt-thinking-title">
            <span class="picker-icon" v-html="icons.brain" />
            <span>思考程度</span>
          </span>
          <span v-if="modelLevels.length <= 1" class="mt-thinking-note">此模型不支持调节</span>
        </div>
        <div class="mt-level-pills" role="radiogroup" aria-label="思考程度">
          <button
            v-for="level in modelLevels"
            :key="level"
            type="button"
            role="radio"
            class="mt-level-pill"
            :class="{ active: level === effectiveThinking }"
            :aria-checked="level === effectiveThinking"
            :title="
              level === defaultThinking && modelLevels.length > 1
                ? `${thinkingLabel(level)}（${level}）· 新会话默认`
                : `${thinkingLabel(level)}（${level}）`
            "
            @click="pickThinking(level)"
          >
            <span>{{ thinkingLabel(level) }}</span>
            <span v-if="level === defaultThinking && modelLevels.length > 1" class="mt-pill-default">默认</span>
          </button>
        </div>
      </div>

      <div v-if="currentModelRef" class="picker-actions">
        <button
          type="button"
          class="picker-action"
          :class="{ disabled: alreadyDefault }"
          :disabled="alreadyDefault"
          @click="applyDefault"
        >
          <span class="picker-item-label">{{ defaultActionLabel }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
