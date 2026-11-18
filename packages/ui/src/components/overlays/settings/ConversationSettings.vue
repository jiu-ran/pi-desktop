<script setup lang="ts">
import { appSettings } from "../../../services/settings.ts";
import SelectMenu from "../../shared/SelectMenu.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

/**
 * 对话：发送方式、排队策略与同目录并行。
 *
 * 模型默认值属于「智能体 → Pi」，文件保存属于「编辑器」；这两组不放这里，
 * 避免同一类配置在多页出现。
 */
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
