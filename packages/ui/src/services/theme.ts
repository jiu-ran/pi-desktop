import { watchEffect } from "vue";

export interface ThemeSpec {
  id: string;
  label: string;
  scheme: "dark" | "light";
  codeTheme: { light: string; dark: string };
  titlebar: { color: string; symbolColor: string };
  vars: Record<string, string>;
}

export const THEMES: ThemeSpec[] = [
  {
    id: "dark",
    label: "深色",
    scheme: "dark",
    codeTheme: { light: "github-light", dark: "github-dark" },
    titlebar: { color: "#090909", symbolColor: "#909192" },
    vars: {
      "--frame": "#090909",
      "--bg": "#18191b",
      "--bg-1": "#1f2023",
      "--bg-2": "#25262a",
      "--bg-3": "#2e3034",
      "--hover": "rgba(255, 255, 255, 0.06)",
      "--line": "#2a2b2f",
      "--line-2": "#393b40",
      "--fg": "#e0e1e4",
      "--fg-2": "#909192",
      "--fg-3": "#6b6c70",
      "--accent": "#2a7deb",
      "--accent-fg": "#ffffff",
      "--accent-soft": "rgba(42, 125, 235, 0.16)",
      "--ok": "#169068",
      "--ok-fg": "#3fc28f",
      "--warn": "#e5a23d",
      "--err": "#e5534b",
      "--code": "#df8538",
      "--add-bg": "rgba(22, 144, 104, 0.16)",
      "--add-fg": "#5fd3a5",
      "--del-bg": "rgba(229, 83, 75, 0.15)",
      "--del-fg": "#f08b84",
      "--user-bg": "#303133",
      "--input-bg": "#090909",
      "--shadow": "0 12px 36px rgba(0, 0, 0, 0.55)",
      "--term-bg": "#111214",
      "--term-fg": "#d7dae0",
      "--ansi-black": "#5c6370",
      "--ansi-red": "#e06c75",
      "--ansi-green": "#98c379",
      "--ansi-yellow": "#e5c07b",
      "--ansi-blue": "#61afef",
      "--ansi-magenta": "#c678dd",
      "--ansi-cyan": "#56b6c2",
      "--ansi-white": "#c8ccd4",
      "--ansi-bright-black": "#7f848e",
      "--ansi-bright-red": "#ff7b86",
      "--ansi-bright-green": "#b5e890",
      "--ansi-bright-yellow": "#ffd68a",
      "--ansi-bright-blue": "#82c4ff",
      "--ansi-bright-magenta": "#e09eff",
      "--ansi-bright-cyan": "#7fd6e0",
      "--ansi-bright-white": "#f0f2f5",
    },
  },
  {
    id: "light",
    label: "浅色",
    scheme: "light",
    codeTheme: { light: "github-light", dark: "github-dark" },
    titlebar: { color: "#e9eaee", symbolColor: "#5d6068" },
    vars: {
      "--frame": "#e9eaee",
      "--bg": "#ffffff",
      "--bg-1": "#f7f8fa",
      "--bg-2": "#eff0f3",
      "--bg-3": "#e4e6ea",
      "--hover": "rgba(0, 0, 0, 0.05)",
      "--line": "#e4e5e9",
      "--line-2": "#d3d5db",
      "--fg": "#1f2024",
      "--fg-2": "#6c6f76",
      "--fg-3": "#9a9da4",
      "--accent": "#2a7deb",
      "--accent-fg": "#ffffff",
      "--accent-soft": "rgba(42, 125, 235, 0.12)",
      "--ok": "#14845f",
      "--ok-fg": "#14845f",
      "--warn": "#b7741d",
      "--err": "#d0392f",
      "--code": "#c25f12",
      "--add-bg": "rgba(20, 132, 95, 0.10)",
      "--add-fg": "#0f6b4c",
      "--del-bg": "rgba(208, 57, 47, 0.10)",
      "--del-fg": "#a52b22",
      "--user-bg": "#eceef1",
      "--input-bg": "#f7f8fa",
      "--shadow": "0 12px 36px rgba(20, 24, 40, 0.14)",
      "--term-bg": "#fbfbfd",
      "--term-fg": "#24282e",
      "--ansi-black": "#3b4048",
      "--ansi-red": "#c24043",
      "--ansi-green": "#2f7d4f",
      "--ansi-yellow": "#9a6b00",
      "--ansi-blue": "#2a6fdb",
      "--ansi-magenta": "#8b4fb3",
      "--ansi-cyan": "#0f7b8a",
      "--ansi-white": "#6b6f76",
      "--ansi-bright-black": "#5a5f66",
      "--ansi-bright-red": "#d03a3f",
      "--ansi-bright-green": "#247044",
      "--ansi-bright-yellow": "#8a5b00",
      "--ansi-bright-blue": "#1f63c9",
      "--ansi-bright-magenta": "#7c3fa5",
      "--ansi-bright-cyan": "#0a6b78",
      "--ansi-bright-white": "#1f2328",
    },
  },
];

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
    return THEMES.find((t) => t.id === workbench.state.theme) ?? THEMES[0];
  }

  if (typeof document !== "undefined") {
    stopWatch = watchEffect(() => {
      const theme = currentTheme();
      const root = document.documentElement;
      root.dataset.theme = theme.id;
      root.style.colorScheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.vars)) {
        root.style.setProperty(key, value);
      }
      root.classList.toggle("dark", theme.scheme === "dark");
      host?.setTitleBar?.(theme.titlebar);
    });
  }

  return { themes: THEMES, toggleTheme, currentTheme, dispose: () => stopWatch?.() };
}
