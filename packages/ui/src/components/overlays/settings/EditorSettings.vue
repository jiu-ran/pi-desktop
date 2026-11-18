<script setup lang="ts">
import { appSettings } from "../../../services/settings.ts";
import SelectMenu from "../../shared/SelectMenu.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

/**
 * 编辑器：项目文件的保存行为。
 *
 * 以前塞在「对话与并发」里，但它和聊天没有关系；拆成独立页后，
 * 对话页只保留发送 / 排队 / 并行，编辑器只保留保存策略。
 */
</script>

<template>
  <SettingGroup title="文件保存">
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
</template>
