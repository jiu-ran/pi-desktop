import Breadcrumb from "./Breadcrumb.vue";
import ConversationView from "./ConversationView.vue";
import WelcomeView from "./WelcomeView.vue";

/**
 * 核心插件：对话舞台。
 * 主舞台提供欢迎页与对话区；标题栏提供“项目 · 分支 / 任务”面包屑。
 */
export default {
  id: "pi.core.conversation",
  name: "对话舞台",
  description: "消息时间线、输入框（模型 / 思考等级 / 发送方式）、标题栏面包屑。",
  version: "2.0.0",
  core: true,
  activate(ctx) {
    ctx.contribute("views.main", {
      id: "conversation",
      order: 10,
      when: () => Boolean(ctx.workbench.active),
      component: ConversationView,
    });
    ctx.contribute("views.main", { id: "welcome", order: 90, component: WelcomeView });
    ctx.contribute("titlebar", { id: "breadcrumb", order: 50, component: Breadcrumb });
  },
};
