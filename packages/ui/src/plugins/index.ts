import changes from "./changes/index.ts";
import commandPalette from "./command-palette/index.ts";
import conversation from "./conversation/index.ts";
import events from "./events/index.ts";
import files from "./files/index.ts";
import extensionUi from "./extension-ui/index.ts";
import messages from "./messages/index.ts";
import pluginManager from "./plugin-manager/index.ts";
import status from "./status/index.ts";
import tasks from "./tasks/index.ts";
import themes from "./themes/index.ts";
import slash from "./slash/index.ts";
import tools from "./tools/index.ts";
import type { PluginDefinition } from "../kernel/plugin-manager.ts";

/**
 * 内置插件清单。新增功能只需在这里加一行，不改内核与骨架。
 */
export const builtinPlugins: PluginDefinition[] = [
  themes,
  conversation,
  slash,
  messages,
  tools,
  tasks,
  files,
  changes,
  events,
  extensionUi,
  status,
  commandPalette,
  pluginManager,
];
