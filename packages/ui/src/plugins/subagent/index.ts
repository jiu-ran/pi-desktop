import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import SubagentTool from "./SubagentTool.vue";
import { SUBAGENT_TOOLS } from "./summary.ts";

/**
 * 对话区域插件：把子代理类工具的 `details.results` 渲染成子任务清单。
 *
 * 子代理由 `npm:pi-subagents` 扩展提供，**不是 Pi 自带能力**，所以整体做成插件：
 * 核心分发器不 import 这里的任何组件，只认插件注册的工具渲染器；
 * 停用后这些卡片自动回退成通用工具卡片（参数 + 文本结果）。
 */
export default definePlugin({
  id: "subagent",
  name: "子代理",
  description:
    "把子代理工具的结果渲染为子任务清单（代理名、状态、耗时、工具数、token 与失败原因），点击可查看该子代理的对话。停用后回退为通用工具卡片。",
  version: "0.2.0",
  icon: icons.events,
  order: 40,
  area: "conversation",
  core: false,
  activate(ctx) {
    ctx.registerToolRenderer({
      id: "subagent.cards",
      tools: [...SUBAGENT_TOOLS],
      component: SubagentTool,
    });
  },
});
