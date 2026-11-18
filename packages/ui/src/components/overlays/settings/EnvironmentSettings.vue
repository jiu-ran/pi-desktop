<script setup lang="ts">
/**
 * 快捷键：只做速查。
 *
 * 这里不放「重启当前会话进程」之类的操作，也不重复终端 / 编辑器 / 外观页的配置；
 * 设置页只保留用户会主动查找的静态快捷键说明。
 */
</script>

<template>
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
      <div class="settings-shortcut-item"><span>翻阅输入过的内容</span><kbd>↑ / ↓</kbd></div>
    </div>
  </div>
</template>
