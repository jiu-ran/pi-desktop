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
    },
  },
];

export function setupTheme(workbench: { state: { theme: string }; setTheme: (id: string) => void }, host?: any) {
  let stopWatch: (() => void) | null = null;

  function toggleTheme(): void {
    workbench.setTheme(workbench.state.theme === "dark" ? "light" : "dark");
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
