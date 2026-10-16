import { definePlugin } from "../../kernel/plugin-manager.ts";
import { collectChanges } from "../../shared/diff.ts";
import { icons } from "../../shared/util.ts";
import ChangesPanel from "./ChangesPanel.vue";
import ChangesStage from "./ChangesStage.vue";

export default definePlugin({
  id: "changes",
  name: "文件变更",
  description: "汇总当前会话中 Agent 修改的文件，并在编辑器与详情视图中展示行级 Diff。",
  version: "0.2.0",
  icon: icons.diff,
  order: 20,
  panel: ChangesPanel,
  stage: ChangesStage,
  activate(ctx) {
    this.badge = () => {
      const files = collectChanges(ctx.workspace.value?.blocks);
      return files.length || null;
    };

    ctx.registerCommand({
      id: "changes.toggle",
      title: "切换文件变更面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("changes"),
    });
  },
});
