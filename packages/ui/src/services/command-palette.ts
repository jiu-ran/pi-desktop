import { reactive } from "vue";
import type { PluginCommand } from "../kernel/plugin-manager.ts";

export const paletteState = reactive({
  open: false,
});

function normalizeKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return parts.join("+");
}

export function createCommandRegistry() {
  const commands = reactive<PluginCommand[]>([]);

  function register(command: PluginCommand): () => void {
    const existing = commands.findIndex((c) => c.id === command.id);
    if (existing >= 0) commands.splice(existing, 1);
    commands.push(command);
    return () => {
      const idx = commands.indexOf(command);
      if (idx >= 0) commands.splice(idx, 1);
    };
  }

  async function run(id: string): Promise<void> {
    const cmd = commands.find((item) => item.id === id);
    if (cmd) await cmd.run();
  }

  function bindGlobalKeys(): () => void {
    if (typeof window === "undefined") return () => {};
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      const combo = normalizeKey(event);
      if (combo === "Ctrl+K") {
        event.preventDefault();
        paletteState.open = !paletteState.open;
        return;
      }
      const matched = commands.find((item) => item.keybinding === combo);
      if (matched) {
        event.preventDefault();
        Promise.resolve(matched.run()).catch((error) => {
          console.error(`[command] ${matched.id} failed`, error);
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }

  return {
    commands,
    paletteState,
    register,
    run,
    bindGlobalKeys,
  };
}
