import { icons } from "../../shared/util.ts";
import ChangeSummary from "./ChangeSummary.vue";
import ChangesView from "./ChangesView.vue";
import { collectChanges } from "./collect.ts";

export default {
  id: "pi.builtin.changes",
  name: "任务变更",
  description: "汇总当前任务中 edit / write 改过的文件，对话末尾显示 +/− 摘要，面板里逐文件审查 diff。",
  version: "2.0.0",
  activate(ctx: any) {
    ctx.contribute("views.panel", {
      id: "changes",
      title: "任务变更",
      icon: icons.diff,
      order: 10,
      component: ChangesView,
      badge: () => collectChanges(ctx.workbench.active?.blocks).length || "",
    });
    ctx.contribute("timeline.footer", { id: "change-summary", order: 10, component: ChangeSummary });
    ctx.contribute("commands", { id: "changes.show", title: "查看任务变更", run: () => ctx.workbench.showPanel("changes") });
    ctx.on("changes:reveal", (target: string) => ctx.reveal(target));
  },
};
