<script setup lang="ts">
import { onMounted, ref } from "vue";
import { appSettings } from "../../../services/settings.ts";
import { useKernel } from "../../../kernel/use-kernel.ts";
import { formatBytes as formatSize } from "../../../shared/attachments.ts";
import { DEFAULT_LOG_MAX_BYTES, LOG_MAX_CHOICES_MB } from "../../../shared/log-limit.ts";
import SettingGroup from "./SettingGroup.vue";
import SelectMenu from "../../shared/SelectMenu.vue";
import SettingRow from "./SettingRow.vue";

/**
 * 运行日志：占用、上限、清理与文件列表。
 *
 * 以前这份状态挂在 SettingsModal 上，靠监听 tab 切换去拉数据；
 * 拆成独立页面后只要挂载就加载，逻辑和界面待在一起。
 */
const { bus } = useKernel();

const dir = ref("");
const totalBytes = ref(0);
const files = ref<Array<{ name: string; size: number; mtimeMs: number }>>([]);
const limitBytes = ref(DEFAULT_LOG_MAX_BYTES);
const fileBytes = ref(DEFAULT_LOG_MAX_BYTES / 4);
const keepFiles = ref(4);
const busy = ref(false);

function formatLogTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function load(): Promise<void> {
  const bridge = window.piDesktop;
  if (!bridge?.logsInfo) return;
  try {
    const info = await bridge.logsInfo();
    if (!info) return;
    dir.value = info.dir ?? "";
    totalBytes.value = info.totalBytes ?? 0;
    files.value = info.files ?? [];
    limitBytes.value = Number(info.limitBytes) || DEFAULT_LOG_MAX_BYTES;
    fileBytes.value = Number(info.fileBytes) || DEFAULT_LOG_MAX_BYTES / 4;
    keepFiles.value = Number(info.keepFiles) || 4;
  } catch {
    // 读不到日志目录不影响设置界面
  }
}

async function openLogsDir(): Promise<void> {
  busy.value = true;
  try {
    await window.piDesktop?.logsOpen?.();
  } finally {
    busy.value = false;
  }
}

async function clearLogs(): Promise<void> {
  busy.value = true;
  try {
    const info = await window.piDesktop?.logsClear?.();
    if (info) {
      dir.value = info.dir ?? dir.value;
      totalBytes.value = info.totalBytes ?? 0;
      files.value = info.files ?? [];
    } else {
      await load();
    }
    bus.emit("notify", { level: "info", text: "已清理旧日志" });
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SettingGroup title="日志目录">
    <SettingRow
      :label="`占用 ${formatSize(totalBytes)} / 上限 ${formatSize(limitBytes)}`"
      :hint="dir || '尚未初始化'"
    >
      <div class="settings-row-actions">
        <button type="button" class="btn ghost small" :disabled="busy || !dir" @click="openLogsDir">打开目录</button>
        <button type="button" class="btn ghost small" :disabled="busy || !files.length" @click="clearLogs">清理</button>
      </div>
    </SettingRow>

    <SettingRow label="总量上限" hint="给日志留多少空间：超了就按时间删最旧的；排查问题时可以临时调大">
      <SelectMenu
        v-model="appSettings.logMaxBytes"
        aria-label="日志总量上限"
        :options="LOG_MAX_CHOICES_MB.map((mb) => ({ value: mb * 1024 * 1024, label: `${mb} MB` }))"
      />
    </SettingRow>

    <SettingRow
      label="记录内容"
      :hint="`app.log 启动 / 退出 / IPC 错误 / 未捕获异常；renderer.log 前端 warn / error；pi.log 会话与压缩事件；perf.log 卡顿（主进程阻塞、慢 IPC、渲染进程长任务）。日志写在安装目录的 logs/（安装目录不可写时回落到用户数据目录，例如装在 Program Files 里）；单文件 ${formatSize(fileBytes)} 轮转（最多留 ${keepFiles} 个），总量超过上限后按时间删最旧的，正在写的文件不会被删。`"
    />
  </SettingGroup>

  <SettingGroup :title="`文件（最近在前）· ${files.length}`">
    <SettingRow v-if="!files.length" label="还没有日志文件" />
    <SettingRow v-for="file in files" :key="file.name" :label="file.name" :hint="`${formatSize(file.size)} · ${formatLogTime(file.mtimeMs)}`" />
  </SettingGroup>
</template>
