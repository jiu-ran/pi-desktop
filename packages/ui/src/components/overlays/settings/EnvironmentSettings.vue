<script setup lang="ts">
import { computed } from "vue";
import { useKernel } from "../../../kernel/use-kernel.ts";

/**
 * 环境与快捷键：只保留「当前工作区」与快捷键速查。
 *
 * 本机 Pi CLI、Pi Desktop 更新各自独立成一页一级分区（pi-cli / pi-desktop），
 * 这里不再重复它们的状态与按钮。
 */
const { workbench, bus } = useKernel();
const ws = computed(() => workbench.active.value);

/** 重启当前会话的 Pi 进程（改完路径 / 更新后让新进程生效） */
async function restartActiveProcess(): Promise<void> {
  if (!ws.value) return;
  await workbench.restart(ws.value);
  bus.emit("notify", { level: "info", text: "已重启当前会话的 Pi 进程" });
}
</script>

<template>
  <div class="settings-group">
    <div class="settings-group-title">当前工作区</div>
    <div v-if="ws" class="settings-row">
      <div class="settings-row-info">
        <strong>当前活动项目目录</strong>
        <span>{{ ws.cwd }}（当前活跃会话线程 {{ Object.keys(ws.threads).length }} 个，运行中 {{ ws.runningSessionCount }} 个）</span>
      </div>
      <button
        type="button"
        class="btn ghost small"
        :disabled="ws.streaming"
        @click="restartActiveProcess"
      >
        重启当前会话进程
      </button>
    </div>
    <div v-else class="settings-row">
      <div class="settings-row-info">
        <strong>当前活动项目目录</strong>
        <span>还没有打开项目</span>
      </div>
    </div>
  </div>

  <div class="settings-group">
    <div class="settings-group-title">全局快捷键速查</div>
    <div class="settings-shortcuts-grid">
      <div class="settings-shortcut-item"><span>打开偏好设置</span><kbd>Ctrl+,</kbd></div>
      <div class="settings-shortcut-item"><span>打开命令面板</span><kbd>Ctrl+K</kbd></div>
      <div class="settings-shortcut-item"><span>打开项目目录</span><kbd>Ctrl+O</kbd></div>
      <div class="settings-shortcut-item"><span>新建并行任务</span><kbd>Ctrl+N</kbd></div>
      <div class="settings-shortcut-item"><span>切换项目与会话栏</span><kbd>Ctrl+B</kbd></div>
      <div class="settings-shortcut-item"><span>手动保存当前编辑文件</span><kbd>Ctrl+S</kbd></div>
      <div class="settings-shortcut-item"><span>停止当前正在执行的任务</span><kbd>Esc</kbd></div>
      <div class="settings-shortcut-item"><span>引用项目文件或目录</span><kbd>@</kbd></div>
      <div class="settings-shortcut-item"><span>打开斜杠命令菜单</span><kbd>/</kbd></div>
    </div>
  </div>
</template>
