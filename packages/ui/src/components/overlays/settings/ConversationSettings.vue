<script setup lang="ts">
import { appSettings } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { thinkingLabel } from "../../../shared/util.ts";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

/**
 * 对话与并发：怎么说、怎么排队、文件怎么自动保存。
 *
 * 从 SettingsModal 里拆出来的第一个页面，用 SettingGroup / SettingRow 表达结构，
 * 样式仍走 `.settings-*`，所以外观不受拆分影响。
 */
const { workbench } = useKernel();

const thinkingOptions: Array<{ value: typeof appSettings.defaultThinking; label: string }> = [
  { value: "off", label: `${thinkingLabel("off")} (off)` },
  { value: "minimal", label: `${thinkingLabel("minimal")} (minimal)` },
  { value: "low", label: `${thinkingLabel("low")} (low)` },
  { value: "medium", label: `${thinkingLabel("medium")} (medium)` },
  { value: "high", label: `${thinkingLabel("high")} (high)` },
  { value: "xhigh", label: `${thinkingLabel("xhigh")} (xhigh)` },
];

/** 改思考深度后，立即作用于当前会话（模型不支持就静默忽略） */
async function applyThinkingNow(): Promise<void> {
  const active = workbench.active.value;
  if (!active || active.status !== "ready") return;
  try {
    await workbench.setThinking(appSettings.defaultThinking);
  } catch {
    // 当前模型不支持这个等级：保持原样，不打断用户
  }
}
</script>

<template>
  <SettingGroup title="消息发送与交互">
    <SettingRow label="发送消息快捷键" hint="选择输入框按下回车键时的默认发送方式">
      <select v-model="appSettings.sendShortcut" class="settings-select">
        <option value="enter">Enter 发送</option>
        <option value="ctrl-enter">Ctrl+Enter 发送</option>
      </select>
    </SettingRow>

    <SettingRow label="运行中默认发送模式" hint="当前会话正在执行任务时，继续发送新消息的默认处理策略">
      <select v-model="appSettings.streamingMode" class="settings-select">
        <option value="followUp">排队（结束后执行）</option>
        <option value="steer">引导（立即插入）</option>
      </select>
    </SettingRow>

    <SettingRow label="默认思考深度（Thinking Level）" hint="新建会话或切换模型时优先采用的思考等级">
      <select v-model="appSettings.defaultThinking" class="settings-select" @change="applyThinkingNow">
        <option v-for="opt in thinkingOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="文件编辑器与自动保存">
    <SettingRow label="修改文件自动保存" hint="控制在代码编辑器中修改项目文件后的自动落盘保存策略">
      <select v-model="appSettings.autoSave" class="settings-select">
        <option value="off">关闭</option>
        <option value="afterDelay">延迟保存</option>
        <option value="onFocusChange">失焦时</option>
        <option value="onWindowChange">切窗口时</option>
      </select>
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
      <select
        v-model.number="appSettings.autoSaveDelay"
        class="settings-select"
        :disabled="appSettings.autoSave !== 'afterDelay'"
      >
        <option v-for="ms in [500, 1000, 2000, 3000]" :key="ms" :value="ms">
          {{ ms >= 1000 ? `${ms / 1000}s` : `${ms}ms` }}
        </option>
      </select>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="同目录多会话并行与自动化">
    <SettingRow
      label="单目录温备 Worker 进程上限"
      hint="同一项目目录支持任意数量任务同时并行运行；此项控制任务结束后保留的空闲温备进程数（切换更快）"
    >
      <select v-model.number="appSettings.maxIdleWorkers" class="settings-select">
        <option v-for="num in [1, 2, 3, 5]" :key="num" :value="num">{{ num }} 个</option>
      </select>
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
