import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import { setMermaidRendering } from "../markdown/markdown.ts";

/**
 * 对话区域插件：把对话消息与打开文件里的 ```mermaid 代码块渲染为图表。
 * 停用后代码块会以普通代码高亮显示。
 */
export default definePlugin({
  id: "mermaid",
  name: "Mermaid 渲染",
  description: "将对话消息与打开文件中的 Mermaid 代码块渲染为流程图、时序图等图表。",
  version: "0.1.0",
  icon: icons.branch,
  order: 10,
  area: "conversation",
  activate() {
    setMermaidRendering(true);
  },
  deactivate() {
    setMermaidRendering(false);
  },
});
