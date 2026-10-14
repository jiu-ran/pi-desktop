import { icons } from "../../shared/util.js";
import CommandPalette from "./CommandPalette.vue";
import { paletteState } from "./state.js";

function normalize(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}

/**
 * 命令面板与全局快捷键。
 * 所有插件在 commands 贡献点里声明的 keybinding 都由这里统一分发。
 */
export default {
  id: "pi.builtin.command-palette",
  name: "命令面板",
  description: "Ctrl+K 打开命令面板，统一处理插件声明的快捷键。",
  version: "1.0.0",
  activate(ctx) {
    ctx.contribute("overlays", { id: "command-palette", component: CommandPalette });
    ctx.contribute("commands", { id: "palette.open", title: "打开命令面板", keybinding: "Ctrl+K", run: () => { paletteState.open = true; } });
    ctx.contribute("toolstrip", { id: "palette", title: "命令面板 (Ctrl+K)", order: 10, icon: icons.search, run: () => { paletteState.open = true; } });

    const onKey = (event) => {
      const combo = normalize(event);
      if (combo === "Ctrl+K") {
        event.preventDefault();
        paletteState.open = !paletteState.open;
        return;
      }
      ctx.emit("keybinding", { combo, event });
    };
    window.addEventListener("keydown", onKey);
    ctx.onDispose(() => window.removeEventListener("keydown", onKey));
  },
  deactivate() {
    paletteState.open = false;
  },
};
