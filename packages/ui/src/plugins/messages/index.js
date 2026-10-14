import AssistantText from "./AssistantText.vue";
import NoticeBlock from "./NoticeBlock.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import UserMessage from "./UserMessage.vue";

/**
 * 消息渲染插件：用户消息、Markdown 正文（markstream-vue）、思考块、系统提示。
 * 停用后各类块退回纯文本兜底显示。
 */
export default {
  id: "pi.builtin.messages",
  name: "消息渲染",
  description: "Markdown 流式渲染、可折叠思考块、重试与压缩提示。",
  version: "1.0.0",
  activate(ctx) {
    ctx.contribute("messageRenderers", { id: "user", match: (b) => b.kind === "user", component: UserMessage });
    ctx.contribute("messageRenderers", { id: "text", match: (b) => b.kind === "text", component: AssistantText });
    ctx.contribute("messageRenderers", { id: "thinking", match: (b) => b.kind === "thinking", component: ThinkingBlock });
    ctx.contribute("messageRenderers", { id: "notice", match: (b) => b.kind === "notice", component: NoticeBlock });
  },
};
