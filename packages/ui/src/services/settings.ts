import { reactive, watch, watchEffect } from "vue";
import type { EventBus } from "../kernel/event-bus.ts";
import type { Workbench } from "../kernel/workbench.ts";

const SETTINGS_STORAGE_KEY = "pi-desktop.settings";

export type SettingsTabId = "conversation" | "appearance" | "mcp" | "packages" | "skills" | "plugins" | "environment";

export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange" | "onWindowChange";

export interface AppSettings {
  /** 发送快捷键：enter = Enter 发送 / Shift+Enter 换行；ctrl-enter = Ctrl+Enter 发送 / Enter 换行 */
  sendShortcut: "enter" | "ctrl-enter";
  /** 运行中默认插入方式：followUp = 排队；steer = 引导 */
  streamingMode: "followUp" | "steer";
  /** 新建会话默认思考深度 */
  defaultThinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** 3 区域修改文件自动保存策略：off = 关闭；afterDelay = 延迟自动保存；onFocusChange = 失焦保存；onWindowChange = 窗口失焦保存 */
  autoSave: AutoSaveMode;
  /** 延迟自动保存时间（毫秒），当 autoSave === 'afterDelay' 时生效 */
  autoSaveDelay: number;
  /** 同一目录下最大空闲温备 Worker 进程数 */
  maxIdleWorkers: number;
  /** 自动压缩上下文（Pi RPC setAutoCompaction） */
  autoCompaction: boolean;
  /** 请求失败自动重试（Pi RPC setAutoRetry） */
  autoRetry: boolean;
  /** 后台并行任务完成时弹出通知提醒 */
  notifyOnBackgroundDone: boolean;
  /** 本机 Pi CLI 自动更新：启动定位到新版本后自动全局更新 */
  piAutoUpdate: boolean;
  /** 界面基础字号（px） */
  uiFontSize: number;
  /** 代码与终端字号（px） */
  codeFontSize: number;
  /** 对话消息排版密度 */
  messageDensity: "comfortable" | "compact";
}

export const DEFAULT_SETTINGS: AppSettings = {
  sendShortcut: "enter",
  streamingMode: "followUp",
  defaultThinking: "medium",
  autoSave: "afterDelay",
  autoSaveDelay: 1000,
  maxIdleWorkers: 3,
  autoCompaction: true,
  autoRetry: true,
  notifyOnBackgroundDone: true,
  piAutoUpdate: false,
  uiFontSize: 13,
  codeFontSize: 12.5,
  messageDensity: "comfortable",
};

function loadSavedSettings(): AppSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      sendShortcut: parsed.sendShortcut === "ctrl-enter" ? "ctrl-enter" : "enter",
      streamingMode: parsed.streamingMode === "steer" ? "steer" : "followUp",
      defaultThinking: ["off", "minimal", "low", "medium", "high", "xhigh"].includes(parsed.defaultThinking)
        ? parsed.defaultThinking
        : DEFAULT_SETTINGS.defaultThinking,
      autoSave: ["off", "afterDelay", "onFocusChange", "onWindowChange"].includes(parsed.autoSave)
        ? parsed.autoSave
        : DEFAULT_SETTINGS.autoSave,
      autoSaveDelay: Math.min(10000, Math.max(300, Number(parsed.autoSaveDelay) || DEFAULT_SETTINGS.autoSaveDelay)),
      maxIdleWorkers: Math.min(8, Math.max(1, Number(parsed.maxIdleWorkers) || DEFAULT_SETTINGS.maxIdleWorkers)),
      autoCompaction: typeof parsed.autoCompaction === "boolean" ? parsed.autoCompaction : DEFAULT_SETTINGS.autoCompaction,
      autoRetry: typeof parsed.autoRetry === "boolean" ? parsed.autoRetry : DEFAULT_SETTINGS.autoRetry,
      notifyOnBackgroundDone:
        typeof parsed.notifyOnBackgroundDone === "boolean"
          ? parsed.notifyOnBackgroundDone
          : DEFAULT_SETTINGS.notifyOnBackgroundDone,
      piAutoUpdate: typeof parsed.piAutoUpdate === "boolean" ? parsed.piAutoUpdate : DEFAULT_SETTINGS.piAutoUpdate,
      uiFontSize: Math.min(16, Math.max(12, Number(parsed.uiFontSize) || DEFAULT_SETTINGS.uiFontSize)),
      codeFontSize: Math.min(16, Math.max(11, Number(parsed.codeFontSize) || DEFAULT_SETTINGS.codeFontSize)),
      messageDensity: parsed.messageDensity === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const appSettings = reactive<AppSettings>(loadSavedSettings());

export const settingsModalState = reactive({
  open: false,
  tab: "conversation" as SettingsTabId,
});

export function openSettingsModal(tab?: SettingsTabId): void {
  if (tab) settingsModalState.tab = tab;
  settingsModalState.open = true;
}

export function closeSettingsModal(): void {
  settingsModalState.open = false;
}

export function resetSettingsToDefault(): void {
  Object.assign(appSettings, DEFAULT_SETTINGS);
}

export function setupSettings(workbench: Workbench, bus: EventBus) {
  const disposers: Array<() => void> = [];
  if (typeof localStorage !== "undefined") {
    disposers.push(watch(
      appSettings,
      (val) => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(val));
      },
      { deep: true },
    ));
  }

  if (typeof document !== "undefined") {
    disposers.push(watchEffect(() => {
      const root = document.documentElement;
      root.style.setProperty("--ui-font-size", `${appSettings.uiFontSize}px`);
      root.style.setProperty("--code-font-size", `${appSettings.codeFontSize}px`);
      root.dataset.density = appSettings.messageDensity;
    }));
  }

  async function syncAgentPreferences(): Promise<void> {
    const ws = workbench.active.value;
    if (!ws || ws.status !== "ready") return;
    await workbench.call("setMaxIdleWorkers", appSettings.maxIdleWorkers).catch(() => {});
    await workbench.call("setAutoCompaction", appSettings.autoCompaction).catch(() => {});
    await workbench.call("setAutoRetry", appSettings.autoRetry).catch(() => {});
  }

  disposers.push(bus.on("workspace:opened", () => {
    void syncAgentPreferences();
  }));

  // Pi 自动更新：每次定位到本机 Pi 后（启动 / 重检 / 更新后刷新都会广播），
  // 若开关打开且发现新版本，自动执行一次全局更新。只触发一次，避免循环。
  let piAutoUpdateDone = false;
  disposers.push(bus.on("pi:located", (info: any) => {
    if (piAutoUpdateDone || !appSettings.piAutoUpdate || !info?.found) return;
    piAutoUpdateDone = true;
    void (async () => {
      const checked = await workbench.checkPiUpdate();
      if (checked.updateAvailable) await workbench.updatePi();
    })();
  }));

  disposers.push(watch(
    () => [appSettings.maxIdleWorkers, appSettings.autoCompaction, appSettings.autoRetry],
    () => {
      void syncAgentPreferences();
    },
  ));

  // 后台并行会话完成时自动发送通知
  disposers.push(bus.on(
    "pi:event",
    ({ cwd, sessionFile, event, workspace }: { cwd: string; sessionFile?: string; event: any; workspace: any }) => {
      if (!appSettings.notifyOnBackgroundDone) return;
      if (event?.type !== "agent_settled") return;
      const targetFile = sessionFile || workspace?.sessionFile;
      if (!targetFile) return;
      const isForeground =
        cwd === workbench.state.activeCwd &&
        workspace?.sessionFile &&
        workspace.sessionFile.replace(/\\/g, "/").toLowerCase() === targetFile.replace(/\\/g, "/").toLowerCase();
      if (!isForeground) {
        const sessionItem = workspace?.sessions?.find(
          (s: any) => s.path?.replace(/\\/g, "/").toLowerCase() === targetFile.replace(/\\/g, "/").toLowerCase(),
        );
        const label = sessionItem?.title || workspace?.name || "后台任务";
        bus.emit("notify", { level: "info", text: `并行任务已完成：「${label.slice(0, 32)}」` });
      }
    },
  ));

  return {
    settings: appSettings,
    modal: settingsModalState,
    open: openSettingsModal,
    close: closeSettingsModal,
    reset: resetSettingsToDefault,
    dispose: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
