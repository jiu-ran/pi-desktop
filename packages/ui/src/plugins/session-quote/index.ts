import { definePlugin } from "../../kernel/plugin-manager.ts";
import { icons } from "../../shared/util.ts";
import { filterCrossProjectSessions, recentHint, sessionHint } from "./summary.ts";

/**
 * 非 Pi 自带能力 → 插件：引用对话。
 *
 * Pi 自带的 `@` 只做文件 / 文件夹补全（TUI 就是这样）。「把另一段对话作为上下文」
 * 是桌面端加的能力，所以这里做成可停用的插件，注册两个 `@` 候选来源：
 * - 当前项目的对话（除本会话外）
 * - 其它项目的对话（跨项目只读列举，主进程带缓存）
 *
 * 停用后 `@` 只剩文件补全，其余功能完全不受影响。
 */
export default definePlugin({
  id: "session-quote",
  name: "引用对话",
  description:
    "在输入框用 @ 引用对话（当前项目与其它项目）：选中后作为上下文随消息发送，自动压缩，工具结果与附件正文不会带进去；也可以手动改写注入的正文。停用后 @ 只做文件补全。",
  version: "0.2.0",
  icon: icons.chat,
  order: 45,
  area: "conversation",
  core: false,
  activate(ctx) {
    // 当前项目的对话：数据来自工作区快照，不需要额外 IPC
    ctx.registerMentionSource({
      id: "session-quote.project",
      title: "当前项目的对话",
      kind: "session",
      order: 10,
      search(query) {
        const ws = ctx.workspace.value;
        if (!ws) return [];
        const words = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
        const current = ws.sessionFile ?? "";
        return (ws.sessions ?? [])
          .filter((item: any) => item?.path && item.path !== current && !item.empty)
          .filter((item: any) => {
            if (!words.length) return true;
            const haystack = String(item.title ?? "").toLowerCase();
            return words.every((word) => haystack.includes(word));
          })
          .slice(0, 5)
          .map((item: any) => ({
            id: item.path,
            label: item.title || "未命名会话",
            hint: recentHint(item.timestamp),
          }));
      },
      async pick(item) {
        await ctx.workbench.addSessionAttachment({ path: item.id, title: item.label });
      },
    });

    // 其它项目的对话：主进程扫会话根目录（每项目最近 4 个、整体 40 条、3 秒缓存）
    ctx.registerMentionSource({
      id: "session-quote.other-projects",
      title: "其它项目的对话",
      kind: "session",
      order: 20,
      async search(query) {
        const list = await ctx.workbench.crossProjectSessions(40);
        return filterCrossProjectSessions(list, {
          currentCwd: ctx.workspace.value?.cwd ?? "",
          query,
        }).map((item) => ({
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
