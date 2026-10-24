import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import { filterCrossProjectSessions, sessionHint } from "./summary.ts";

/**
 * 对话区域插件：在输入框的 `@` 选择器里增加「其它项目的对话」分组。
 *
 * 核心的 `@` 只列当前项目的会话；跨项目的对话要靠主进程扫会话根目录，
 * 而且不是所有人都需要（会话多的时候候选会变长），所以做成可停用的插件：
 * - 启用：`@` 里多一组「其它项目的对话」，选中后加一枚会话附件，
 *   发送时由主进程把那段对话压成 `<session>` 上下文块。
 * - 停用：分组消失，其余功能完全不受影响。
 */
export default definePlugin({
  id: "session-quote",
  name: "引用其它项目对话",
  description:
    "在输入框用 @ 引用其它项目的对话：选中后作为上下文随消息发送（自动压缩，工具结果与附件正文不会带进去）。停用后 @ 只列当前项目的对话。",
  version: "0.1.0",
  icon: icons.history,
  order: 45,
  area: "conversation",
  core: false,
  activate(ctx) {
    ctx.registerMentionSource({
      id: "session-quote.other-projects",
      title: "其它项目的对话",
      order: 20,
      async search(query) {
        const list = await ctx.workbench.crossProjectSessions(40);
        const rows = filterCrossProjectSessions(list, {
          currentCwd: ctx.workspace.value?.cwd ?? "",
          query,
        });
        return rows.map((item) => ({
          id: item.path,
          label: item.title || "未命名会话",
          hint: sessionHint(item),
          keywords: `${item.project ?? ""} ${item.cwd ?? ""}`,
        }));
      },
      async pick(item) {
        await ctx.workbench.addSessionAttachment({ path: item.id, title: item.label });
      },
    });
  },
});
