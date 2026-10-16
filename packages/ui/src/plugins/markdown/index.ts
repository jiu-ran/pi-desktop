import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";

/**
 * 文件区域插件：打开 .md 文件时提供「预览」视图。
 * 实际渲染由文件编辑器按本插件的启用状态决定，停用后自动回到纯文本编辑。
 */
export default definePlugin({
  id: "markdown",
  name: "Markdown 渲染",
  description: "在打开的 .md 文件中提供实时 Markdown 预览，可随时与源码编辑互相切换。",
  version: "0.1.0",
  icon: icons.text,
  order: 10,
  area: "files",
  activate(ctx) {
    ctx.registerCommand({
      id: "markdown.toggle",
      title: "切换 Markdown 渲染插件",
      category: "插件",
      run: () => ctx.togglePlugin("markdown"),
    });
  },
});
