import { definePlugin } from "../../kernel/plugin-manager.ts";
import { collectChanges } from "../../shared/diff.ts";
import { icons } from "../../shared/util.ts";
import GitPanel from "./GitPanel.vue";
import GitStage from "./GitStage.vue";
import { overviewState } from "./state.ts";

export default definePlugin({
  id: "git",
  name: "版本控制",
  description:
    "合并 Git 仓库状态与本会话改动：初始化仓库、暂存与提交、获取 / 拉取 / 推送，并在详情视图查看提交与 Diff。",
  version: "0.3.0",
  icon: icons.branch,
  order: 20,
  panel: GitPanel,
  stage: GitStage,
  activate(ctx) {
    this.badge = () => {
      const repo = overviewState.value;
      if (repo?.isRepo) return repo.status.length || null;
      return collectChanges(ctx.workspace.value?.blocks).length || null;
    };

    const refresh = () => {
      if (!ctx.workspace.value?.cwd) {
        overviewState.value = null;
        return;
      }
      ctx.host
        .gitOverview()
        .then((repo) => {
          overviewState.value = repo;
        })
        .catch(() => {
          overviewState.value = null;
        });
    };
    refresh();
    ctx.on("workspace:switched", refresh);
    ctx.on("workspace:opened", refresh);

    ctx.registerCommand({
      id: "git.toggle",
      title: "切换版本控制面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("git"),
    });

    // 兼容旧命令：文件变更已合并进版本控制面板
    ctx.registerCommand({
      id: "changes.toggle",
      title: "切换文件变更面板（已合并到版本控制）",
      category: "插件",
      run: () => ctx.workbench.togglePanel("git"),
    });
  },
});
