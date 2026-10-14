import { icons } from "../../shared/util.js";
import FileEditorView from "./FileEditorView.vue";
import FilesView from "./FilesView.vue";

export default {
  id: "pi.builtin.files",
  name: "文件树",
  description: "查看当前项目目录中的文件和文件夹，并在系统默认程序中打开文件。",
  version: "1.0.0",
  activate(ctx) {
    ctx.contribute("views.editor", {
      id: "file-editor",
      order: 5,
      when: () => ctx.workbench.state.openFiles.length > 0,
      component: FileEditorView,
    });
    ctx.contribute("views.panel", {
      id: "files",
      title: "文件",
      icon: icons.folder,
      order: 5,
      component: FilesView,
    });
    ctx.contribute("commands", { id: "files.show", title: "查看项目文件", run: () => ctx.workbench.showPanel("files") });
  },
};
