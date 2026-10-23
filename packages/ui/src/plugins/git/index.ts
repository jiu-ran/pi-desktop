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
    "清晰分区的版本控制：更改 / 分支 / 历史 / 工作区 / 会话快照，支持分支切换与新建、暂存提交、获取 / 拉取 / 推送和 Diff。",
  version: "0.4.0",
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

    let request = 0;
    const refresh = () => {
      const current = ++request;
      const cwd = ctx.workspace.value?.cwd;
      if (!ctx.workspace.value?.cwd) {
        overviewState.value = null;
        return;
      }
      ctx.host
        .gitOverview()
        .then((repo) => {
          if (request === current && ctx.workspace.value?.cwd === cwd) overviewState.value = repo;
        })
        .catch(() => {
          if (request === current) overviewState.value = null;
        });
    };
    refresh();
    ctx.on("workspace:switched", refresh);
    ctx.on("workspace:opened", refresh);
    ctx.on("git:branch-changed", refresh);

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
