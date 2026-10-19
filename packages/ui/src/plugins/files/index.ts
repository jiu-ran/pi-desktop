import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import FilesPanel from "./FilesPanel.vue";
import FileStage from "./FileStage.vue";
import { openFileInStage } from "./state.ts";

export default definePlugin({
  id: "files",
  name: "项目文件",
  description: "在扩展工具面板浏览项目目录树，点击文件在编辑器与详情视图中打开多标签代码编辑器。",
  version: "0.2.0",
  icon: icons.folder,
  order: 10,
  panel: FilesPanel,
  stage: FileStage,
  badge() {
    return null;
  },
  activate(ctx) {
    ctx.on("file:open", (targetPath: string) => {
      openFileInStage(ctx.workbench, ctx.stage, { emit: ctx.emit } as any, targetPath);
    });

    ctx.registerCommand({
      id: "files.toggle",
      title: "切换项目文件面板",
      category: "插件",
      run: () => ctx.workbench.togglePanel("files"),
    });
  },
});
