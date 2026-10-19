import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import PluginManagerPanel from "./PluginManagerPanel.vue";

export default definePlugin({
  id: "plugin-manager",
  name: "插件管理",
  description: "管理扩展工具插件（扩展工具面板与编辑器详情视图）的启用与停用。",
  version: "0.2.0",
  icon: icons.puzzle,
  order: 100,
  core: true,
  panel: PluginManagerPanel,
  activate(ctx) {
    ctx.registerCommand({
      id: "plugins.toggle",
      title: "打开插件管理面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("plugin-manager"),
    });
  },
});
