import ConnectionStatus from "./ConnectionStatus.vue";
import UsageStatus from "./UsageStatus.vue";

export default {
  id: "pi.builtin.status",
  name: "状态",
  description: "标题栏右侧的连接状态、上下文占用与费用（来自 get_session_stats）。",
  version: "1.1.0",
  activate(ctx: any) {
    ctx.contribute("statusbar", { id: "usage", order: 10, component: UsageStatus });
    ctx.contribute("statusbar", { id: "connection", order: 20, component: ConnectionStatus });
  },
};
