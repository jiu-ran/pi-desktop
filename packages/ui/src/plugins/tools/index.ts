import BashTool from "./BashTool.vue";
import DiffTool from "./DiffTool.vue";
import GenericTool from "./GenericTool.vue";
import ReadTool from "./ReadTool.vue";

export default {
  id: "pi.builtin.tool-cards",
  name: "工具卡片",
  description: "bash 终端输出、edit/write 行级 diff、read 文件预览、MCP 与通用工具卡片。",
  version: "1.0.0",
  activate(ctx: any) {
    ctx.contribute("toolRenderers", { id: "bash", priority: 10, match: (name: string) => name === "bash", component: BashTool });
    ctx.contribute("toolRenderers", { id: "diff", priority: 10, match: (name: string) => name === "edit" || name === "write", component: DiffTool });
    ctx.contribute("toolRenderers", { id: "read", priority: 10, match: (name: string) => name === "read", component: ReadTool });
    ctx.contribute("toolRenderers", { id: "generic", priority: 0, match: () => true, component: GenericTool });
  },
};
