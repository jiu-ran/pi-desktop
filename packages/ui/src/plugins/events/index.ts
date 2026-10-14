import { icons } from "../../shared/util.ts";
import EventsView from "./EventsView.vue";
import { eventLog } from "./log.ts";

export default {
  id: "pi.builtin.events",
  name: "RPC 事件",
  description: "实时查看本机 Pi 输出的 RPC 事件流，便于排查问题。",
  version: "1.0.0",
  activate(ctx: any) {
    ctx.on("pi:event", ({ cwd, event }: { cwd: string; event: any }) => eventLog.push(cwd, event));
    ctx.contribute("views.panel", { id: "events", title: "RPC 事件", icon: icons.events, order: 30, component: EventsView });
  },
  deactivate() {
    eventLog.clear();
  },
};
