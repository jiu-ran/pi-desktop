import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import GitPanel from "./GitPanel.vue";
import GitStage from "./GitStage.vue";

export default definePlugin({
  id: "git",
  name: "Git 树",
  description: "在扩展工具面板浏览 Git 提交历史图与工作区状态，点击节点在详情视图中查看 Commit / Diff 详情。",
  version: "0.2.0",
  icon: icons.branch,
  order: 30,
  panel: GitPanel,
  stage: GitStage,
  activate(ctx) {
    ctx.registerCommand({
      id: "git.toggle",
      title: "切换 Git 树面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("git"),
    });
  },
});
