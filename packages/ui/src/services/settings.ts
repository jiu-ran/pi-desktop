import { reactive, ref, watch, watchEffect } from "vue";
import type { EventBus } from "../kernel/event-bus.ts";
import type { Workbench } from "../kernel/workbench.ts";
import { readStorage, writeStorage } from "../shared/storage.ts";
import { normalizeLogMaxBytes } from "../shared/log-limit.ts";
import { shouldAutoDownloadUpdate } from "../shared/update-auto.ts";
import {
  appearanceStyle,
  normalizeAccent,
  normalizeEmphasisMode,
  normalizeHex,
  normalizeColumnWidth,
  normalizeRadius,
  normalizeThemeMode,
  resolveScheme,
  type AccentId,
  type EmphasisMode,
  type ColumnWidthId,
  type RadiusId,
  type ThemeMode,
} from "../shared/appearance.ts";

const SETTINGS_STORAGE_KEY = "pi-desktop.settings";

export type SettingsTabId =
  | "conversation"
  | "appearance"
  | "terminal"
  | "mcp"
  | "packages"
  | "agents"
  | "skills"
  | "plugins"
  | "environment"
  | "pi-cli"
  | "pi-desktop"
  | "logs";

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
  /** 本机 Pi CLI 自动更新：启动定位到新版本后自动更新 */
  piAutoUpdate: boolean;
  /** 更新范围：self = pi update；all = pi update --all（含已安装扩展） */
  piUpdateScope: "self" | "all";
  /** 手动指定的 Pi 可执行文件路径（为空时只从 PATH 自动识别） */
  piCustomPath: string;
  /** 启动时检查 Pi Desktop 的 GitHub Release */
  appUpdateCheck: boolean;
  /** 检查到新版本后自动下载并校验安装包（安装仍需手动确认） */
  appUpdateAuto: boolean;
  /** 界面基础字号（px） */
  uiFontSize: number;
  /** 代码与终端字号（px） */
  codeFontSize: number;
  /** 新建完整终端的 shell 配置，system = 系统默认命令解释器。 */
  terminalProfile: string;
  terminalCustomPath: string;
  terminalCustomArgs: string[];
  /** 对话消息排版密度 */
  messageDensity: "comfortable" | "compact";
  /**
   * 执行记录（工具 / 思考）的分组方式：
   * - grouped：按一次用户请求合成一行「执行了 N 步 …」（默认）
   * - compact：只折叠连续 4 步以上的活动（旧行为）
   * - expanded：全部展开，等同逐块显示
   */
  activityDetail: "grouped" | "compact" | "expanded";
  /** 时间线里把「连续同类、只有参数不同」的步骤合并成一行 */
  activityMerge: boolean;
  /** 界面缩放倍率（Chromium zoom factor），由设置页控制，不设快捷键 */
  uiZoom: number;
  /** 运行日志总量上限（字节），设置页给几档可选 */
  logMaxBytes: number;
  /** 主题模式：跟随系统 / 强制深色 / 强制浅色 */
  themeMode: ThemeMode;
  /** 强调色预设 */
  accent: AccentId;
  /** accent = "custom" 时用的颜色（#rrggbb）；空串表示还没挑过 */
  accentCustom: string;
  /** 对话里的文字强调色：follow = 跟随强调色，custom = 用 emphasisCustom */
  emphasis: EmphasisMode;
  emphasisCustom: string;
  /** 圆角风格 */
  radius: RadiusId;
  /** 对话正文列宽 */
  columnWidth: ColumnWidthId;
  /** 关闭界面动效（弹层、过渡、动画） */
  reduceMotion: boolean;
  /** .md 文件的默认视图：预览（点哪块编辑哪块）/ 源码 */
  markdownView: "source" | "preview";
  /** 文件树 / 标签页的类型图标主题 */
  fileIconTheme: "seti" | "mono" | "block";
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
  piUpdateScope: "self",
  piCustomPath: "",
  appUpdateCheck: true,
  appUpdateAuto: true,
  uiFontSize: 13,
  codeFontSize: 12.5,
  terminalProfile: "system",
  terminalCustomPath: "",
  terminalCustomArgs: [],
  messageDensity: "comfortable",
  activityDetail: "grouped",
  activityMerge: true,
  uiZoom: 1,
  logMaxBytes: 8 * 1024 * 1024,
  // 默认仍是深色（沿用产品原本的样子）；想跟系统走由用户自己选「跟随系统」
  themeMode: "dark",
  accent: "default",
  accentCustom: "#5b8def",
  emphasis: "follow",
  emphasisCustom: "#df8538",
  radius: "default",
  columnWidth: "default",
  reduceMotion: false,
  // 默认预览：和 Typora 一样，点哪一块就地改哪一块
  markdownView: "preview",
  // 默认 Seti：和 VS Code 的 Seti 主题同一套形状与配色
  fileIconTheme: "seti",
}

/** 文件图标主题：兼容早期存下来的名字 */
function normalizeFileIconTheme(value: unknown): AppSettings["fileIconTheme"] {
  if (value === "seti" || value === "mono" || value === "block") return value;
  if (value === "solid") return "block";
  if (value === "outline") return "mono";
  if (value === "tint") return "seti";
  return DEFAULT_SETTINGS.fileIconTheme;
}

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
      piUpdateScope: parsed.piUpdateScope === "all" ? "all" : "self",
      piCustomPath: typeof parsed.piCustomPath === "string" ? parsed.piCustomPath.slice(0, 500) : DEFAULT_SETTINGS.piCustomPath,
      appUpdateCheck: typeof parsed.appUpdateCheck === "boolean" ? parsed.appUpdateCheck : DEFAULT_SETTINGS.appUpdateCheck,
      appUpdateAuto: typeof parsed.appUpdateAuto === "boolean" ? parsed.appUpdateAuto : DEFAULT_SETTINGS.appUpdateAuto,
      uiFontSize: Math.min(16, Math.max(12, Number(parsed.uiFontSize) || DEFAULT_SETTINGS.uiFontSize)),
      codeFontSize: Math.min(16, Math.max(11, Number(parsed.codeFontSize) || DEFAULT_SETTINGS.codeFontSize)),
      terminalProfile: typeof parsed.terminalProfile === "string" && /^[a-z0-9-]{1,80}$/.test(parsed.terminalProfile)
        ? parsed.terminalProfile : "system",
      terminalCustomPath: typeof parsed.terminalCustomPath === "string" ? parsed.terminalCustomPath.slice(0, 4000) : "",
      terminalCustomArgs: Array.isArray(parsed.terminalCustomArgs)
        ? parsed.terminalCustomArgs.filter((arg: unknown) => typeof arg === "string" && !arg.includes("\0")).slice(0, 64).map((arg: string) => arg.slice(0, 4000)) : [],
      messageDensity: parsed.messageDensity === "compact" ? "compact" : "comfortable",
      activityDetail:
        parsed.activityDetail === "compact" || parsed.activityDetail === "expanded" ? parsed.activityDetail : "grouped",
      activityMerge: typeof parsed.activityMerge === "boolean" ? parsed.activityMerge : DEFAULT_SETTINGS.activityMerge,
      uiZoom: Math.min(3, Math.max(0.5, Number(parsed.uiZoom) || DEFAULT_SETTINGS.uiZoom)),
      logMaxBytes: normalizeLogMaxBytes(parsed.logMaxBytes),
      // 老版本只存了 "pi-desktop.theme"（dark/light），没有 themeMode：
      // 迁移成「锁定当时那套配色」，别让升级后突然跟着系统变成浅色
      themeMode: parsed.themeMode
        ? normalizeThemeMode(parsed.themeMode)
        : normalizeThemeMode(readStorage("pi-desktop.theme") ?? "dark"),
      accent: normalizeAccent(parsed.accent),
      accentCustom: normalizeHex(parsed.accentCustom, DEFAULT_SETTINGS.accentCustom),
      emphasis: normalizeEmphasisMode(parsed.emphasis),
      emphasisCustom: normalizeHex(parsed.emphasisCustom, DEFAULT_SETTINGS.emphasisCustom),
      radius: normalizeRadius(parsed.radius),
      columnWidth: normalizeColumnWidth(parsed.columnWidth),
      reduceMotion: parsed.reduceMotion === true,
      // 试过一版「分栏」写法（split），升级后统一回到预览
      markdownView: parsed.markdownView === "source" ? "source" : "preview",
      // 早期版本存的是 solid/outline/tint（同一套骨架的前三个名字），一并迁移过来
      fileIconTheme: normalizeFileIconTheme(parsed.fileIconTheme),
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
  Object.assign(appSettings, { ...DEFAULT_SETTINGS, terminalCustomArgs: [] });
}

/** setupSettings 里记下来的 workbench：设置页手动检查更新时也要能触发自动下载。 */
let settingsWorkbench: Workbench | null = null;

/**
 * 检查 Pi Desktop 更新；开着「自动下载更新」时顺手把安装包下下来。
 *
 * 启动检查和设置页的「检查更新」都走这里，行为保持一致：查到就下，
 * 但安装永远要用户点「安装并重启」——安装器会替换正在运行的二进制。
 */
export async function checkAppUpdateWithAutoDownload(
  options: { manual?: boolean } = {},
): Promise<Awaited<ReturnType<Workbench["checkAppUpdate"]>> | null> {
  const workbench = settingsWorkbench;
  if (!workbench) return null;
  const result = await workbench.checkAppUpdate(options);
  if (!shouldAutoDownloadUpdate(appSettings, result)) return result;
  if (workbench.state.appUpdate.phase !== "available") return result;
  void workbench.downloadAppUpdate({ background: true });
  return result;
}

export function setupSettings(workbench: Workbench, bus: EventBus) {
  const disposers: Array<() => void> = [];
  settingsWorkbench = workbench;
  if (typeof localStorage !== "undefined") {
    disposers.push(watch(
      appSettings,
      (val) => {
        writeStorage(SETTINGS_STORAGE_KEY, JSON.stringify(val));
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

  // ---------- 外观：主题模式 / 强调色 / 圆角 / 列宽 / 动效 ----------
  /** 系统深色偏好；跟随系统时要跟着它一起变。 */
  const prefersDark = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  // 必须是 ref：系统偏好变化要能触发下面重新计算主题
  const systemDark = ref(prefersDark?.matches ?? true);

  if (typeof document !== "undefined") {
    // 主题模式决定实际配色；切到「跟随系统」时监听系统偏好变化
    disposers.push(watchEffect(() => {
      const scheme = resolveScheme(appSettings.themeMode, systemDark.value);
      if (workbench.state.theme !== scheme) workbench.setTheme(scheme);
    }));
    const onSystemSchemeChange = (event: MediaQueryListEvent) => {
      systemDark.value = event.matches;
    };
    prefersDark?.addEventListener?.("change", onSystemSchemeChange);
    disposers.push(() => prefersDark?.removeEventListener?.("change", onSystemSchemeChange));
    // 兜底轮询：个别环境下 matchMedia 的 change 事件不触发（CDP 模拟、
    // 某些 Linux 桌面），跟随系统仍然要能切过去。系统偏好变化很慢，1.5s 一次足够。
    const pollSystemScheme = setInterval(() => {
      if (!prefersDark) return;
      if (prefersDark.matches !== systemDark.value) systemDark.value = prefersDark.matches;
    }, 1500);
    disposers.push(() => clearInterval(pollSystemScheme));

    disposers.push(watchEffect(() => {
      const root = document.documentElement;
      const style = appearanceStyle({
        themeMode: appSettings.themeMode,
        accent: appSettings.accent,
        accentCustom: appSettings.accentCustom,
        emphasis: appSettings.emphasis,
        emphasisCustom: appSettings.emphasisCustom,
        radius: appSettings.radius,
        columnWidth: appSettings.columnWidth,
        reduceMotion: appSettings.reduceMotion,
        scheme: workbench.state.theme === "light" ? "light" : "dark",
      });
      for (const [key, value] of Object.entries(style.vars)) root.style.setProperty(key, value);
      for (const [key, value] of Object.entries(style.dataset)) root.dataset[key] = value;
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

  // Pi 定位后的一次性启动逻辑（启动 / 重检 / 更新后刷新都会广播，只处理首次成功的定位）：
  // 1) 若存有手动路径且与当前定位不一致，以手动路径为准重新定位一次；
  // 2) 若自动更新开关打开且发现新版本，自动执行一次全局更新。
  // 注意「成功」才上锁：启动时 Pi 还没装好 / 路径还在校验，此时 `found` 为 false，
  // 若在这里就上锁，用户后来装好 Pi 也不会再走一遍启动检查。
  let piBootHandled = false;
  let customPathWarned = false;
  disposers.push(bus.on("pi:located", (info: any) => {
    if (piBootHandled) return;
    void (async () => {
      const custom = appSettings.piCustomPath.trim();
      let located = info;
      if (custom && custom !== info?.path) {
        const result = await workbench.refreshPi(custom);
        located = { ...info, ...result };
        if (!result.found) {
          // 手动路径失效：只提醒一次，但**不上锁**——回退到 PATH 之后若定位到 Pi，
          // 启动检查（含自动更新）还得正常跑。
          if (!customPathWarned) {
            customPathWarned = true;
            bus.emit("notify", { level: "warning", text: "已保存的 Pi 路径已失效，已回退为 PATH 自动识别，请检查设置" });
          }
          return;
        }
      }
      if (!located?.found) return;
      piBootHandled = true;
      const checked = await workbench.checkPiUpdate(custom || undefined);
      if (checked.updateAvailable && appSettings.piAutoUpdate) {
        await workbench.updatePi(custom || undefined, appSettings.piUpdateScope);
      }
    })();
  }));

  disposers.push(watch(
    () => [appSettings.maxIdleWorkers, appSettings.autoCompaction, appSettings.autoRetry],
    () => {
      void syncAgentPreferences();
    },
  ));

  // 界面缩放：设置变更即时生效；启动时应用一次已保存的值。
  disposers.push(watch(
    () => appSettings.uiZoom,
    (factor) => {
      void workbench.setAppZoom(factor);
    },
  ));
  void workbench.setAppZoom(appSettings.uiZoom);

  // 日志总量上限：启动时同步一次，改动即时生效（主进程会顺手清一次超量文件）
  void workbench.setLogLimit(appSettings.logMaxBytes);
  disposers.push(watch(
    () => appSettings.logMaxBytes,
    (bytes) => {
      void workbench.setLogLimit(bytes);
    },
  ));

  // 自动更新默认开启：启动时先查，查到就顺手把安装包下好，用户只需要点一下重启。
  if (appSettings.appUpdateCheck) void checkAppUpdateWithAutoDownload();

  // 用户后来打开「自动下载更新」时，不要等他再点一次检查才生效。
  disposers.push(watch(
    () => appSettings.appUpdateAuto,
    (enabled) => {
      if (!enabled) return;
      const state = workbench.state.appUpdate;
      if (state.updateAvailable && state.phase === "available") void workbench.downloadAppUpdate({ background: true });
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
