import NewTaskButton from "./NewTaskButton.vue";
import TaskOverlays from "./TaskOverlays.vue";
import TasksView from "./TasksView.vue";
import { ui } from "./ui.ts";

export default {
  id: "pi.builtin.tasks",
  name: "任务导航",
  description: "按项目分组的任务（会话）列表：搜索、切换、新建、删除任务，打开或移除项目。",
  version: "2.1.0",
  deactivate() {
    ui.menu = null;
    ui.confirm?.resolve(null);
    ui.confirm = null;
  },
  activate(ctx: any) {
    ctx.contribute("views.sidebar", { id: "tasks", title: "任务", order: 10, component: TasksView });
    ctx.contribute("titlebar", { id: "task-buttons", order: 10, component: NewTaskButton });
    ctx.contribute("overlays", { id: "task-overlays", component: TaskOverlays });
    ctx.contribute("commands", { id: "workspace.open", title: "打开项目目录", keybinding: "Ctrl+O", run: () => ctx.workbench.chooseAndOpen() });
    ctx.contribute("commands", { id: "session.new", title: "新建任务", keybinding: "Ctrl+N", run: () => ctx.workbench.newSession() });
    ctx.contribute("commands", { id: "sidebar.toggle", title: "切换侧栏", keybinding: "Ctrl+B", run: () => { ctx.workbench.state.sidebarOpen = !ctx.workbench.state.sidebarOpen; } });
  },
};
