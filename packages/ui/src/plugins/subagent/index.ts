import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";

/**
 * 对话区域插件：把子代理类工具的 `details.results` 渲染成子任务清单。
 *
 * 子代理由 `npm:pi-subagents` 扩展提供，不是所有用户都会安装；这里只接管已经出现的
 * `subagent` / `parallel` / `review` / `bg_wait` 工具卡片，没有这些工具时完全无副作用。
 * 停用后这些卡片回退为通用工具卡片（参数 + 文本结果）。
 */
export default definePlugin({
  id: "subagent",
  name: "子代理",
  description: "把子代理工具的结果渲染为子任务清单（代理名、状态、耗时、工具数、token 与失败原因）。停用后回退为通用工具卡片。",
  version: "0.1.0",
  icon: icons.events,
  order: 40,
  area: "conversation",
});
