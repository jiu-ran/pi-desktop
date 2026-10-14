import ExtensionDialog from "./ExtensionDialog.vue";
import ExtStatus from "./ExtStatus.vue";
import Toasts from "./Toasts.vue";
import Widgets from "./Widgets.vue";
import { extState, handleRequest, pushToast } from "./state.ts";

export default {
  id: "pi.builtin.extension-ui",
  name: "扩展交互",
  description: "响应本机 Pi 扩展发来的 extension_ui_request：弹窗、通知、状态栏与小组件。",
  version: "1.0.0",
  activate(ctx: any) {
    ctx.on("pi:event", ({ cwd, event }: { cwd: string; event: any }) => {
      if (event.type !== "extension_ui_request") return;
      handleRequest(cwd, event, {
        onTitle: (title) => { document.title = title ? `${title} — Pi Desktop` : "Pi Desktop"; },
        onEditorText: (text) => ctx.emit("composer:set", { cwd, text }),
      });
    });
    ctx.on("extension-ui:respond", ({ cwd, response }: { cwd: string; response: Record<string, any> }) => {
      ctx.respondExtensionUi(cwd, response).catch((error: any) => pushToast("error", error?.message ?? String(error)));
    });
    ctx.on("notify", ({ level, text }: { level?: string; text: string }) => pushToast(level ?? "info", text));

    ctx.contribute("overlays", { id: "extension-dialog", component: ExtensionDialog });
    ctx.contribute("overlays", { id: "toasts", component: Toasts });
    ctx.contribute("statusbar", { id: "extension-status", order: 5, component: ExtStatus });
    ctx.contribute("composer.addons", { id: "extension-widgets", order: 10, component: Widgets });
  },
  deactivate() {
    extState.dialogs.length = 0;
    extState.statuses = {};
    extState.widgets = {};
  },
};
