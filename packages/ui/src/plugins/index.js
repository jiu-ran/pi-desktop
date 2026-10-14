import changes from "./changes/index.js";
import commandPalette from "./command-palette/index.js";
import conversation from "./conversation/index.js";
import events from "./events/index.js";
import files from "./files/index.js";
import extensionUi from "./extension-ui/index.js";
import messages from "./messages/index.js";
import pluginManager from "./plugin-manager/index.js";
import status from "./status/index.js";
import tasks from "./tasks/index.js";
import themes from "./themes/index.js";
import slash from "./slash/index.js";
import tools from "./tools/index.js";

/**
 * 内置插件清单。新增功能只需在这里加一行，不改内核与骨架。
 */
export const builtinPlugins = [
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
