import { watchEffect } from "vue";
import { appSettings } from "./settings.ts";
import {
  WASH_THEMES,
  washEntry,
  washGradient,
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

const LIGHT_SEMANTIC_VARS: Record<string, string> = {
  "--accent": "#3b6cf6",
  "--accent-fg": "#ffffff",
  "--emphasis": "var(--accent)",
  "--accent-soft": "rgba(59, 108, 246, 0.12)",
  "--ok": "#1f883d",
  "--ok-fg": "#1f883d",
  "--warn": "#c27b0f",
  "--err": "#d93a35",
  "--code": "#8a63d2",
  "--add-bg": "rgba(31, 136, 61, 0.10)",
  "--add-fg": "#1a7433",
  "--del-bg": "rgba(217, 58, 53, 0.10)",
  "--del-fg": "#b32d29",
  "--shadow": "0 14px 40px rgba(24, 28, 42, 0.14)",
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

const DARK_SEMANTIC_VARS: Record<string, string> = {
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
  "--shadow": "0 16px 48px rgba(0, 0, 0, 0.52)",
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

/** 当前配色 + 用户选的 wash → 一份可直接写进 :root 的完整主题变量。 */
export function buildTheme(scheme: WashScheme, washId: string): ThemeSpec {
  const entry = washEntry(washId, scheme);
  const p = entry.palette;
  return {
    id: `${scheme}-${entry.id}`,
    wash: entry.id,
    label: entry.label,
    scheme,
    codeTheme: { light: "github-light", dark: "github-dark" },
    titlebar: {
      color: p.frame,
      symbolColor: p.fg2,
    },
    vars: {
      ...(scheme === "dark" ? DARK_SEMANTIC_VARS : LIGHT_SEMANTIC_VARS),
      "--frame": p.frame,
      "--wash": washGradient(entry.id, scheme),
      "--wash-glow": p.glow,
      "--card-border": p.cardBorder,
      "--card-shadow": p.cardShadow,
      "--glass-bg": p.glassBg,
      "--glass-strong": p.glassStrong,
      "--glass-border": p.glassBorder,
      "--glass-highlight": p.glassHighlight,
      "--bg": p.bg,
      "--bg-1": p.bg1,
      "--bg-2": p.bg2,
      "--bg-3": p.bg3,
      "--input-bg": p.inputBg,
      "--term-bg": p.termBg,
      "--term-fg": p.fg,
      "--user-bg": p.userBg,
      "--fg": p.fg,
      "--fg-2": p.fg2,
      "--fg-3": p.fg3,
      "--line": p.line,
      "--line-2": p.line2,
      "--hover": p.hover,
      "--press": p.press,
    },
  };
}

export function setupTheme(
  workbench: { state: { theme: string }; setTheme: (id: string) => void },
  host?: any,
  onThemePinned?: (mode: "dark" | "light") => void,
) {
  let stopWatch: (() => void) | null = null;

  /**
   * 从点击位置把一个圆形「揭示」出下一套主题（View Transitions API）。
   * 浏览器不支持或用户关了动效时，直接切换。
   */
  function revealAround(origin: { x: number; y: number } | undefined, apply: () => void): void {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!doc?.startViewTransition || reduced || document.documentElement.dataset.motion === "off") {
      apply();
      return;
    }
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    // 半径取到最远的角，圆一定盖满窗口
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    let transition: { ready: Promise<void> };
    try {
      transition = doc.startViewTransition(apply);
    } catch {
      // 上一次揭示还没结束就再点：直接切换，不排队
      apply();
      return;
    }
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
          },
          {
            duration: 460,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* 动画被打断（连续点）时忽略：主题已经切过去了 */
      });
  }

  function toggleTheme(origin?: { x: number; y: number }): void {
    revealAround(origin, () => {
      workbench.setTheme(workbench.state.theme === "dark" ? "light" : "dark");
      // 标题栏切换等同于「强制深色/浅色」：设置页里的主题模式要跟着走，
      // 否则外观 watcher 会把用户刚切的主题又改回去
      onThemePinned?.(workbench.state.theme === "dark" ? "dark" : "light");
    });
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
      // 具体 wash 放在 data-wash，方便按主题微调。
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

  return { themes: WASH_THEMES, toggleTheme, revealAround, currentTheme, dispose: () => stopWatch?.() };
}
