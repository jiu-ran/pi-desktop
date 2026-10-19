import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import EventsPanel from "./EventsPanel.vue";
import EventStage from "./EventStage.vue";
import { eventLog } from "./log.ts";

export default definePlugin({
  id: "events",
  name: "RPC 事件",
  description: "实时观察 Pi 子进程发出的 JSON-RPC 事件流，并在详情视图中检视完整 JSON 载荷。",
  version: "0.2.0",
  icon: icons.events,
  order: 40,
  panel: EventsPanel,
  stage: EventStage,
  activate(ctx) {
    ctx.on("pi:event", ({ cwd, sessionFile, event }: { cwd: string; sessionFile?: string; event: Record<string, any> }) => {
      eventLog.push(cwd, sessionFile, event);
    });

    ctx.registerCommand({
      id: "events.toggle",
      title: "切换 RPC 事件面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("events"),
    });

    ctx.registerCommand({
      id: "events.clear",
      title: "清空 RPC 事件日志",
      category: "插件",
      run: () => {
        eventLog.clear();
        ctx.stage.closeByPlugin("events");
      },
    });
  },
});
