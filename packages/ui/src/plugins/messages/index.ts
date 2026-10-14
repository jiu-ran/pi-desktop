import AssistantText from "./AssistantText.vue";
import NoticeBlock from "./NoticeBlock.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import UserMessage from "./UserMessage.vue";

export default {
  id: "pi.builtin.messages",
  name: "消息渲染",
  description: "Markdown 流式渲染、可折叠思考块、重试与压缩提示。",
  version: "1.0.0",
  activate(ctx: any) {
    ctx.contribute("messageRenderers", { id: "user", match: (b: any) => b.kind === "user", component: UserMessage });
    ctx.contribute("messageRenderers", { id: "text", match: (b: any) => b.kind === "text", component: AssistantText });
    ctx.contribute("messageRenderers", { id: "thinking", match: (b: any) => b.kind === "thinking", component: ThinkingBlock });
    ctx.contribute("messageRenderers", { id: "notice", match: (b: any) => b.kind === "notice", component: NoticeBlock });
  },
};
