import { watchEffect } from "vue";
import { appSettings } from "./settings.ts";
import {
  WASH_THEMES,
  washGradient,
  washGlow,
  washTheme,
  type WashScheme,
  type WashThemeId,
} from "../shared/wash-themes.ts";

export interface ThemeSpec {
  id: string;
  wash: WashThemeId;
  label: string;
  scheme: WashScheme;
  codeTheme: { light: string; dark: string };
  titlebar: { color: string; symbolColor: string };
  vars: Record<string, string>;
}

/** 两套配色共用的底色；wash / frame / 用户气泡由具体主题在 buildTheme 里补。 */
const LIGHT_VARS: Record<string, string> = {
  "--card-border": "rgba(255, 255, 255, 0.62)",
  "--card-shadow": "0 1px 2px rgba(30, 35, 50, 0.05), 0 18px 44px rgba(30, 35, 50, 0.10)",
  "--glass-bg": "rgba(255, 255, 255, 0.66)",
  "--glass-strong": "rgba(255, 255, 255, 0.84)",
  "--glass-border": "rgba(255, 255, 255, 0.72)",
  "--glass-highlight": "rgba(255, 255, 255, 0.95)",
  "--bg": "#ffffff",
  "--bg-1": "#f8f7f9",
  "--bg-2": "#f1eff3",
  "--bg-3": "#e9e6ed",
  "--hover": "rgba(30, 30, 42, 0.055)",
  "--press": "rgba(30, 30, 42, 0.11)",
  "--line": "rgba(30, 30, 42, 0.075)",
  "--line-2": "rgba(30, 30, 42, 0.14)",
  "--fg": "#26232b",
  "--fg-2": "#6f6a77",
  "--fg-3": "#a19cab",
  "--accent": "#3b6cf6",
  "--accent-fg": "#ffffff",
  "--emphasis": "var(--accent)",
  "--accent-soft": "rgba(59, 108, 246, 0.12)",
  "--ok": "#22863a",
  "--ok-fg": "#22863a",
  "--warn": "#c27b0f",
  "--err": "#d93a35",
  "--code": "#8a63d2",
  "--add-bg": "rgba(34, 134, 58, 0.10)",
  "--add-fg": "#1f7a3a",
  "--del-bg": "rgba(217, 58, 53, 0.10)",
  "--del-fg": "#b32d29",
  "--input-bg": "#ffffff",
  "--shadow": "0 12px 36px rgba(30, 35, 50, 0.14)",
  "--term-bg": "#ffffff",
  "--term-fg": "#2a2730",
  "--ansi-black": "#1d1d1f",
  "--ansi-red": "#d3302f",
  "--ansi-green": "#22863a",
  "--ansi-yellow": "#b08800",
  "--ansi-blue": "#2f5bd8",
  "--ansi-magenta": "#a033c4",
  "--ansi-cyan": "#0f8199",
  "--ansi-white": "#8e8e93",
  "--ansi-bright-black": "#5f5f66",
  "--ansi-bright-red": "#ef4444",
  "--ansi-bright-green": "#2fa84f",
  "--ansi-bright-yellow": "#d4a017",
  "--ansi-bright-blue": "#3b82f6",
  "--ansi-bright-magenta": "#c04ee0",
  "--ansi-bright-cyan": "#14a3bf",
  "--ansi-bright-white": "#b4b4bb",
};

const DARK_VARS: Record<string, string> = {
  "--card-border": "rgba(255, 255, 255, 0.10)",
  "--card-shadow": "0 1px 2px rgba(0, 0, 0, 0.25), 0 18px 44px rgba(0, 0, 0, 0.32)",
  "--glass-bg": "rgba(35, 35, 40, 0.74)",
  "--glass-strong": "rgba(48, 48, 55, 0.84)",
  "--glass-border": "rgba(255, 255, 255, 0.11)",
  "--glass-highlight": "rgba(255, 255, 255, 0.20)",
  "--bg": "#232328",
  "--bg-1": "#2a2a30",
  "--bg-2": "#323239",
  "--bg-3": "#3c3c44",
  "--hover": "rgba(255, 255, 255, 0.06)",
  "--press": "rgba(255, 255, 255, 0.12)",
  "--line": "rgba(255, 255, 255, 0.075)",
  "--line-2": "rgba(255, 255, 255, 0.12)",
  "--fg": "#ececf0",
  "--fg-2": "#a9a9b4",
  "--fg-3": "#83838f",
  "--accent": "#6b93ff",
  "--accent-fg": "#ffffff",
  "--emphasis": "var(--accent)",
  "--accent-soft": "rgba(107, 147, 255, 0.16)",
  "--ok": "#4fd17a",
  "--ok-fg": "#4fd17a",
  "--warn": "#f0a33a",
  "--err": "#ff6961",
  "--code": "#d07cf0",
  "--add-bg": "rgba(79, 209, 122, 0.14)",
  "--add-fg": "#74e397",
  "--del-bg": "rgba(255, 105, 97, 0.14)",
  "--del-fg": "#ff8a84",
  "--input-bg": "#1b1b20",
  "--shadow": "0 12px 36px rgba(0, 0, 0, 0.45)",
  "--term-bg": "#232328",
  "--term-fg": "#e6e6ea",
  "--ansi-black": "#3a3a40",
  "--ansi-red": "#ff6b64",
  "--ansi-green": "#4fd17a",
  "--ansi-yellow": "#f2c14e",
  "--ansi-blue": "#6b9bff",
  "--ansi-magenta": "#d07cf0",
  "--ansi-cyan": "#4cc9e0",
  "--ansi-white": "#c9c9cf",
  "--ansi-bright-black": "#6c6c78",
  "--ansi-bright-red": "#ff8a84",
  "--ansi-bright-green": "#74e397",
  "--ansi-bright-yellow": "#ffd479",
  "--ansi-bright-blue": "#8fb3ff",
  "--ansi-bright-magenta": "#e09cf7",
  "--ansi-bright-cyan": "#7fdcec",
  "--ansi-bright-white": "#f5f5f7",
};

/** 当前配色 + 用户选的 wash → 一份可直接写进 :root 的主题。 */
export function buildTheme(scheme: WashScheme, washId: string): ThemeSpec {
  const definition = washTheme(washId);
  const side = definition[scheme];
  return {
    id: `${scheme}-${definition.id}`,
    wash: definition.id,
    label: definition.label,
    scheme,
    codeTheme: { light: "github-light", dark: "github-dark" },
    titlebar: {
      color: side.frame,
      symbolColor: scheme === "dark" ? "#a9a9b4" : "#5d5863",
    },
    vars: {
      ...(scheme === "dark" ? DARK_VARS : LIGHT_VARS),
      "--frame": side.frame,
      "--wash": washGradient(definition.id, scheme),
      "--wash-glow": washGlow(definition.id, scheme),
      // 用户消息跟着 wash 轻微染色，不同主题下不会突然冒出一块粉色
      "--user-bg": scheme === "dark"
        ? `color-mix(in srgb, ${side.frame} 26%, #2a2a30)`
        : `color-mix(in srgb, ${side.frame} 16%, #ffffff)`,
    },
  };
}

export function setupTheme(
  workbench: { state: { theme: string }; setTheme: (id: string) => void },
  host?: any,
  onThemePinned?: (mode: "dark" | "light") => void,
) {
  let stopWatch: (() => void) | null = null;

  function toggleTheme(): void {
    workbench.setTheme(workbench.state.theme === "dark" ? "light" : "dark");
    // 标题栏切换等同于「强制深色/浅色」：设置页里的主题模式要跟着走，
    // 否则外观 watcher 会把用户刚切的主题又改回去
    onThemePinned?.(workbench.state.theme === "dark" ? "dark" : "light");
  }

  function currentTheme(): ThemeSpec {
    const scheme: WashScheme = workbench.state.theme === "dark" ? "dark" : "light";
    const washId = scheme === "dark" ? appSettings.darkTheme : appSettings.lightTheme;
    return buildTheme(scheme, washId);
  }

  if (typeof document !== "undefined") {
    stopWatch = watchEffect(() => {
      const theme = currentTheme();
      const root = document.documentElement;
      // data-theme 只表示明暗（终端 / 设置遮罩等选择器依赖它）；
      // 具体 wash 放在 data-wash，方便以后按主题做细节。
      root.dataset.theme = theme.scheme;
      root.dataset.wash = theme.wash;
      root.style.colorScheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.vars)) {
        root.style.setProperty(key, value);
      }
      root.classList.toggle("dark", theme.scheme === "dark");
      host?.setWindowBackground?.(theme.titlebar.color);
    });
  }

  return { themes: WASH_THEMES, toggleTheme, currentTheme, dispose: () => stopWatch?.() };
}
