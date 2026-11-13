<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { appSettings } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { thinkingLabel } from "../../../shared/util.ts";
import SettingGroup from "./SettingGroup.vue";
import SelectMenu from "../../shared/SelectMenu.vue";
import SettingRow from "./SettingRow.vue";
import type { PiModelDefaultsOverview } from "../../../env.d.ts";
import { supportedThinkingLevels } from "../../../shared/thinking-levels.ts";

/**
 * 对话与并发：怎么说、怎么排队、文件怎么自动保存。
 *
 * 从 SettingsModal 里拆出来的第一个页面，用 SettingGroup / SettingRow 表达结构，
 * 样式仍走 `.settings-*`，所以外观不受拆分影响。
 */
const { workbench } = useKernel();

/**
 * 新会话默认模型 / 思考等级。
 *
 * 写的是 Pi 自己的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel`
 * （`settings.json`），所以终端里的 `pi` 也一致 —— 不会出现「桌面端选了 A、命令行还是 B」。
 * 这里只影响**新建**会话；当前会话仍用输入框里的模型 / 思考选择器。
 */
const active = computed(() => workbench.active.value);
const availableModels = computed(() =>
  (active.value?.models ?? []).map((model: any) => ({
    value: `${model.provider}/${model.id}`,
    label: model.name || model.id,
    hint: model.provider,
    model,
  })),
);
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
  ...(modelDefaults.value?.projectSettingsPath
    ? [{ value: "project", label: "当前项目", hint: modelDefaults.value.projectWritable ? ".pi/settings.json" : "需要先信任此项目" }]
    : []),
]);
/**
 * 思考等级跟着**所选模型**的能力走：不支持推理的模型只有「关闭」，
 * 部分模型也没有 xhigh / max —— 列出一堆选了没效果的档位只会让人困惑。
 * 还没选模型（跟随 Pi 默认）时退回当前会话模型的能力。
 */
const selectedModel = computed(() => {
  const setting = currentScopeSetting.value;
  const ref = setting.provider && setting.model ? `${setting.provider}/${setting.model}` : "";
  const fromList = availableModels.value.find((item) => item.value === ref);
  return fromList?.model ?? (active.value?.model as any) ?? null;
});
const thinkingOptions = computed(() => {
  const supported = supportedThinkingLevels(selectedModel.value);
  const levels = supported.length ? supported : (modelDefaults.value?.thinkingLevels ?? []);
  return [
    { value: "", label: "跟随 Pi 默认" },
    ...levels.map((level) => ({ value: level, label: `${thinkingLabel(level)} (${level})` })),
  ];
});

/** 已保存的等级在当前模型上不支持时提醒一句（否则用户会以为设置没生效） */
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
  // 顺手作用到当前会话（模型不支持就静默忽略），跟以前的行为一致
  if (value && active.value?.status === "ready") void workbench.setThinking(value).catch(() => {});
}
</script>

<template>
  <SettingGroup title="消息发送与交互">
    <SettingRow label="发送消息快捷键" hint="选择输入框按下回车键时的默认发送方式">
      <SelectMenu
        v-model="appSettings.sendShortcut"
        aria-label="发送消息快捷键"
        :options="[
          { value: 'enter', label: 'Enter 发送', hint: 'Shift+Enter 换行' },
          { value: 'ctrl-enter', label: 'Ctrl+Enter 发送', hint: 'Enter 换行' },
        ]"
      />
    </SettingRow>

    <SettingRow label="运行中默认发送模式" hint="当前会话正在执行任务时，继续发送新消息的默认处理策略">
      <SelectMenu
        v-model="appSettings.streamingMode"
        aria-label="运行中默认发送模式"
        :options="[
          { value: 'followUp', label: '排队', hint: '本轮结束后执行' },
          { value: 'steer', label: '引导', hint: '立即插入当前回合' },
        ]"
      />
    </SettingRow>

  </SettingGroup>

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
      hint="打开任意项目后就能从当前可用模型里挑；也可以直接改 settings.json 里的 defaultProvider / defaultModel"
    >
      <span class="settings-status-pill muted">—</span>
    </SettingRow>

    <SettingRow v-if="error" label="保存失败" :hint="error">
      <span class="settings-status-pill muted">—</span>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="文件编辑器与自动保存">
    <SettingRow label="修改文件自动保存" hint="控制在代码编辑器中修改项目文件后的自动落盘保存策略">
      <SelectMenu
        v-model="appSettings.autoSave"
        aria-label="修改文件自动保存"
        :options="[
          { value: 'off', label: '关闭' },
          { value: 'afterDelay', label: '延迟保存' },
          { value: 'onFocusChange', label: '失焦时' },
          { value: 'onWindowChange', label: '切窗口时' },
        ]"
      />
    </SettingRow>

    <SettingRow
      label="自动保存延迟时间"
      :disabled="appSettings.autoSave !== 'afterDelay'"
      :hint="
        appSettings.autoSave === 'afterDelay'
          ? `停止输入 ${appSettings.autoSaveDelay}ms 后自动写入磁盘`
          : '仅在「延迟保存」模式下生效'
      "
    >
      <SelectMenu
        v-model="appSettings.autoSaveDelay"
        aria-label="自动保存延迟时间"
        :disabled="appSettings.autoSave !== 'afterDelay'"
        :options="[500, 1000, 2000, 3000].map((ms) => ({ value: ms, label: ms >= 1000 ? `${ms / 1000}s` : `${ms}ms` }))"
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="同目录多会话并行与自动化">
    <SettingRow
      label="单目录温备 Worker 进程上限"
      hint="同一项目目录支持任意数量任务同时并行运行；此项控制任务结束后保留的空闲温备进程数（切换更快）"
    >
      <SelectMenu
        v-model="appSettings.maxIdleWorkers"
        aria-label="单目录温备 Worker 进程上限"
        :options="[1, 2, 3, 5].map((num) => ({ value: num, label: `${num} 个` }))"
      />
    </SettingRow>

    <SettingRow
      clickable
      label="后台并行任务完成提醒"
      hint="当同一目录或其他目录下的后台会话执行完毕时，弹出完成通知并点亮侧边栏「已完成」徽标"
    >
      <input v-model="appSettings.notifyOnBackgroundDone" type="checkbox" class="settings-switch" />
    </SettingRow>

    <SettingRow
      clickable
      label="自动压缩上下文（Auto Compaction）"
      hint="当会话 Token 接近模型上下文窗口上限时，自动总结并压缩历史消息"
    >
      <input v-model="appSettings.autoCompaction" type="checkbox" class="settings-switch" />
    </SettingRow>

    <SettingRow
      clickable
      label="网络或模型请求异常自动重试（Auto Retry）"
      hint="遇到临时速率限制或网络波动时由 Pi 进程自动退避重试"
    >
      <input v-model="appSettings.autoRetry" type="checkbox" class="settings-switch" />
    </SettingRow>
  </SettingGroup>
</template>
