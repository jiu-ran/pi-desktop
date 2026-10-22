import type { SidebarPlugin } from "../kernel/plugin-manager.ts";
import filesPlugin from "./files/index.ts";
import gitPlugin from "./git/index.ts";
import eventsPlugin from "./events/index.ts";
import pluginManagerPlugin from "./plugin-manager/index.ts";
import markdownPlugin from "./markdown/index.ts";
import mermaidPlugin from "./mermaid/index.ts";
import terminalPlugin from "./terminal/index.ts";

/**
 * 内置插件清单，按作用区域分组：
 * - 扩展工具（sidebar）：活动栏图标 + 扩展工具面板 + 详情视图
 * - 对话区域（conversation）：对话消息渲染
 * - 文件区域（files）：打开文件的渲染
 */
export const builtinPlugins: SidebarPlugin[] = [
  filesPlugin,
  gitPlugin,
  eventsPlugin,
  pluginManagerPlugin,
  mermaidPlugin,
  markdownPlugin,
  terminalPlugin,
];
