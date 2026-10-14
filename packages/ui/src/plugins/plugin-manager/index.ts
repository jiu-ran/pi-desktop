import { icons } from "../../shared/util.ts";
import PluginsView from "./PluginsView.vue";

export default {
  id: "pi.core.plugins",
  name: "插件管理",
  description: "查看已注册插件及其贡献点，运行时启用或停用。",
  version: "1.1.0",
  core: true,
  activate(ctx: any) {
    ctx.contribute("views.panel", { id: "plugins", title: "插件", icon: icons.puzzle, order: 90, component: PluginsView });
    ctx.contribute("commands", { id: "plugins.show", title: "管理插件", run: () => ctx.workbench.showPanel("plugins") });
  },
};
