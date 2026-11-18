<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { thinkingLabel } from "../../../shared/util.ts";
import { supportedThinkingLevels } from "../../../shared/thinking-levels.ts";
import type { PiModelDefaultsOverview } from "../../../env.d.ts";
import SelectMenu from "../../shared/SelectMenu.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

/**
 * Pi 的新会话默认模型 / 思考等级。
 *
 * 写 Pi 自己的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel`，
 * 所以终端里的 `pi` 也一致。它属于「智能体 → Pi」，不再放在对话页：
 * 这是 Agent 能力配置，不是聊天行为。
 */
const { workbench } = useKernel();

const active = computed(() => workbench.active.value);
const availableModels = computed(() => {
  // 只有当前工作区本身就是 Pi 时，模型列表才是 Pi 的可用模型；
  // 在 Antigravity 项目里打开 Pi 详情时不能把 Gemini 型号写进 Pi 默认值。
  if (active.value?.agent !== "pi") return [];
  return (active.value?.models ?? []).map((model: any) => ({
    value: `${model.provider}/${model.id}`,
    label: model.name || model.id,
    hint: model.provider,
    model,
  }));
});
const modelDefaults = ref<PiModelDefaultsOverview | null>(null);
const scope = ref<"global" | "project">("global");
const saving = ref(false);
const error = ref("");

async function loadDefaults(): Promise<void> {
  if (!workbench.modelDefaults) return;
  try {
    modelDefaults.value = await workbench.modelDefaults();
    error.value = "";
  } catch (reason: any) {
    error.value = reason?.message ?? String(reason);
  }
}

onMounted(() => { void loadDefaults(); });
// 换项目/换会话后重新读：生效值取决于项目设置与信任状态
watch(() => active.value?.cwd, () => { void loadDefaults(); });
watch(() => active.value?.agent, (agent) => { if (agent !== "pi") scope.value = "global"; });

const currentScopeSetting = computed(() => {
  const data = modelDefaults.value;
  if (!data) return { provider: "", model: "", thinkingLevel: "" };
  return scope.value === "project" ? data.project : data.global;
});
const modelValue = computed(() =>
  currentScopeSetting.value.provider && currentScopeSetting.value.model
    ? `${currentScopeSetting.value.provider}/${currentScopeSetting.value.model}`
    : "",
);
const thinkingValue = computed(() => currentScopeSetting.value.thinkingLevel);
const scopeOptions = computed(() => [
  { value: "global", label: "全局", hint: "所有项目" },
  ...(active.value?.agent === "pi" && modelDefaults.value?.projectSettingsPath
    ? [{ value: "project", label: "当前项目", hint: modelDefaults.value.projectWritable ? ".pi/settings.json" : "需要先信任此项目" }]
    : []),
]);
const selectedModel = computed(() => {
  const setting = currentScopeSetting.value;
  const ref = setting.provider && setting.model ? `${setting.provider}/${setting.model}` : "";
  const fromList = availableModels.value.find((item) => item.value === ref);
  return fromList?.model ?? (active.value?.agent === "pi" ? active.value?.model as any : null);
});
const thinkingOptions = computed(() => {
  const supported = supportedThinkingLevels(selectedModel.value);
  const levels = supported.length ? supported : (modelDefaults.value?.thinkingLevels ?? []);
  return [
    { value: "", label: "跟随 Pi 默认" },
    ...levels.map((level) => ({ value: level, label: `${thinkingLabel(level)} (${level})` })),
  ];
});

const thinkingUnsupported = computed(() => {
  const saved = currentScopeSetting.value.thinkingLevel;
  if (!saved) return false;
  return !thinkingOptions.value.some((option) => option.value === saved);
});
const disabled = computed(() => saving.value || (scope.value === "project" && !modelDefaults.value?.projectWritable));

async function save(payload: { provider?: string; model?: string; thinkingLevel?: string }): Promise<void> {
  if (!workbench.setModelDefaults) return;
  saving.value = true;
  error.value = "";
  try {
    const next = await workbench.setModelDefaults({ scope: scope.value, ...payload });
    if (next) modelDefaults.value = next;
  } catch (reason: any) {
    error.value = reason?.message ?? String(reason);
  } finally {
    saving.value = false;
  }
}

function onModelChange(value: string): void {
  if (!value) { void save({ provider: "", model: "" }); return; }
  const [provider, ...rest] = String(value).split("/");
  void save({ provider, model: rest.join("/") });
}

function onThinkingChange(value: string): void {
  void save({ thinkingLevel: value || "" });
  // 顺手作用到当前会话（模型不支持就静默忽略）
  if (value && active.value?.status === "ready") void workbench.setThinking(value).catch(() => {});
}
</script>

<template>
  <SettingGroup title="新会话默认模型与思考等级">
    <SettingRow
      label="写入位置"
      :hint="
        scope === 'project'
          ? '写到当前项目的 .pi/settings.json（只对信任过的项目生效）'
          : '写到 Pi 的全局设置 settings.json，所有项目与终端 pi 都认'
      "
    >
      <SelectMenu v-model="scope" aria-label="写入位置" :options="scopeOptions" @change="loadDefaults" />
    </SettingRow>

    <SettingRow label="默认模型" hint="新会话启动时用的模型；「跟随 Pi 默认」表示不指定">
      <SelectMenu
        :model-value="modelValue"
        aria-label="默认模型"
        :disabled="disabled"
        :options="[{ value: '', label: '跟随 Pi 默认' }, ...availableModels]"
        @update:model-value="onModelChange"
      />
    </SettingRow>

    <SettingRow
      label="默认思考程度"
      :hint="
        thinkingUnsupported
          ? '当前模型不支持已保存的等级，新会话里 Pi 会自动降级；建议重新选一个'
          : '选项跟着模型走：不支持推理的模型只有「关闭」，部分模型也没有 xhigh / max'
      "
    >
      <SelectMenu
        :model-value="thinkingValue"
        aria-label="默认思考程度"
        :disabled="disabled"
        :options="thinkingOptions"
        @update:model-value="onThinkingChange"
      />
    </SettingRow>

    <SettingRow
      v-if="modelDefaults && (modelDefaults.effective.provider || modelDefaults.effective.thinkingLevel)"
      label="当前生效"
      hint="项目设置优先于全局设置；新建会话时 Pi 按这份生效值启动"
    >
      <span class="settings-status-pill">
        {{ modelDefaults.effective.provider ? modelDefaults.effective.provider + "/" + modelDefaults.effective.model : "模型跟随 Pi 默认" }}
        · 思考 {{ modelDefaults.effective.thinkingLevel ? thinkingLabel(modelDefaults.effective.thinkingLevel) : "跟随默认" }}
      </span>
    </SettingRow>

    <SettingRow
      v-if="!availableModels.length"
      label="暂时拿不到模型列表"
      hint="当前项目不是 Pi，或还没有模型列表；打开一个 Pi 项目后就能从这里挑，也可以直接改 settings.json 的 defaultProvider / defaultModel"
    >
      <span class="settings-status-pill muted">—</span>
    </SettingRow>

    <SettingRow v-if="error" label="保存失败" :hint="error">
      <span class="settings-status-pill muted">—</span>
    </SettingRow>
  </SettingGroup>
</template>
