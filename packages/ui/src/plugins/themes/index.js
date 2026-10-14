import { watchEffect } from "vue";
import { icons } from "../../shared/util.js";

/**
 * 主题插件。每个主题就是一组 CSS 变量 + markstream 代码高亮主题 + 标题栏覆盖层颜色。
 * 深色配色取自 JetBrains Air 实际界面。第三方插件向 themes 贡献点注册新主题即可。
 */
const THEMES = [
  {
    id: "dark",
    label: "深色",
    scheme: "dark",
    codeTheme: { light: "github-light", dark: "github-dark-default" },
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
    codeTheme: { light: "github-light", dark: "github-dark-default" },
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

export default {
  id: "pi.builtin.themes",
  name: "主题",
  description: "Air 风格的深色 / 浅色主题，同步代码高亮与系统标题栏。",
  version: "1.1.0",
  core: true,
  activate(ctx) {
    for (const theme of THEMES) ctx.contribute("themes", theme);
    const toggle = () => ctx.workbench.setTheme(ctx.workbench.state.theme === "dark" ? "light" : "dark");
    ctx.contribute("toolstrip", {
      id: "theme-toggle",
      title: "切换深色 / 浅色",
      order: 80,
      icon: () => (ctx.workbench.state.theme === "dark" ? icons.moon : icons.sun),
      run: toggle,
    });
    ctx.contribute("commands", { id: "theme.toggle", title: "切换深色 / 浅色主题", run: toggle });

    // 把当前主题写到根节点并同步系统标题栏；插件停用时自动停止监听
    ctx.onDispose(watchEffect(() => {
      const theme = THEMES.find((t) => t.id === ctx.workbench.state.theme) ?? THEMES[0];
      const root = document.documentElement;
      root.dataset.theme = theme.id;
      root.style.colorScheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value);
      root.classList.toggle("dark", theme.scheme === "dark");
      ctx.chrome.setTitleBar(theme.titlebar);
    }));
  },
};
